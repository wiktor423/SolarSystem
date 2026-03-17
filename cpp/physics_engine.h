#pragma once 

#include <vector> 
#include "body.h"

class PhysicsEngine{
    private: 
        std::vector<Body> bodies;
        double G;           //Gravitational constant

        void computeAccelerations();

    public: 
        PhysicsEngine(double gravityConstant = 6.67430e-11);

        void addBody(const Body &b); 
        void clear();

        void step(double dt);
}