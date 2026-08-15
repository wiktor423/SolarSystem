"""Pilot-campaign analysis: single-run WASM-vs-JS comparison at one body count.

Usage: venv/bin/python analyze_pilot.py [count] [browser]
Reads data/pilot/<browser>/{WASM,JS}_<count>.csv, prints summary statistics,
and saves a comparison plot to figures/pilot/<browser>/.
"""
import os
import sys

import pandas as pd
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))

count = sys.argv[1] if len(sys.argv) > 1 else "5000"
browser = sys.argv[2] if len(sys.argv) > 2 else "chrome"
js_engine = {"chrome": "V8", "firefox": "SpiderMonkey"}[browser]
wasm_file = os.path.join(HERE, f"data/pilot/{browser}/WASM_{count}.csv")
js_file = os.path.join(HERE, f"data/pilot/{browser}/JS_{count}.csv")

df_wasm = pd.read_csv(wasm_file)
df_js = pd.read_csv(js_file)

asteroid_count = df_wasm['AsteroidCount'].iloc[0]

avg_frame_time_wasm = df_wasm['PhysicsTime_ms'].mean()
avg_frame_time_js = df_js['PhysicsTime_ms'].mean() 

print("-----", asteroid_count, "------")

print("WASM Statistics:")
print(f"Mean: {df_wasm['PhysicsTime_ms'].mean():.2f} ms")
print(f"Median: {df_wasm['PhysicsTime_ms'].median():.2f} ms")
print(f"Std: {df_wasm['PhysicsTime_ms'].std():.2f} ms")
print(f"Min: {df_wasm['PhysicsTime_ms'].min():.2f} ms")
print(f"Max: {df_wasm['PhysicsTime_ms'].max():.2f} ms")
print(f"95th percentile: {df_wasm['PhysicsTime_ms'].quantile(0.95):.2f} ms")

slow_frames = (df_wasm['PhysicsTime_ms'] > 16.67).sum()
print(f"Frames above 16.67 ms: {slow_frames}") 

print("\n")

print("JS Statistics:")
print(f"Mean: {df_js['PhysicsTime_ms'].mean():.2f} ms")
print(f"Median: {df_js['PhysicsTime_ms'].median():.2f} ms")
print(f"Std: {df_js['PhysicsTime_ms'].std():.2f} ms")
print(f"Min: {df_js['PhysicsTime_ms'].min():.2f} ms")
print(f"Max: {df_js['PhysicsTime_ms'].max():.2f} ms")
print(f"95th percentile: {df_js['PhysicsTime_ms'].quantile(0.95):.2f} ms")

slow_frames = (df_js['PhysicsTime_ms'] > 16.67).sum()
print(f"Frames above 16.67 ms: {slow_frames}")

print(f"\nMean speedup (T_JS / T_WASM): {avg_frame_time_js / avg_frame_time_wasm:.2f}x")

print("\n")


plt.figure(figsize=(10, 6))
plt.style.use('ggplot')


plt.plot(df_wasm['Frame'], df_wasm['PhysicsTime_ms'], 
         label='WASM (C++) Execution', color='#2980b9', linewidth=1.5)

#plt.plot(df_wasm['Frame'], df_wasm['RenderTime_ms'], 
#        label='Render Time', color='#f39c12', linewidth=1.5)

plt.plot(df_js['Frame'], df_js['PhysicsTime_ms'], 
         label=f'JavaScript ({js_engine}) Execution', color='#e74c3c', linewidth=1.5, alpha=0.7)

# 5. Add the "60 FPS Threshold" line
plt.axhline(y=16.67, color='black', linestyle='--', alpha=0.8, 
            label='60 FPS Budget (16.67ms)')

# 6. Make the labels look highly professional
plt.title(f'Engine Physics Benchmark Comparison: {asteroid_count} Bodies', fontsize=16, fontweight='bold', pad=15)
plt.xlabel('Frame Number', fontsize=12, fontweight='bold')
plt.ylabel('Execution Time (milliseconds)', fontsize=12, fontweight='bold')

# 7. Add a legend to explain the lines
plt.legend(loc='upper right', frameon=True, shadow=True, fontsize=11)

# 8. Set the Y-axis to start at 0 so the scale is honest
plt.ylim(bottom=0)

# 9. Clean up the layout and save the high-res image directly to your folder!
plt.tight_layout()
plt.savefig(os.path.join(HERE, f'figures/pilot/{browser}/benchmark_comparison_{asteroid_count}.png'), dpi=300, bbox_inches='tight')
