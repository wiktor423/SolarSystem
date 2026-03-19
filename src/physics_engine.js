export class Body{
    constructor(x, y, z, vx, vy, vz, mass, radius){
        this.x = x; this.y = y; this.z = z;
        this.vx = vx; this.vy = vy; this.vz = vz; 
        this.mass = mass; 
        this.radius = radius; 
    } 
}

export class PhysicsEngine{
    constructor(maxBodies){
        this.maxBodies = maxBodies; 
        this.bodyCount = 0; 
        this.bodies = []; 
        this.G = 1;
        
        this.STRIDE = 11; 

        this.data = new Float64Array(this.maxBodies * this.STRIDE);
    }

    addBody(x,y,z,vx,vy,vz,mass,radius){
        const index = this.bodyCount * this.STRIDE; 

        this.data[index + 0] = x;
        this.data[index + 1] = y;
        this.data[index + 2] = z; 

        this.data[index + 3] = vx;
        this.data[index + 4] = vy;
        this.data[index + 5] = vz;

        this.data[index + 6] = 0; //ax
        this.data[index + 7] = 0; //ay
        this.data[index + 8] = 0; //ay

        this.data[index + 9] = mass;
        this.data[index + 10] = radius;

        this.bodyCount++;
    }

    step(dt){
       for (let i = 0; i < this.bodyCount; i++) {
            let idx = i * this.STRIDE;

            //current state
            let x = this.data[idx + 0];
            let y = this.data[idx + 1];
            let z = this.data[idx + 2];
            let vx = this.data[idx + 3];
            let vy = this.data[idx + 4];
            let vz = this.data[idx + 5];
            let ax = this.data[idx + 6]; 
            let ay = this.data[idx + 7];
            let az = this.data[idx + 8];

            //x = x + v*dt + 0.5*a*dt^2
            this.data[idx + 0] = x + vx * dt + 0.5 * ax * dt * dt;
            this.data[idx + 1] = y + vy * dt + 0.5 * ay * dt * dt;
            this.data[idx + 2] = z + vz * dt + 0.5 * az * dt * dt;

            //half-step the velocity 
            this.data[idx + 3] = vx + 0.5 * ax * dt;
            this.data[idx + 4] = vy + 0.5 * ay * dt;
            this.data[idx + 5] = vz + 0.5 * az * dt;
       }

       this.computeAccelerations();

       for (let i = 0; i < this.bodyCount; i++) {
            let idx = i * this.STRIDE;

            //new accelerations
            let new_ax = this.data[idx + 6];
            let new_ay = this.data[idx + 7];
            let new_az = this.data[idx + 8];

            //new velocities
            this.data[idx + 3] += 0.5 * new_ax * dt;
            this.data[idx + 4] += 0.5 * new_ay * dt;
            this.data[idx + 5] += 0.5 * new_az * dt;
        }
    }
 
    computeAccelerations(){
        //zero all the accelerations
        for (let i = 0; i < this.bodyCount; i++) {
            let idx = i * this.STRIDE;
            this.data[idx + 6] = 0; // ax
            this.data[idx + 7] = 0; // ay
            this.data[idx + 8] = 0; // az
        }

        for(let i = 0; i < this.bodyCount; i++){
            let idxI = i * this.STRIDE;

            let xi = this.data[idxI + 0];
            let yi = this.data[idxI + 1];
            let zi = this.data[idxI + 2];
            let massI = this.data[idxI + 9];

            for(let j = i+1; j < this.bodyCount; j++){
                let idxJ = j * this.STRIDE;

                let xj = this.data[idxJ + 0];
                let yj = this.data[idxJ + 1];
                let zj = this.data[idxJ + 2];
                let massJ = this.data[idxJ + 9];

                let dx = xj - xi;
                let dy = yj - yi;
                let dz = zj - zi;

                let distSq = dx*dx + dy*dy + dz*dz; 
                let dist = Math.sqrt(distSq);

                let G_over_r3 = this.G / (distSq * dist); 

                let ax_i = G_over_r3 * massJ * dx;
                let ay_i = G_over_r3 * massJ * dy;
                let az_i = G_over_r3 * massJ * dz;

                let ax_j = G_over_r3 * massI * dx;
                let ay_j = G_over_r3 * massI * dy;
                let az_j = G_over_r3 * massI * dz;

                
                this.data[idxI + 6] += ax_i;
                this.data[idxI + 7] += ay_i;
                this.data[idxI + 8] += az_i;

                this.data[idxJ + 6] -= ax_j;
                this.data[idxJ + 7] -= ay_j;
                this.data[idxJ + 8] -= az_j;
            }
        }
    }

}