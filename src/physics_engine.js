class Body{
    constructor(x, y, x, vx, vy, vz, mass, radious){
        this.x = x; this.y = y; this.z = this.z;
        this.vx = vx; this.vy = vy; this.vz = vz; 
        this.mass = mass; 
        this.radious = radious; 
    } 
}

class PhysicsEngine{
    constructor(maxBodies){
        this.maxBodies = maxBodies; 
        this.bodies = []; 
        this.G = 6.67430e-11;
        
        this.STRIDE = 11; 

        this.data = new Float64Array(this.maxBodies * this.STRIDE);
    }

    addBoddy(){
        const index = this.bodyCount * this.STRIDE; 

        this.data[index + 0] = x;
        this.data[index + 1] = y;
        this.data[index + 2] = z; 

        
        this.data[index + 3] = vx;
        this.data[index + 4] = vy;
        this.data[index + 5] = vz;

        this.data[index + 6] = 0;
        this.data[index + 7] = 0;
        this.data[index + 8] = 0;

        this.data[index + 9] = mass;
        this.data[index + 10] = radious;

        this.bodyCount++;
    }

    step(dt){
        this.x = x + vx*dt + ax
    }

    computeAccelerations(){

    }

}