#include <emscripten.h>
#include <vector>
#include <cmath>

struct Body {
    double x, y, z, mass;
    double vx, vy, vz;
    double ax, ay, az;
};

std::vector<Body> bodies;
int bodyCount = 0;

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void initEngine(int maxBodies) {
        bodyCount = maxBodies;
        bodies.assign(bodyCount, Body{});
    }

    EMSCRIPTEN_KEEPALIVE
    double* getBodiesPointer() {
        return reinterpret_cast<double*>(bodies.data());
    }

    EMSCRIPTEN_KEEPALIVE
    void preCalculateAccelerations() {
        for (int i = 0; i < bodyCount; i++) {
            bodies[i].ax = 0.0;
            bodies[i].ay = 0.0;
            bodies[i].az = 0.0;
        }

        for (int i = 0; i < bodyCount; i++) {
            double iMass = bodies[i].mass;
            double ix = bodies[i].x;
            double iy = bodies[i].y;
            double iz = bodies[i].z;

            double acc_xi = bodies[i].ax;
            double acc_yi = bodies[i].ay;
            double acc_zi = bodies[i].az;

            for (int j = i + 1; j < bodyCount; j++) {
                double jMass = bodies[j].mass;

                double dx = bodies[j].x - ix;
                double dy = bodies[j].y - iy;
                double dz = bodies[j].z - iz;

                double distSq = dx * dx + dy * dy + dz * dz + 0.0001;
                double dist = std::sqrt(distSq);

                double G_over_r3 = 1.0 / (distSq * dist);
                double fx = G_over_r3 * dx;
                double fy = G_over_r3 * dy;
                double fz = G_over_r3 * dz;

                acc_xi += jMass * fx;
                acc_yi += jMass * fy;
                acc_zi += jMass * fz;

                bodies[j].ax -= iMass * fx;
                bodies[j].ay -= iMass * fy;
                bodies[j].az -= iMass * fz;
            }

            bodies[i].ax = acc_xi;
            bodies[i].ay = acc_yi;
            bodies[i].az = acc_zi;
        }
    }

    EMSCRIPTEN_KEEPALIVE
    void stepPhysics(double dt) {
        for (int i = 0; i < bodyCount; i++) {
            Body& b = bodies[i];

            b.x = b.x + b.vx * dt + 0.5 * b.ax * dt * dt;
            b.y = b.y + b.vy * dt + 0.5 * b.ay * dt * dt;
            b.z = b.z + b.vz * dt + 0.5 * b.az * dt * dt;

            b.vx = b.vx + 0.5 * b.ax * dt;
            b.vy = b.vy + 0.5 * b.ay * dt;
            b.vz = b.vz + 0.5 * b.az * dt;
        }

        for (int i = 0; i < bodyCount; i++) {
            bodies[i].ax = 0.0;
            bodies[i].ay = 0.0;
            bodies[i].az = 0.0;
        }

        for (int i = 0; i < bodyCount; i++) {
            double iMass = bodies[i].mass;
            double ix = bodies[i].x;
            double iy = bodies[i].y;
            double iz = bodies[i].z;

            double acc_xi = bodies[i].ax;
            double acc_yi = bodies[i].ay;
            double acc_zi = bodies[i].az;

            for (int j = i + 1; j < bodyCount; j++) {
                double jMass = bodies[j].mass;

                double dx = bodies[j].x - ix;
                double dy = bodies[j].y - iy;
                double dz = bodies[j].z - iz;

                double distSq = dx * dx + dy * dy + dz * dz + 0.0001;
                double dist = std::sqrt(distSq);

                double G_over_r3 = 1.0 / (distSq * dist);
                double fx = G_over_r3 * dx;
                double fy = G_over_r3 * dy;
                double fz = G_over_r3 * dz;

                acc_xi += jMass * fx;
                acc_yi += jMass * fy;
                acc_zi += jMass * fz;

                bodies[j].ax -= iMass * fx;
                bodies[j].ay -= iMass * fy;
                bodies[j].az -= iMass * fz;
            }

            bodies[i].ax = acc_xi;
            bodies[i].ay = acc_yi;
            bodies[i].az = acc_zi;
        }

        for (int i = 0; i < bodyCount; i++) {
            Body& b = bodies[i];

            b.vx += 0.5 * b.ax * dt;
            b.vy += 0.5 * b.ay * dt;
            b.vz += 0.5 * b.az * dt;
        }
    }
}
