"""Event-level analysis of Chrome DevTools performance traces. """ 

import argparse
import bisect
import collections
import gzip
import json
import statistics
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
                    help="analyze only events between T0 and T1 seconds "
                         "after the first animation frame")
    ap.add_argument("--grep", help="list event names matching a substring (case-insensitive) and exit")
    ap.add_argument("--top", type=int, default=15, help="rows in the top-duration table")
    ap.add_argument("--vsync", type=float, default=13.33,
                    help="display refresh period in ms, for the cadence report")
    args = ap.parse_args()

    events = load_events(args.trace)

    # The recorded activity window, and the time origin for every printed
    # timestamp, is the first animation frame: metadata events are stamped
    # ts=0 and would otherwise put the origin ~25 minutes before the run.
    raf_all = [e["ts"] for e in events if e.get("name") == "FireAnimationFrame"]
    t0 = raf_all[0] if raf_all else events[0]["ts"]
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
    def sec_of(ts):
        return (ts - t0) / 1e6

    main_tid = next((e["tid"] for e in events if e.get("name") == "FireAnimationFrame"), None)

    print(f"\nAnimation frames (FireAnimationFrame): {len(frame_ts)}")
    gaps = [(b - a) / MS for a, b in zip(frame_ts, frame_ts[1:])]
    if gaps:
        cadence = (frame_ts[-1] - frame_ts[0]) / (len(frame_ts) - 1) / MS
        missed = sum(1 for g in gaps if g > 1.5 * args.vsync)
        print(f"  mean frame interval: {cadence:.2f} ms, "
              f"median {statistics.median(gaps):.2f} ms")
        print(f"  frames missing a {args.vsync:.2f} ms vsync slot "
              f"(gap > 1.5x): {missed} ({100*missed/len(gaps):.1f}%)")
        worst = sorted(range(len(gaps)), key=lambda i: -gaps[i])[:5]
        print("  largest gaps: "
              + ", ".join(f"frame {i}: {gaps[i]:.1f} ms" for i in worst))



    # --- Deoptimizations -------------------------------------------------
    deopts = [e for e in events if "Deoptimize" in e.get("name", "")]
    print(f"\nDeoptimization events: {len(deopts)}")
    for n, c in collections.Counter(e["name"] for e in deopts).most_common():
        print(f"  {c:7d}  {n}")
    if deopts:
        by_frame = collections.Counter(frame_of(e["ts"]) for e in deopts)
        dense = sorted(by_frame.items(), key=lambda x: -x[1])[:5]
        print("  frames with most deopt events: "
              + ", ".join(f"frame {f}: {c}" for f, c in dense))
        print(f"  distinct threads emitting deopts: "
              f"{len({e['tid'] for e in deopts})}")
        spacings = []
        by_tid = collections.defaultdict(list)
        for e in deopts:
            by_tid[e["tid"]].append(e["ts"])
        for ts in by_tid.values():
            spacings += [(b - a) / MS for a, b in zip(ts, ts[1:])]
        if spacings:
            print(f"  median per-thread spacing: {statistics.median(spacings):.2f} ms "
                  f"(compare the frame cadence above)")
        per_sec = collections.Counter(int(sec_of(e["ts"])) for e in deopts)
        hi = max(per_sec) if per_sec else 0
        print("  events per second: "
              + ", ".join(f"{s}s:{per_sec.get(s, 0)}" for s in range(hi + 1)))



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
        on_main = [e for e in gcs if e["tid"] == main_tid]
        print(f"  on the main thread: {len(on_main)} "
              f"(frames {[frame_of(e['ts']) for e in on_main][:8]})"
              if on_main else "  on the main thread: 0")



        # Burst analysis
        if gc_name == "MinorGC" and len(frame_ts) > 3:
            per_frame = collections.Counter(frame_of(e["ts"]) for e in gcs)
            if per_frame:
                f0 = max(per_frame,
                         key=lambda f: sum(per_frame.get(f + k, 0) for k in range(3)))
                burst = [e for e in gcs if f0 <= frame_of(e["ts"]) <= f0 + 2]
                span_ms = (max(e["ts"] for e in burst)
                           - min(e["ts"] for e in burst)) / MS
                per_tid = collections.Counter(e["tid"] for e in burst)
                reasons = collections.Counter(
                    e.get("args", {}).get("type", "?") for e in burst)
                print(f"  densest 3-frame burst: frames {f0}-{f0+2}, "
                      f"{len(burst)} collections in {span_ms:.0f} ms")
                print(f"    threads involved: {len(per_tid)}, "
                      f"per thread: {sorted(per_tid.values(), reverse=True)}")
                print(f"    tagged reasons: {dict(reasons)}")
                if gaps:
                    print("    rAF gaps of those frames: "
                          + ", ".join(f"{gaps[f]:.1f} ms"
                                      for f in range(f0 - 1, f0 + 2)
                                      if 0 <= f < len(gaps)))
                # Non-main-thread (worker) rate before and after the burst.
                def worker_rate(lo, hi):
                    n = sum(1 for e in gcs
                            if e["tid"] != main_tid and lo <= frame_of(e["ts"]) < hi)
                    return n, n / max(hi - lo, 1)
                before = worker_rate(max(f0 - 200, 0), f0)
                after = worker_rate(f0 + 10, len(frame_ts))
                print(f"    worker scavenges in the 200 frames before: {before[0]} "
                      f"({before[1]:.2f}/frame)")
                print(f"    worker scavenges after the burst:          {after[0]} "
                      f"({after[1]:.2f}/frame)")
                d_before = sum(1 for e in deopts if f0 - 50 <= frame_of(e["ts"]) < f0)
                d_after = sum(1 for e in deopts if f0 < frame_of(e["ts"]) <= f0 + 50)
                print(f"    deopts in the 50 frames before / after: "
                      f"{d_before} / {d_after}")



    # --- WebAssembly compilation -----------------------------------------
    wasm = [e for e in events
            if "wasm" in e.get("name", "").lower() or "Wasm" in e.get("name", "")]
    print(f"\nWebAssembly-related events: {len(wasm)}")
    for e in wasm[:10]:
        dur = e.get("dur", 0) / MS
        print(f"  t={sec_of(e['ts']):8.3f}s  {e['name']}  ({dur:.3f} ms)")
    compile_evs = [e for e in wasm if "compile" in e.get("name", "").lower()]
    if compile_evs:
        first, last = compile_evs[0], compile_evs[-1]
        print(f"  streaming compilation spans "
              f"{sec_of(last['ts']) - sec_of(first['ts']):.4f} s across "
              f"{len(compile_evs)} events, longest "
              f"{max(e.get('dur', 0) for e in compile_evs)/MS:.3f} ms")



    # --- Worker lifecycle -------------------------------------------------
    spawns = [e for e in events
              if e.get("name") == "DedicatedWorkerHostFactoryImpl::"
                                 "CreateWorkerHostAndStartScriptLoad"]
    if spawns:
        print(f"\nDedicated workers created: {len(spawns)}, "
              f"t={sec_of(spawns[0]['ts']):.3f}s to {sec_of(spawns[-1]['ts']):.3f}s")
    for n in ("InputLatency::MouseUp", "InputLatency::MouseDown"):
        ts = [sec_of(e["ts"]) for e in events if e.get("name") == n]
        if ts:
            print(f"  {n}: " + ", ".join(f"{t:.3f}s" for t in ts[:6]))
    # Threads that stop early / start late bracket a teardown-and-respawn.
    by_tid = collections.defaultdict(list)
    for e in events:
        by_tid[e["tid"]].append(e["ts"])
    busy = {tid: v for tid, v in by_tid.items() if len(v) > 100}
    ended = sorted((sec_of(max(v)), tid) for tid, v in busy.items()
                   if sec_of(max(v)) < span_s - 1.0)
    started = sorted((sec_of(min(v)), tid) for tid, v in busy.items()
                     if sec_of(min(v)) > 1.0)
    if ended:
        print(f"  {len(ended)} busy threads end early, "
              f"t={ended[0][0]:.2f}s to {ended[-1][0]:.2f}s")
    if started:
        print(f"  {len(started)} busy threads start late, "
              f"t={started[0][0]:.2f}s to {started[-1][0]:.2f}s")




    # --- Heaviest event types (complete events with duration) -------------
    by_name = collections.defaultdict(float)
    for e in events:
        if "dur" in e:
            by_name[e["name"]] += e["dur"]
    print(f"\nTop {args.top} event types by total duration:")
    for n, d in sorted(by_name.items(), key=lambda x: -x[1])[:args.top]:
        print(f"  {d/MS:10.1f} ms  {names[n]:7d}x  {n}")

    tasks = [e for e in events
             if e.get("name") == "RunTask" and "dur" in e and e["tid"] == main_tid]
    if tasks:
        tasks.sort(key=lambda e: -e["dur"])
        print("\nHeaviest main-thread tasks:")
        for e in tasks[:5]:
            print(f"  {e['dur']/MS:7.1f} ms at t={sec_of(e['ts']):7.3f}s "
                  f"(frame {frame_of(e['ts'])})")


if __name__ == "__main__":
    sys.exit(main())
