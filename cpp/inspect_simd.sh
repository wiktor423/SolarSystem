#!/usr/bin/env bash

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/physics_engine.cpp"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT


BASE_FLAGS=(-pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=16
            -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createModule
            -s 'EXPORTED_FUNCTIONS=["_initEngine","_getPosMassPointer","_getVelPointer","_preCalculateAccelerations","_stepPhysics"]'
            -s 'EXPORTED_RUNTIME_METHODS=["HEAPF64"]'
            -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,worker
            -O3)


build() {
    local name="$1"; shift
    emcc "$SRC" -o "$OUT/$name.js" "${BASE_FLAGS[@]}" "$@" 2>/dev/null
    wasm-dis "$OUT/$name.wasm" -o "$OUT/$name.wat"

    # computeAccelBlock is the only function that contains a square root;

    awk '
        /^ \(func /        { infunc=1; buf=""; hit=0 }
        infunc             { buf = buf $0 "\n" }
        /f64(x2)?\.sqrt/   { if (infunc) hit=1 }
        /^ \)$/            { if (infunc && hit) printf "%s", buf; infunc=0 }
    ' "$OUT/$name.wat" > "$OUT/$name.kernel.wat"
}

# Census of the whole kernel function.
census_function() {
    grep -oE '\b(f64\.(add|sub|mul|div|sqrt)|f64x2\.[a-z_0-9]+|v128\.[a-z_0-9]+)' \
        "$OUT/$1.kernel.wat" | sort | uniq -c | sort -rn | sed 's/^/    /'
}


census_inner_loop() {
    python3 - "$OUT/$1.kernel.wat" <<'PY'
import re, sys
from collections import Counter

lines = open(sys.argv[1]).read().split('\n')

# Every (loop ...) paired with its matching close paren.
loops = []
for i, l in enumerate(lines):
    if '(loop' not in l:
        continue
    depth, started = 0, False
    for j in range(i, len(lines)):
        for ch in lines[j]:
            if ch == '(':
                depth += 1; started = True
            elif ch == ')':
                depth -= 1
        if started and depth <= 0:
            loops.append((i, j)); break

# The j-loop is the shortest loop still containing the square root.
cands = [(s, e) for s, e in loops
         if any(re.search(r'f64(x2)?\.sqrt', lines[k]) for k in range(s, e + 1))]
if not cands:
    print('    no loop containing a square root found'); sys.exit(0)
s, e = min(cands, key=lambda p: p[1] - p[0])

ops = re.findall(
    r'\b(f64\.(?:add|sub|mul|div|sqrt)'
    r'|f64x2\.[a-z_0-9]+'
    r'|v128\.(?:load64_splat|load|store)'
    r'|f64\.(?:load|store))',
    '\n'.join(lines[s:e + 1]))

c = Counter(ops)
for k, n in sorted(c.items(), key=lambda x: -x[1]):
    print(f'    {n:3d}  {k}')
mem = sum(n for k, n in c.items() if 'load' in k or 'store' in k)
print(f'    ---- {sum(c.values()) - mem} non-memory ops, {mem} memory ops')
PY
}

# ---------------------------------------------------------------------------
echo "# strict IEEE vs -ffast-math" 


build strict -msimd128
build ffast  -msimd128 -ffast-math

for v in strict ffast; do
    echo "--- computeAccelBlock instruction census ($v) ---"
    census_function "$v"
    echo
done

echo "### diff of the two censuses (empty means identical codegen shape)"
diff <(grep -oE '\b(f64\.[a-z]+|f64x2\.[a-z_0-9]+|v128\.[a-z_0-9]+)' "$OUT/strict.kernel.wat" | sort | uniq -c) \
     <(grep -oE '\b(f64\.[a-z]+|f64x2\.[a-z_0-9]+|v128\.[a-z_0-9]+)' "$OUT/ffast.kernel.wat" | sort | uniq -c) \
     || true
echo

# ---------------------------------------------------------------------------
echo "# -msimd128 on vs off  "


# 'strict' above is already the -msimd128 build; only the control is new.
build nosimd

for v in strict nosimd; do
    label=$([ "$v" = strict ] && echo "with -msimd128" || echo "without -msimd128")
    echo "--- inner-loop census, $label ---"
    census_inner_loop "$v"
    echo
done

