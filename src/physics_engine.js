export class PhysicsEngineJS {
    constructor(maxBodies){
        this.maxBodies = maxBodies; 
        this.bodyCount = 0; 
        this.G = 1;
        
        this.posMassBuffer = new SharedArrayBuffer(this.maxBodies * 4 * Float64Array.BYTES_PER_ELEMENT); 
        this.velBuffer     = new SharedArrayBuffer(this.maxBodies * 3 * Float64Array.BYTES_PER_ELEMENT);
        this.accelBuffer   = new SharedArrayBuffer(this.maxBodies * 3 * Float64Array.BYTES_PER_ELEMENT);

        this.posMass = new Float64Array(this.posMassBuffer); 
        this.vel     = new Float64Array(this.velBuffer);
        this.accel   = new Float64Array(this.accelBuffer);

        this.numWorkers = 4;
        this.workers = [];
        
        for (let i = 0; i < this.numWorkers; i++) {
            const worker = new Worker(new URL('./physics_worker.js', import.meta.url), { type: 'module' });
            worker.postMessage({
                type: 'init',
                posMassBuffer: this.posMassBuffer,
                velBuffer: this.velBuffer,
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
            let completed = 0;
            const chunkSize = Math.ceil(this.bodyCount / this.numWorkers);
            
            for (let w = 0; w < this.numWorkers; w++) {
                const start = w * chunkSize;
                const end = Math.min(start + chunkSize, this.bodyCount);
                
                if (start >= this.bodyCount) {
                    completed++;
                    continue;
                }

                this.workers[w].onmessage = (e) => {
                    if (e.data.done) {
                        completed++;
                        if (completed === this.numWorkers) resolve();
                    }
                };

                this.workers[w].postMessage({
                    type: 'compute',
                    id: w,
                    bodyCount: this.bodyCount,
                    start: start,
                    end: end
                });
            }
            if (completed === this.numWorkers) resolve();
        });
    }
}