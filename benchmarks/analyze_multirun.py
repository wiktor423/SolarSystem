
import glob
import os
import re

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats as sps

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(HERE, "data", "multirun")
OUT_DIR = os.path.join(HERE, "figures", "multirun")
os.makedirs(OUT_DIR, exist_ok=True)

BUDGET = 16.67            # 60 FPS frame budget, ms
STEADY = slice(520, 990)  # post-stabilization window (event sits at 503-505)

COL_JS = "#e74c3c"
COL_WASM = "#2980b9"

plt.style.use("ggplot")
plt.rcParams["savefig.dpi"] = 300




def load_all():
    """-> {(browser, engine, count, run): Series of PhysicsTime_ms}"""
    data = {}
    for f in sorted(glob.glob(os.path.join(CSV_DIR, "*.csv"))):
        m = re.match(r"(\w+?)_(JS|WASM)_(\d+)_run(\d+)\.csv", os.path.basename(f))
        if not m:
            continue
        key = (m.group(1), m.group(2), int(m.group(3)), int(m.group(4)))
        data[key] = pd.read_csv(f)["PhysicsTime_ms"]
    return data


DATA = load_all()


def runs(browser, engine, count):
    return [p for (b, e, n, _), p in sorted(DATA.items()) if (b, e, n) == (browser, engine, count)]


def counts(browser):
    return sorted({n for (b, _, n, _) in DATA if b == browser})


# stats

def config_stats(browser, engine, count):
    rs = runs(browser, engine, count)
    means = np.array([p.mean() for p in rs])
    ss_means = np.array([p.iloc[STEADY].mean() for p in rs])
    over = np.array([(p > BUDGET).sum() for p in rs])
    ss_over = np.array([(p.iloc[STEADY] > BUDGET).sum() for p in rs])
    pooled = pd.concat(rs)
    return dict(
        runs=len(rs),
        mean=means.mean(), mean_sd=means.std(ddof=1) if len(rs) > 1 else np.nan,
        median=pooled.median(), p95=pooled.quantile(0.95), max=pooled.max(),
        over_mean=over.mean(), over_min=over.min(), over_max=over.max(),
        ss_mean=ss_means.mean(), ss_sd=ss_means.std(ddof=1) if len(rs) > 1 else np.nan,
        ss_over_pct=100 * ss_over.mean() / len(rs[0].iloc[STEADY]),
        run_means=means, ss_run_means=ss_means,
    )


def summary_table(browser):
    print(f"\n=== {browser}: aggregated summary (whole-run / steady-state) ===")
    hdr = (f'{"Na":>6} {"eng":>5} {"runs":>4} {"mean":>7} {"+-sd":>6} {"median":>7} '
           f'{"P95":>7} {"max":>8} {"over(min-max)":>15} {"ss_mean":>8} {"+-sd":>6} {"ss>bdg%":>8}')
    print(hdr)
    for n in counts(browser):
        for eng in ("JS", "WASM"):
            if not runs(browser, eng, n):
                continue
            s = config_stats(browser, eng, n)
            print(f'{n:>6} {eng:>5} {s["runs"]:>4} {s["mean"]:>7.2f} {s["mean_sd"]:>6.2f} '
                  f'{s["median"]:>7.2f} {s["p95"]:>7.2f} {s["max"]:>8.2f} '
                  f'{s["over_mean"]:>7.1f} ({s["over_min"]:>3}-{s["over_max"]:>3}) '
                  f'{s["ss_mean"]:>8.2f} {s["ss_sd"]:>6.2f} {s["ss_over_pct"]:>8.1f}')


def speedups(browser):
    print(f"\n=== {browser}: speedup T_JS / T_WASM ===")
    for n in counts(browser):
        j, w = runs(browser, "JS", n), runs(browser, "WASM", n)
        if not j or not w:
            continue
        sj, sw = config_stats(browser, "JS", n), config_stats(browser, "WASM", n)
        whole = sj["mean"] / sw["mean"]
        steady = sj["ss_mean"] / sw["ss_mean"]
        # Welch t-test on per-run steady-state means
        p = np.nan
        if len(j) > 1 and len(w) > 1:
            p = sps.ttest_ind(sj["ss_run_means"], sw["ss_run_means"], equal_var=False).pvalue
        print(f"Na={n:>6}: whole={whole:.3f}  steady={steady:.3f}  "
              f"welch_p(steady, run means)={p:.4f}")


def fit_model(browser, engine, use_steady=True):
    ns = np.array([n for n in counts(browser) if runs(browser, engine, n)])
    t = np.array([config_stats(browser, engine, n)["ss_mean" if use_steady else "mean"]
                  for n in ns])
    N2 = (ns + 9.0) ** 2  # total bodies: asteroids + Sun + 8 planets
    A = np.vstack([np.ones_like(N2), N2]).T
    (t0, c), res, *_ = np.linalg.lstsq(A, t, rcond=None)
    ss_tot = ((t - t.mean()) ** 2).sum()
    r2 = 1 - res[0] / ss_tot if len(res) else 1.0
    return t0, c, r2, ns, t


def model_report(browser):
    print(f"\n=== {browser}: cost model T = T0 + c*N^2 (steady-state means) ===")
    out = {}
    for eng in ("JS", "WASM"):
        t0, c, r2, ns, t = fit_model(browser, eng)
        out[eng] = (t0, c)
        print(f"{eng:>5}: T0={t0:.3f} ms  c={c:.4e} ms/body^2  R2={r2:.5f}  ({len(ns)} counts)")
    if "JS" in out and "WASM" in out:
        (t0j, cj), (t0w, cw) = out["JS"], out["WASM"]
        print(f"kernel throughput ratio c_JS/c_WASM = {cj/cw:.3f}")
        if (t0w - t0j) * (cj - cw) > 0:
            n_x = np.sqrt((t0w - t0j) / (cj - cw))
            print(f"fitted crossover at N = {n_x:.0f}")
        for eng, (t0, c) in out.items():
            n_b = np.sqrt((BUDGET - t0) / c)
            print(f"{eng}: N where steady mean hits {BUDGET} ms budget: {n_b:.0f}")
    return out


def spike_report():
    print("\n=== Chrome JS stabilization event (frames 500-510 window) ===")
    peaks = {}
    for (b, e, n, r), p in sorted(DATA.items()):
        if (b, e) != ("Chrome", "JS"):
            continue
        w = p.iloc[500:510]
        peaks.setdefault(n, []).append((w.idxmax(), w.max(), w.max() / p.median()))
    aligned = 0
    total = 0
    for n, lst in sorted(peaks.items()):
        for f, v, ratio in lst:
            total += 1
            aligned += 503 <= f <= 505
        pk = ", ".join(f"fr{f}:{v:.1f}ms({ratio:.1f}x)" for f, v, ratio in lst)
        print(f"Na={n:>6}: {pk}")
    print(f"peak inside frames 503-505 in {aligned}/{total} runs")


def wasm_settle_report():
    print("\n=== Chrome WASM early-phase elevation: mean(0-300) vs mean(600-990) ===")
    for n in counts("Chrome"):
        for p in runs("Chrome", "WASM", n):
            a, b = p.iloc[0:300].mean(), p.iloc[600:990].mean()
            if n >= 4500:
                print(f"Na={n:>6}: early={a:6.2f}  late={b:6.2f}  diff={a-b:+5.2f} ({100*(a-b)/b:+5.1f}%)")


# figures

def fig_scaling_chrome():
    ns = np.array(counts("Chrome"))
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(10, 8.4), sharex=True,
        gridspec_kw={"height_ratios": [2.4, 1.0]}, constrained_layout=True)

    for eng, col, label in (("JS", COL_JS, "JavaScript (V8)"),
                            ("WASM", COL_WASM, "WebAssembly (C++)")):
        m = np.array([config_stats("Chrome", eng, n)["ss_mean"] for n in ns])
        ax1.plot(ns, m, "-o", color=col, linewidth=2, markersize=6, label=label, zorder=3)
        for n in ns:
            rm = config_stats("Chrome", eng, n)["ss_run_means"]
            ax1.plot([n] * len(rm), rm, "o", color=col, markersize=3, alpha=0.45, zorder=2)
    t0, c, _, _, _ = fit_model("Chrome", "WASM")
    nn = np.linspace(ns.min(), ns.max(), 200)
    ax1.plot(nn, t0 + c * (nn + 9) ** 2, ":", color="0.45", linewidth=1.6,
             label=r"$T_0 + cN^2$ fit (WASM, steady state)", zorder=1)
    ax1.axhline(BUDGET, color="black", linestyle="--", alpha=0.8, linewidth=1.2,
                label="60 FPS budget (16.67 ms)")
    ax1.set_xscale("log")
    ax1.set_yscale("log")
    ax1.set_xticks(ns)
    ax1.set_xticklabels([str(n) for n in ns], rotation=55, fontsize=9)
    ax1.set_yticks([1, 2, 4, 8, 16.67, 32, 64])
    ax1.set_yticklabels(["1", "2", "4", "8", "16.67", "32", "64"])
    ax1.set_ylabel("Steady-state mean step time (ms)", fontsize=12, fontweight="bold")
    ax1.set_title("Physics Step Scaling, Chrome",
                  fontsize=15, fontweight="bold")
    ax1.legend(loc="upper left", frameon=True, fontsize=10)

    for key, style, lbl in (("ss_mean", "-o", "steady state (frames 520–990)"),
                            ("mean", "--s", "whole run (frames 0–999)")):
        ratio = np.array([config_stats("Chrome", "JS", n)[key] /
                          config_stats("Chrome", "WASM", n)[key] for n in ns])
        ax2.plot(ns, ratio, style, color="#8e44ad", linewidth=2, markersize=5,
                 alpha=1.0 if key == "ss_mean" else 0.55, label=lbl)
    ax2.axhline(1.0, color="black", linestyle=":", alpha=0.8, linewidth=1.2)
    ax2.set_xscale("log")
    ax2.set_xticks(ns)
    ax2.set_xticklabels([str(n) for n in ns], rotation=55, fontsize=9)
    ax2.set_ylabel(r"Speedup $T_{\mathrm{JS}}/T_{\mathrm{WASM}}$",
                   fontsize=12, fontweight="bold")
    ax2.set_xlabel("Asteroid count $N_a$", fontsize=12, fontweight="bold")
    ax2.legend(loc="upper left", frameon=True, fontsize=10)
    fig.savefig(os.path.join(OUT_DIR, "bench_scaling_chrome.png"), bbox_inches="tight")
    plt.close(fig)


def fig_multirun(browser, count, fname):
    fig, ax = plt.subplots(figsize=(10, 6))
    nj = nw = 0
    for p in runs(browser, "WASM", count):
        ax.plot(p.index, p, color=COL_WASM, linewidth=0.9, alpha=0.55)
        nw += 1
    for p in runs(browser, "JS", count):
        ax.plot(p.index, p, color=COL_JS, linewidth=0.9, alpha=0.55)
        nj += 1
    ax.axhline(BUDGET, color="black", linestyle="--", alpha=0.8,
               label="60 FPS budget (16.67 ms)")
    js_engine = {"Chrome": "V8", "Firefox": "SpiderMonkey"}[browser]
    ax.plot([], [], color=COL_JS, linewidth=1.5, label=f"JavaScript ({js_engine}), {nj} runs")
    ax.plot([], [], color=COL_WASM, linewidth=1.5, label=f"WebAssembly (C++), {nw} runs")
    ax.set_title(f"All Runs Overlaid: {count} Asteroids, {browser}",
                 fontsize=15, fontweight="bold")
    ax.set_xlabel("Frame number", fontsize=12, fontweight="bold")
    ax.set_ylabel("Physics step time (ms)", fontsize=12, fontweight="bold")
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper right", frameon=True, fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, fname), bbox_inches="tight")
    plt.close(fig)


def fig_spike():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5), constrained_layout=True)

    n_runs = 0
    for (b, e, n, r), p in sorted(DATA.items()):
        if (b, e) != ("Chrome", "JS") or n < 1500:
            continue
        seg = p.iloc[460:561] / p.median()
        ax1.plot(seg.index, seg, color=COL_JS, linewidth=0.8, alpha=0.35)
        n_runs += 1
    ax1.axvspan(503, 505, color="0.55", alpha=0.25, zorder=0)
    ax1.set_title(f"Stabilization Event Alignment\n({n_runs} Chrome JS runs, "
                  r"$N_a \geq 1500$)", fontsize=13, fontweight="bold")
    ax1.set_xlabel("Frame number", fontsize=11, fontweight="bold")
    ax1.set_ylabel("Step time / run median", fontsize=11, fontweight="bold")
    ax1.annotate("frames 503–505", xy=(504, 4.15), ha="center", fontsize=10,
                 fontweight="bold", color="0.25")

    meds, peaks = [], []
    for (b, e, n, r), p in sorted(DATA.items()):
        if (b, e) != ("Chrome", "JS"):
            continue
        meds.append(p.median())
        peaks.append(p.iloc[500:510].max())
    meds, peaks = np.array(meds), np.array(peaks)
    ax2.plot(meds, peaks, "o", color=COL_JS, markersize=5, alpha=0.7,
             label="per-run event peak")
    mm = np.linspace(0, meds.max(), 100)
    ax2.plot(mm, 4 * mm, "--", color="0.35", linewidth=1.2,
             label=r"$4\times$ run median")
    ax2.set_title("Event Magnitude vs. Per-Frame Workload",
                  fontsize=13, fontweight="bold")
    ax2.set_xlabel("Run median step time (ms)", fontsize=11, fontweight="bold")
    ax2.set_ylabel("Peak step time, frames 500–510 (ms)",
                   fontsize=11, fontweight="bold")
    ax2.set_xlim(left=0)
    ax2.set_ylim(bottom=0)
    ax2.legend(loc="upper left", frameon=True, fontsize=10)
    fig.savefig(os.path.join(OUT_DIR, "bench_spike_alignment.png"), bbox_inches="tight")
    plt.close(fig)


def fig_wasm_6000():
    fig, ax = plt.subplots(figsize=(10, 6))
    for i, p in enumerate(runs("Chrome", "WASM", 6000)):
        ax.plot(p.index, p, color=COL_WASM, linewidth=0.6, alpha=0.25)
        roll = p.rolling(25, center=True).mean()
        ax.plot(roll.index, roll, color=COL_WASM, linewidth=1.6, alpha=0.9)
    for i, p in enumerate(runs("Chrome", "WASM", 7000)):
        roll = p.rolling(25, center=True).mean()
        ax.plot(roll.index, roll, color="0.45", linewidth=1.2, alpha=0.8)
    ax.axhline(BUDGET, color="black", linestyle="--", alpha=0.8,
               label="60 FPS budget (16.67 ms)")
    ax.plot([], [], color=COL_WASM, linewidth=1.6,
            label="$N_a$ = 6000, 5 runs (25-frame rolling mean)")
    ax.plot([], [], color="0.45", linewidth=1.2,
            label="$N_a$ = 7000, 3 runs (rolling mean)")
    ax.set_title("WebAssembly Run-to-Run Variability at 6000 Asteroids, Chrome",
                 fontsize=14, fontweight="bold")
    ax.set_xlabel("Frame number", fontsize=12, fontweight="bold")
    ax.set_ylabel("Physics step time (ms)", fontsize=12, fontweight="bold")
    ax.set_ylim(bottom=0)
    ax.legend(loc="lower right", frameon=True, fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "bench_wasm_6000.png"), bbox_inches="tight")
    plt.close(fig)


# main

if __name__ == "__main__":
    for browser in ("Chrome", "Firefox"):
        summary_table(browser)
        speedups(browser)
        model_report(browser)
    spike_report()
    wasm_settle_report()

    fig_scaling_chrome()
    fig_multirun("Chrome", 5500, "bench_multirun_chrome_5500.png")
    fig_multirun("Firefox", 5500, "bench_multirun_firefox_5500.png")
    fig_spike()
    fig_wasm_6000()
    print(f"\nFigures written to {OUT_DIR}")
