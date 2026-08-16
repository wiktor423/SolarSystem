# N-Body Gravity Engine — JS vs WASM

An interactive N-body gravitational simulation of the Solar System (Three.js), with a physics
engine you can switch at runtime between a multithreaded JavaScript implementation and a
multithreaded WebAssembly (C++) implementation, to compare frame times live.

## Requirements

- Python 3
- A browser with WebAssembly, SharedArrayBuffer, and Web Worker support (recent Chrome or Firefox)
- [Emscripten](https://emscripten.org/) (`emcc` on `PATH`) — only if rebuilding the WASM module

## Run it

The app needs cross-origin isolation (`COOP`/`COEP` headers) for `SharedArrayBuffer` and WASM
threads, so it can't be opened as a plain `file://` page or served from a generic static server.

```bash
python3 server.py
```

Then open `http://localhost:8000`. Use the "Live Telemetry" panel to switch engines, change the
asteroid count, and click "Restart Environment" to apply.

### Rebuilding the WASM engine

The compiled WASM artifacts are checked in, so this is only needed after editing
`cpp/physics_engine.cpp`:

```bash
./run.sh
```

This rebuilds `cpp/physics_wasm.*` with Emscripten and then starts `server.py`.

## Project layout

```
index.html          Page shell + live telemetry UI
src/                 JS engine, WASM worker bridge, render loop (main.js)
cpp/                 C++ physics engine + compiled WASM artifacts
benchmarks/          CSV benchmark data + analysis script (main.py)
server.py            Dev server with COOP/COEP headers
run.sh               Rebuild WASM, then run server.py
```

## Benchmarking

The telemetry panel's "Export CSV" button downloads per-frame timing data for the first 1000
frames. `benchmarks/main.py <asteroid_count>` compares a paired WASM/JS CSV set and prints
summary stats plus a chart (needs `pandas`/`matplotlib`, e.g. via `benchmarks/venv`).
