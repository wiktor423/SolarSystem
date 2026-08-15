"""Event-level analysis of Chrome DevTools performance traces.

Usage:
    venv/bin/python trace_analysis.py traces/Trace-JS.json.gz
    venv/bin/python trace_analysis.py traces/Trace-JStoWASM_switch.json.gz \
        --window 4.0 18.0        # restrict to a time window (seconds)
    venv/bin/python trace_analysis.py <trace> --grep wasm   # find event names
"""
import argparse
import bisect
import collections
import gzip
import json
import sys

MS = 1000.0  # trace timestamps are microseconds


def load_events(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    events = data["traceEvents"] if isinstance(data, dict) else data
    events = [e for e in events if "ts" in e]
    events.sort(key=lambda e: e["ts"])
    return events


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("trace")
    ap.add_argument("--window", nargs=2, type=float, metavar=("T0", "T1"),
                    help="analyze only events between T0 and T1 seconds from trace start")
    ap.add_argument("--grep", help="list event names matching a substring (case-insensitive) and exit")
    ap.add_argument("--top", type=int, default=15, help="rows in the top-duration table")
    args = ap.parse_args()

    events = load_events(args.trace)
    t0 = events[0]["ts"]

    # A DevTools export contains stray early-process events, so the recorded
    # activity window is measured between the first and last animation frame.
    raf_all = [e["ts"] for e in events if e.get("name") == "FireAnimationFrame"]
    span_s = (raf_all[-1] - raf_all[0]) / 1e6 if len(raf_all) > 1 else \
        (events[-1]["ts"] - t0) / 1e6

    if args.window:
        lo, hi = (t0 + w * 1e6 for w in args.window)
        events = [e for e in events if lo <= e["ts"] <= hi]
        span_s = args.window[1] - args.window[0]

    print(f"{args.trace}: {len(events)} events analyzed, "
          f"recorded activity window {span_s:.1f} s")

    names = collections.Counter(e.get("name", "") for e in events)

    if args.grep:
        pat = args.grep.lower()
        for n, c in sorted(names.items(), key=lambda x: -x[1]):
            if pat in n.lower():
                print(f"  {c:7d}  {n}")
        return

    # Frame index lookup: FireAnimationFrame marks the start of each rAF callback,
    # so an event's frame index is the count of FireAnimationFrame events before it.
    frame_ts = sorted(e["ts"] for e in events if e.get("name") == "FireAnimationFrame")
    def frame_of(ts):
        return bisect.bisect_right(frame_ts, ts)

    print(f"\nAnimation frames (FireAnimationFrame): {len(frame_ts)}")
    if len(frame_ts) > 1:
        cadence = (frame_ts[-1] - frame_ts[0]) / (len(frame_ts) - 1) / MS
        print(f"  mean frame interval: {cadence:.2f} ms")

    # --- Deoptimizations -------------------------------------------------
    deopts = [e for e in events if "Deoptimize" in e.get("name", "")]
    print(f"\nDeoptimization events: {len(deopts)}")
    if deopts:
        by_frame = collections.Counter(frame_of(e["ts"]) for e in deopts)
        dense = sorted(by_frame.items(), key=lambda x: -x[1])[:5]
        print("  frames with most deopt events: "
              + ", ".join(f"frame {f}: {c}" for f, c in dense))

    # --- Garbage collection ----------------------------------------------
    for gc_name in ("MinorGC", "MajorGC", "V8.GCScavenger", "BlinkGC.AtomicPhase"):
        gcs = [e for e in events if e.get("name") == gc_name and "dur" in e]
        if not gcs:
            continue
        total = sum(e["dur"] for e in gcs) / MS
        rate = len(gcs) / span_s
        print(f"\n{gc_name}: {len(gcs)} events, total {total:.1f} ms, "
              f"mean {total/len(gcs):.2f} ms, ~{rate:.1f}/s")
        worst = max(gcs, key=lambda e: e["dur"])
        print(f"  longest: {worst['dur']/MS:.2f} ms at frame {frame_of(worst['ts'])}")

    # --- WebAssembly compilation -----------------------------------------
    wasm = [e for e in events
            if "wasm" in e.get("name", "").lower() or "Wasm" in e.get("name", "")]
    print(f"\nWebAssembly-related events: {len(wasm)}")
    for e in wasm[:10]:
        dur = e.get("dur", 0) / MS
        print(f"  t={ (e['ts']-t0)/1e6 :8.3f}s  {e['name']}  ({dur:.3f} ms)")

    # --- Heaviest event types (complete events with duration) -------------
    by_name = collections.defaultdict(float)
    for e in events:
        if "dur" in e:
            by_name[e["name"]] += e["dur"]
    print(f"\nTop {args.top} event types by total duration:")
    for n, d in sorted(by_name.items(), key=lambda x: -x[1])[:args.top]:
        print(f"  {d/MS:10.1f} ms  {names[n]:7d}x  {n}")


if __name__ == "__main__":
    sys.exit(main())
