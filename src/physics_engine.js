export const BODY_STRIDE = 10;
export const BODY_X = 0;
export const BODY_Y = 1;
export const BODY_Z = 2;
export const BODY_MASS = 3;
export const BODY_VX = 4;
export const BODY_VY = 5;
export const BODY_VZ = 6;
export const BODY_AX = 7;
export const BODY_AY = 8;
export const BODY_AZ = 9;

export class PhysicsEngineJS {
    constructor(maxBodies) {
        this.maxBodies = maxBodies;
        this.bodyCount = 0;
        this.G = 1;

        this.bodies = new Float64Array(this.maxBodies * BODY_STRIDE);
    }

    preCalculateAccelerations(currentCount) {
        this.bodyCount = currentCount;
        this.computeAccelerations();
    }

    step(dt) {
        for (let i = 0; i < this.bodyCount; i++) {
            const base = i * BODY_STRIDE;

            const ax = this.bodies[base + BODY_AX];
            const ay = this.bodies[base + BODY_AY];
            const az = this.bodies[base + BODY_AZ];

            this.bodies[base + BODY_X] += this.bodies[base + BODY_VX] * dt + 0.5 * ax * dt * dt;
            this.bodies[base + BODY_Y] += this.bodies[base + BODY_VY] * dt + 0.5 * ay * dt * dt;
            this.bodies[base + BODY_Z] += this.bodies[base + BODY_VZ] * dt + 0.5 * az * dt * dt;

            this.bodies[base + BODY_VX] += 0.5 * ax * dt;
            this.bodies[base + BODY_VY] += 0.5 * ay * dt;
            this.bodies[base + BODY_VZ] += 0.5 * az * dt;
        }

        this.computeAccelerations();

        for (let i = 0; i < this.bodyCount; i++) {
            const base = i * BODY_STRIDE;

            this.bodies[base + BODY_VX] += 0.5 * this.bodies[base + BODY_AX] * dt;
            this.bodies[base + BODY_VY] += 0.5 * this.bodies[base + BODY_AY] * dt;
            this.bodies[base + BODY_VZ] += 0.5 * this.bodies[base + BODY_AZ] * dt;
        }
    }

    computeAccelerations() {
        for (let i = 0; i < this.bodyCount; i++) {
            const base = i * BODY_STRIDE;

            this.bodies[base + BODY_AX] = 0;
            this.bodies[base + BODY_AY] = 0;
            this.bodies[base + BODY_AZ] = 0;
        }

        for (let i = 0; i < this.bodyCount; i++) {
            const iBase = i * BODY_STRIDE;

            const xi = this.bodies[iBase + BODY_X];
            const yi = this.bodies[iBase + BODY_Y];
            const zi = this.bodies[iBase + BODY_Z];
            const massI = this.bodies[iBase + BODY_MASS];

            let accXi = this.bodies[iBase + BODY_AX];
            let accYi = this.bodies[iBase + BODY_AY];
            let accZi = this.bodies[iBase + BODY_AZ];

            for (let j = i + 1; j < this.bodyCount; j++) {
                const jBase = j * BODY_STRIDE;

                const xj = this.bodies[jBase + BODY_X];
                const yj = this.bodies[jBase + BODY_Y];
                const zj = this.bodies[jBase + BODY_Z];
                const massJ = this.bodies[jBase + BODY_MASS];

                const dx = xj - xi;
                const dy = yj - yi;
                const dz = zj - zi;

                const distSq = dx * dx + dy * dy + dz * dz + 0.0001;
                const dist = Math.sqrt(distSq);

                const G_over_r3 = this.G / (distSq * dist);
                const fx = G_over_r3 * dx;
                const fy = G_over_r3 * dy;
                const fz = G_over_r3 * dz;

                accXi += massJ * fx;
                accYi += massJ * fy;
                accZi += massJ * fz;

                this.bodies[jBase + BODY_AX] -= massI * fx;
                this.bodies[jBase + BODY_AY] -= massI * fy;
                this.bodies[jBase + BODY_AZ] -= massI * fz;
            }

            this.bodies[iBase + BODY_AX] = accXi;
            this.bodies[iBase + BODY_AY] = accYi;
            this.bodies[iBase + BODY_AZ] = accZi;
        }
    }
}
