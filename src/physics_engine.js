export class PhysicsEngineJS {
    constructor(maxBodies){
        this.maxBodies = maxBodies; 
        this.bodyCount = 0; 
        this.G = 1;
        
        this.posMass = new Float64Array(this.maxBodies * 4); 
        this.vel     = new Float64Array(this.maxBodies * 3);
        this.accel   = new Float64Array(this.maxBodies * 3);
    }

    preCalculateAccelerations(currentCount) {
        this.bodyCount = currentCount;
        this.computeAccelerations();
    }

    step(dt){
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

       
       this.computeAccelerations();
       
       for (let i = 0; i < this.bodyCount; i++) {
            let i3 = i * 3;

            this.vel[i3 + 0] += 0.5 * this.accel[i3 + 0] * dt;
            this.vel[i3 + 1] += 0.5 * this.accel[i3 + 1] * dt;
            this.vel[i3 + 2] += 0.5 * this.accel[i3 + 2] * dt;
        }
    }
 
    computeAccelerations(){
        for (let i = 0; i < this.bodyCount; i++) {
            let i3 = i * 3;
            this.accel[i3 + 0]  = 0; // ax
            this.accel[i3 + 1]  = 0; // ay
            this.accel[i3 + 2]  = 0; // az
        }

        for(let i = 0; i < this.bodyCount; i++){
            let iPM = i * 4;
            let i3  = i * 3;

            let xi = this.posMass[iPM + 0];
            let yi = this.posMass[iPM + 1];
            let zi = this.posMass[iPM + 2];
            let massI = this.posMass[iPM + 3];

            for(let j = i + 1; j < this.bodyCount; j++){
                let jPM = j * 4;
                let j3  = j * 3;

                let xj = this.posMass[jPM + 0];
                let yj = this.posMass[jPM + 1];
                let zj = this.posMass[jPM + 2];
                let massJ = this.posMass[jPM + 3];

                let dx = xj - xi;
                let dy = yj - yi;
                let dz = zj - zi;

                let distSq = dx*dx + dy*dy + dz*dz + 0.0001; 
                let dist = Math.sqrt(distSq);

                let G_over_r3 = this.G / (distSq * dist); 

                let ax_i = G_over_r3 * massJ * dx;
                let ay_i = G_over_r3 * massJ * dy;
                let az_i = G_over_r3 * massJ * dz;

                let ax_j = G_over_r3 * massI * dx;
                let ay_j = G_over_r3 * massI * dy;
                let az_j = G_over_r3 * massI * dz;
                

                this.accel[i3 + 0] += ax_i;
                this.accel[i3 + 1] += ay_i;
                this.accel[i3 + 2] += az_i;

                this.accel[j3 + 0] -= ax_j;
                this.accel[j3 + 1] -= ay_j;
                this.accel[j3 + 2] -= az_j;
            }
        }
    }
}