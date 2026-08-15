# Benchmark data and analysis pipeline


Each CSV is one recorded run: 1000 frames of per-frame `PhysicsTime_ms`
and `RenderTime_ms`, exported by the app's "Export Benchmark CSV" button.

## Layout

```
data/
  multirun/   Main campaign: 99 runs of 1000 frames,
              <Browser>_<Engine>_<AsteroidCount>_run<K>.csv.
              Chrome N ∈ {500..10000} (3-6 runs each), Firefox {5000,5500,6000}.
  pilot/      Pilot campaign: single runs per configuration,
              <Engine>_<AsteroidCount>.csv per browser, including the
              -ffast-math control builds (WASM_*_ffast.csv).
traces/       Chrome DevTools performance traces (gzipped JSON,
              Trace Event Format): a JavaScript run at the 5500-asteroid
              cadence, and a live JS-to-WASM engine switch.
figures/      Rendered analysis figures (multirun/ feeds the thesis).
```

## Scripts

Create the environment once:

```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt
```

- `analyze_multirun.py` — the Chapter 5 pipeline. Aggregates every run in
  `data/multirun/` (per-run and steady-state statistics, Welch tests on
  per-run means, T0 + cN² fits, 60 FPS budget interpolation) and renders
  the thesis figures into `figures/multirun/`.

  ```bash
  venv/bin/python analyze_multirun.py
  ```

- `analyze_pilot.py` — single-configuration WASM-vs-JS comparison from the
  pilot campaign: `venv/bin/python analyze_pilot.py 5500 chrome`.

- `trace_analysis.py` — event-level summary of the DevTools traces
  (deoptimization counts and their frame positions, GC frequency and
  duration, WebAssembly streaming-compilation events, per-event-type
  totals). The traces are standard Trace Event Format JSON, so every
  reported number can be cross-checked by loading the same file into the
  DevTools Performance panel ("Load profile...") or https://ui.perfetto.dev.

  ```bash
  venv/bin/python trace_analysis.py traces/Trace-JStoWASM_switch.json.gz
  venv/bin/python trace_analysis.py traces/Trace-JS.json.gz --grep Deopt
  ```
