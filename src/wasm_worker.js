import createModule from '../cpp/physics_wasm.js';

let Module = null;

function locateFile(path) {
    return new URL(`../cpp/${path}`, import.meta.url).href;
}

self.onmessage = async (e) => {
    const data = e.data;
    const requestId = data.requestId;

    try {
        if (data.type === 'init') {
            // Load the Emscripten module (and its pthread pool) only once;
            // subsequent resets re-initialize the engine state in place.
            if (!Module) {
                Module = await createModule({ locateFile });
            }
            Module._initEngine(data.maxBodies);

            const posMassPtr = Module._getPosMassPointer();
            const velPtr = Module._getVelPointer();

            self.postMessage({
                type: 'init_done',
                requestId,
                buffer: Module.HEAPF64.buffer,
                posMassPtr,
                velPtr,
                // Echo the body count so the main thread sizes its heap views
                // from this request, not from whatever its globals say by the
                // time the response arrives.
                maxBodies: data.maxBodies,
            });
        } else if (data.type === 'preCalc') {
            Module._preCalculateAccelerations();
            self.postMessage({ type: 'done', requestId });
        } else if (data.type === 'step') {
            Module._stepPhysics(data.dt);
            self.postMessage({ type: 'done', requestId });
        }
    } catch (err) {
        self.postMessage({ type: 'error', requestId, message: err.message, stack: err.stack });
    }
};
