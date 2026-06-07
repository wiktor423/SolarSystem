import createModule from '../cpp/physics_wasm.js';

let Module = null;

function locateFile(path) {
    return new URL(`../cpp/${path}`, import.meta.url).href;
}

self.onmessage = async (e) => {
    const data = e.data;

    try {
        if (data.type === 'init') {
            Module = await createModule({ locateFile });
            Module._initEngine(data.maxBodies);

            const posMassPtr = Module._getPosMassPointer();
            const velPtr = Module._getVelPointer();

            self.postMessage({
                type: 'init_done',
                buffer: Module.HEAPF64.buffer,
                posMassPtr,
                velPtr,
            });
        } else if (data.type === 'preCalc') {
            Module._preCalculateAccelerations();
            self.postMessage({ type: 'done' });
        } else if (data.type === 'step') {
            Module._stepPhysics(data.dt);
            self.postMessage({ type: 'done' });
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message, stack: err.stack });
        throw err;
    }
};
