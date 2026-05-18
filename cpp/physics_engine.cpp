#include <emscripten.h>
#include <vector>
#include <cmath>
#include <thread>

std::vector<double> posMass; //X, Y, Z, mass   || 32Bytes -> 50% of cache line
std::vector<double> vel;     //vx, vy, vz 
std::vector<double> accel;   //ax, ay, az

int bodyCount = 0;
const int NUM_THREADS = 4; 

void computeAccelBlock(int start, int end) {
    for (int i = start; i < end; i++) {
        int iPM = i * 4;
        int i3  = i * 3;
        double iMass = posMass[iPM + 3];

        double ax = 0.0;
        double ay = 0.0;
        double az = 0.0;

        for(int j = 0; j < bodyCount; j++) {
            if (i == j) continue;
            
            int jPM = j * 4;
            double jMass = posMass[jPM + 3];

            double dx = posMass[jPM + 0] - posMass[iPM + 0];
            double dy = posMass[jPM + 1] - posMass[iPM + 1];
            double dz = posMass[jPM + 2] - posMass[iPM + 2];

            double distSq = dx*dx + dy*dy + dz*dz + 0.0001; 
            double dist = std::sqrt(distSq); 

            double G_over_r3 = 1.0 / (distSq * dist); 

            ax += G_over_r3 * jMass * dx;
            ay += G_over_r3 * jMass * dy;
            az += G_over_r3 * jMass * dz;
        }
        accel[i3 + 0] = ax;
        accel[i3 + 1] = ay;
        accel[i3 + 2] = az;
    }
}

void runThreads() {
    std::vector<std::thread> threads;
    int chunkSize = bodyCount / NUM_THREADS;
    for (int t = 0; t < NUM_THREADS; t++) {
        int start = t * chunkSize;
        int end = (t == NUM_THREADS - 1) ? bodyCount : start + chunkSize;
        threads.emplace_back(std::thread(computeAccelBlock, start, end));
    }
    for (auto& th : threads) {
        th.join();
    }
}

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void initEngine(int maxBodies) {
        bodyCount = maxBodies;
        
        posMass.resize(bodyCount * 4, 0.0);
        vel.resize(bodyCount * 3, 0.0); 
        accel.resize(bodyCount * 3, 0.0);
    }

    //Memory address for JS 
    EMSCRIPTEN_KEEPALIVE
    double* getPosMassPointer(){return posMass.data();}
    EMSCRIPTEN_KEEPALIVE
    double* getVelPointer()    {return vel.data();}


    EMSCRIPTEN_KEEPALIVE
    void preCalculateAccelerations() {
        // Zero out the accelerations array
        std::fill(accel.begin(), accel.end(), 0.0);

        runThreads();
    }

    EMSCRIPTEN_KEEPALIVE
    void stepPhysics(double dt) {
        for (int i=0; i<bodyCount; i++){
            int iPM = i * 4;
            int i3 = i * 3; 
            
            posMass[iPM + 0] = posMass[iPM + 0] + vel[i3 + 0] * dt + 0.5 * accel[i3 + 0] * dt * dt;
            posMass[iPM + 1] = posMass[iPM + 1] + vel[i3 + 1] * dt + 0.5 * accel[i3 + 1] * dt * dt;
            posMass[iPM + 2] = posMass[iPM + 2] + vel[i3 + 2] * dt + 0.5 * accel[i3 + 2] * dt * dt; 

            vel[i3 + 0] = vel[i3 + 0] + 0.5 * accel[i3 + 0] * dt;
            vel[i3 + 1] = vel[i3 + 1] + 0.5 * accel[i3 + 1] * dt;
            vel[i3 + 2] = vel[i3 + 2] + 0.5 * accel[i3 + 2] * dt; 
        }

        //Zero the accelerations
        std::fill(accel.begin(), accel.end(), 0.0); 

        runThreads();

        for(int i=0; i<bodyCount; i++){
            int i3 = i * 3;

            vel[i3 + 0] += 0.5 * accel[i3 + 0] * dt;
            vel[i3 + 1] += 0.5 * accel[i3 + 1] * dt;
            vel[i3 + 2] += 0.5 * accel[i3 + 2] * dt;
        }
    }
} 
