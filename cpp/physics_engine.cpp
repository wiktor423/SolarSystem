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
            double ix = posMass[iPM + 0];
            double iy = posMass[iPM + 1];
            double iz = posMass[iPM + 2];

            double acc_xi = accel[i3 + 0];
            double acc_yi = accel[i3 + 1];
            double acc_zi = accel[i3 + 2];

            for(int j = i + 1; j < bodyCount; j++) {
                int jPM = j * 4;
                int j3  = j * 3;
                double jMass = posMass[jPM + 3];

                double dx = posMass[jPM + 0] - ix;
                double dy = posMass[jPM + 1] - iy;
                double dz = posMass[jPM + 2] - iz;

                double distSq = dx*dx + dy*dy + dz*dz + 0.0001; 
                double dist = std::sqrt(distSq); 

                double G_over_r3 = 1.0 / (distSq * dist); 
                double fx = G_over_r3 * dx;
                double fy = G_over_r3 * dy;
                double fz = G_over_r3 * dz;

                acc_xi += jMass * fx;
                acc_yi += jMass * fy;
                acc_zi += jMass * fz;
                
                accel[j3 + 0] -= iMass * fx;
                accel[j3 + 1] -= iMass * fy;
                accel[j3 + 2] -= iMass * fz;
            }
            
            accel[i3 + 0] = acc_xi;
            accel[i3 + 1] = acc_yi;
            accel[i3 + 2] = acc_zi;
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
            double ix = posMass[iPM + 0];
            double iy = posMass[iPM + 1];
            double iz = posMass[iPM + 2];

            double acc_xi = accel[i3 + 0];
            double acc_yi = accel[i3 + 1];
            double acc_zi = accel[i3 + 2];

            for(int j=i+1; j<bodyCount; j++){
                int jPM = j * 4;
                int j3  = j * 3;
                double jMass = posMass[jPM + 3];

                double dx = posMass[jPM + 0] - ix;
                double dy = posMass[jPM + 1] - iy;
                double dz = posMass[jPM + 2] - iz;

                double distSq = dx*dx + dy*dy + dz*dz + 0.0001;
                double dist = std::sqrt(distSq); 

                double G_over_r3 = 1 / (distSq * dist); 
                double fx = G_over_r3 * dx;
                double fy = G_over_r3 * dy;
                double fz = G_over_r3 * dz;

                acc_xi += jMass * fx;
                acc_yi += jMass * fy;
                acc_zi += jMass * fz;
                
                accel[j3 + 0] -= iMass * fx;
                accel[j3 + 1] -= iMass * fy;
                accel[j3 + 2] -= iMass * fz;
            }
            
            accel[i3 + 0] = acc_xi;
            accel[i3 + 1] = acc_yi;
            accel[i3 + 2] = acc_zi;
        }

        for(int i=0; i<bodyCount; i++){
            int i3 = i * 3;

            vel[i3 + 0] += 0.5 * accel[i3 + 0] * dt;
            vel[i3 + 1] += 0.5 * accel[i3 + 1] * dt;
            vel[i3 + 2] += 0.5 * accel[i3 + 2] * dt;
        }
    }
} 
