let posMass, accel;
const G = 1;

self.onmessage = function(e) {
    const data = e.data;
    if (data.type === 'init') {
        posMass = new Float64Array(data.posMassBuffer);
        accel = new Float64Array(data.accelBuffer);
    } else if (data.type === 'compute') {
        const bodyCount = data.bodyCount;
        const start = data.start;
        const end = data.end;

        for (let i = start; i < end; i++) {
            let iPM = i * 4;
            let i3  = i * 3;

            let ax = 0, ay = 0, az = 0;

            for (let j = 0; j < bodyCount; j++) {
                if (i === j) continue;

                let jPM = j * 4;
                let massJ = posMass[jPM + 3];

                let dx = posMass[jPM + 0] - posMass[iPM + 0];
                let dy = posMass[jPM + 1] - posMass[iPM + 1];
                let dz = posMass[jPM + 2] - posMass[iPM + 2];

                let distSq = dx*dx + dy*dy + dz*dz + 0.0001;
                let dist = Math.sqrt(distSq);

                let G_over_r3 = G / (distSq * dist);

                ax += G_over_r3 * massJ * dx;
                ay += G_over_r3 * massJ * dy;
                az += G_over_r3 * massJ * dz;
            }

            accel[i3 + 0] = ax;
            accel[i3 + 1] = ay;
            accel[i3 + 2] = az;
        }
        self.postMessage({ id: data.id, done: true });
    }
};
