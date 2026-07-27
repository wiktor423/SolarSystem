export class PhysicsEngineJS {
    constructor(maxBodies){
        this.maxBodies = maxBodies;
        this.bodyCount = 0;

        this.posMassBuffer = new SharedArrayBuffer(this.maxBodies * 4 * Float64Array.BYTES_PER_ELEMENT);
        this.velBuffer     = new SharedArrayBuffer(this.maxBodies * 3 * Float64Array.BYTES_PER_ELEMENT);
        this.accelBuffer   = new SharedArrayBuffer(this.maxBodies * 3 * Float64Array.BYTES_PER_ELEMENT);

        this.posMass = new Float64Array(this.posMassBuffer);
        this.vel     = new Float64Array(this.velBuffer);
        this.accel   = new Float64Array(this.accelBuffer);

        this.numWorkers = 16;
        this.workers = [];
        this._computeResolve = null;
        this._computeCompleted = 0;

        for (let i = 0; i < this.numWorkers; i++) {
            const worker = new Worker(new URL('./physics_worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => {
                if (e.data.done) {
                    this._computeCompleted++;
                    if (this._computeCompleted === this.numWorkers && this._computeResolve) {
                        this._computeResolve();
                        this._computeResolve = null;
                    }
                }
            };
            // Workers only read posMass and write accel; vel stays main-thread-only.
            worker.postMessage({
                type: 'init',
                posMassBuffer: this.posMassBuffer,
                accelBuffer: this.accelBuffer
            });
            this.workers.push(worker);
        }
    }

    async preCalculateAccelerations(currentCount) {
        this.bodyCount = currentCount;
        await this.computeAccelerations();
    }

    async step(dt){
        // 1. Update positions and half-step velocities
        for (let i = 0; i < this.bodyCount; i++) {
            let iPM = i * 4;
            let i3  = i * 3;

            let ax = this.accel[i3 + 0]; 
            let ay = this.accel[i3 + 1];
            let az = this.accel[i3 + 2];

            // x = x + v*dt + 0.5*a*dt^2
            this.posMass[iPM + 0] += this.vel[i3 + 0] * dt + 0.5 * ax * dt * dt;
            this.posMass[iPM + 1] += this.vel[i3 + 1] * dt + 0.5 * ay * dt * dt;
            this.posMass[iPM + 2] += this.vel[i3 + 2] * dt + 0.5 * az * dt * dt;

            // half-step the velocity 
            this.vel[i3 + 0] += 0.5 * ax * dt;
            this.vel[i3 + 1] += 0.5 * ay * dt;
            this.vel[i3 + 2] += 0.5 * az * dt;
       }

       
       await this.computeAccelerations();
       
       for (let i = 0; i < this.bodyCount; i++) {
            let i3 = i * 3;

            this.vel[i3 + 0] += 0.5 * this.accel[i3 + 0] * dt;
            this.vel[i3 + 1] += 0.5 * this.accel[i3 + 1] * dt;
            this.vel[i3 + 2] += 0.5 * this.accel[i3 + 2] * dt;
        }
    }
 
    computeAccelerations(){
        return new Promise((resolve) => {
            this._computeResolve = resolve;
            this._computeCompleted = 0;
            const chunkSize = Math.ceil(this.bodyCount / this.numWorkers);

            for (let w = 0; w < this.numWorkers; w++) {
                const start = w * chunkSize;
                const end = Math.min(start + chunkSize, this.bodyCount);

                if (start >= this.bodyCount) {
                    this._computeCompleted++;
                    continue;
                }

                this.workers[w].postMessage({
                    type: 'compute',
                    id: w,
                    bodyCount: this.bodyCount,
                    start,
                    end
                });
            }

            if (this._computeCompleted === this.numWorkers) {
                this._computeResolve = null;
                resolve();
            }
        });
    }

    dispose() {
        // Resolve any pending computeAccelerations() promise so that an
        // in-flight step() call in the render loop can return instead of
        // hanging forever after the workers are terminated.
        if (this._computeResolve) {
            this._computeResolve();
            this._computeResolve = null;
        }
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }
}