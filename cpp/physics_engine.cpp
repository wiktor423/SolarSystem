#include <emscripten.h>
#include <vector>
#include <cmath>

std::vector<double> posMass; //X, Y, Z, mass   || 32Bytes -> 50% of cache line
std::vector<double> vel;     //vx, vy, vz 
std::vector<double> accel;   //ax, ay, az

int bodyCount = 0;

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

        for (int i = 0; i < bodyCount; i++) {
            int iPM = i * 4;
            int i3  = i * 3;
            double iMass = posMass[iPM + 3];

            for(int j = i + 1; j < bodyCount; j++) {
                int jPM = j * 4;
                int j3  = j * 3;
                double jMass = posMass[jPM + 3];

                double dx = posMass[jPM + 0] - posMass[iPM + 0];
                double dy = posMass[jPM + 1] - posMass[iPM + 1];
                double dz = posMass[jPM + 2] - posMass[iPM + 2];

                double distSq = dx*dx + dy*dy + dz*dz + 0.0001; 
                double dist = std::sqrt(distSq); 

                double G_over_r3 = 1.0 / (distSq * dist); 

                accel[i3 + 0] += G_over_r3 * jMass * dx;
                accel[i3 + 1] += G_over_r3 * jMass * dy;
                accel[i3 + 2] += G_over_r3 * jMass * dz;
                
                accel[j3 + 0] -= G_over_r3 * iMass * dx;
                accel[j3 + 1] -= G_over_r3 * iMass * dy;
                accel[j3 + 2] -= G_over_r3 * iMass * dz;
            }
        }
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

        for (int i=0; i<bodyCount; i++){
            int iPM = i * 4; 
            int i3  = i * 3; 
            double iMass = posMass[iPM + 3];

            for(int j=i+1; j<bodyCount; j++){
                int jPM = j * 4;
                int j3  = j * 3;
                double jMass = posMass[jPM + 3];

                double dx = posMass[jPM + 0] - posMass[iPM + 0];
                double dy = posMass[jPM + 1] - posMass[iPM + 1];
                double dz = posMass[jPM + 2] - posMass[iPM + 2];

                double distSq = dx*dx + dy*dy + dz*dz + 0.0001;
                double dist = std::sqrt(distSq); 

                double G_over_r3 = 1 / (distSq * dist); 

                accel[i3 + 0] += G_over_r3 * jMass * dx;
                accel[i3 + 1] += G_over_r3 * jMass * dy;
                accel[i3 + 2] += G_over_r3 * jMass * dz;
                
                accel[j3 + 0] -= G_over_r3 * iMass * dx;
                accel[j3 + 1] -= G_over_r3 * iMass * dy;
                accel[j3 + 2] -= G_over_r3 * iMass * dz;
            }
        }

        for(int i=0; i<bodyCount; i++){
            int i3 = i * 3;

            vel[i3 + 0] += 0.5 * accel[i3 + 0] * dt;
            vel[i3 + 1] += 0.5 * accel[i3 + 1] * dt;
            vel[i3 + 2] += 0.5 * accel[i3 + 2] * dt;
        }
    }
} 
