#!/usr/bin/env bash
set -euo pipefail

emcc cpp/physics_engine.cpp -o cpp/physics_wasm.js \
  -pthread \
  -s USE_PTHREADS=1 \
  -s PTHREAD_POOL_SIZE=12 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME='createModule' \
  -s EXPORTED_FUNCTIONS='["_initEngine","_getPosMassPointer","_getVelPointer","_preCalculateAccelerations","_stepPhysics"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF64"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web,worker \
  -O3 -msimd128

echo "Built cpp/physics_wasm.js with 4 pthread workers"
