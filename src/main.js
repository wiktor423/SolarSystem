import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import PhysicsModule from '../cpp/physics_wasm.js';
import { PhysicsEngineJS } from './physics_engine.js';
//fimport { fill } from 'three/src/extras/TextureUtils.js';

//====GLOBAL=STATE=====

let useWasm = true;
let ASTEROID_COUNT = 1500; //default value 
let activePosMass = null;
let activeVel = null;

const timeDisplay = document.getElementById('physics-time-display');
const fpsDisplay = document.getElementById('physics-fps-display');
let lastUiUpdateTime = 0;

let frameCounter = 0;
const max_frames = 2000;
let benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];

const chartCtx = document.getElementById('performance-chart').getContext('2d');
  
const maxDataPoints = 50; 
const emptyData = Array(maxDataPoints).fill(0);
const emptyLabels = Array(maxDataPoints).fill('');

const perfChart = new Chart(chartCtx, {
    type: 'line',
    data: {
        labels: emptyLabels,
        datasets: [{
            label: 'Physics Time (ms)',
            data: [...emptyData],
            borderColor: '#5eae60', //WASM
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            borderWidth: 2,
            pointRadius: 0,         // smooth line
            tension: 0.2,            // slight curve 
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,           
        scales: {
            x: { display: false },  
            y: { 
                beginAtZero: true,
                suggestedMax: 30,   
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#ccc', stepSize: 10 }
            }
        },
        plugins: { legend: { display: false } } 
    }
});

//=======================

async function main(){
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas}); 

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.z = 70; 
  camera.position.y = 40;
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;    
  controls.dampingFactor = 0.05;

  const scene = new THREE.Scene();
  const light = new THREE.PointLight(0xffffee, 200, 400);
  light.position.set(0, 0, 0);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.1));

  // Add stars background
  const starsGeometry = new THREE.BufferGeometry();
  const starsMaterial = new THREE.PointsMaterial({color: 0xffffff, size: 0.1});
  const starsVertices = []; 

  for (let i = 0; i < 1000; i++) {
    const x = THREE.MathUtils.randFloatSpread(1000);
    const y = THREE.MathUtils.randFloatSpread(1000);
    const z = THREE.MathUtils.randFloatSpread(1000);
    starsVertices.push(x, y, z);
  }

  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
  const starField = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(starField);

  const planetData = [
    {name: 'Sun',     texturePath: 'textures/sun-texture.jpg',     radius: 3,    distance: 0,    mass: 10000, vz: 0, trailColor: 0xffcc33},
    {name: 'Mercury', texturePath: 'textures/mercury.jpg', radius: 0.2,  distance: 10,   mass: 0.0016,  vz: 31.62, trailColor: 0xaaaaaa},
    {name: 'Venus',   texturePath: 'textures/venus.jpg',   radius: 0.9,  distance: 16,   mass: 0.024,   vz: 25.00, trailColor: 0xffaa00},
    {name: 'Earth',   texturePath: 'textures/earth.jpg',   radius: 1, distance: 22,   mass: 0.03,  vz: 21.32, trailColor: 0x4488ff}, 
    //{name: 'Moon',    texturePath: 'textures/moon.jpg',    radius: 0.01, distance: 22.1,   mass: 0.0003,vz: 21.86}, 
    {name: 'Mars',    texturePath: 'textures/mars.jpg',    radius: 0.53, distance: 30,   mass: 0.1,   vz: 18.26, trailColor: 0xff4422},
    {name: 'Jupiter', texturePath: 'textures/jupiter.jpg', radius: 2.5,  distance: 55,   mass: 9.54,    vz: 13.48, trailColor: 0xffaa77}, 
    {name: 'Saturn',  texturePath: 'textures/saturn.jpg',  radius: 2.1,  distance: 75,   mass: 2.85,     vz: 11.55, trailColor: 0xeeddcc},
    {name: 'Uranus',  texturePath: 'textures/uranus.jpg',  radius: 1.5,  distance: 95,   mass: 0.5,   vz: 10.26, trailColor: 0x88ccff}, 
    {name: 'Neptune', texturePath: 'textures/neptune.jpg', radius: 1.5,  distance: 115,  mass: 0.51,   vz: 9.32, trailColor: 0x4444ff},
  ];

  // ===============================================
  // AWAIT WASM ENGINE 
  // ===============================================

  const wasm = await PhysicsModule();
  let jsEngine = null; 

  // Mesh setup 
  const baseGeometry = new THREE.SphereGeometry(1,32,32);
  const textureLoader = new THREE.TextureLoader();
  let planets = [];
  let asteroidMesh = null;
  const dummy = new THREE.Object3D();

  // ===============================================
  // RESET FUNCTION 
  // ===============================================

  function resetSimulation() {
    useWasm = document.getElementById('engine-select').value === "WASM";
    ASTEROID_COUNT = parseInt(document.getElementById('asteroid-input').value);

    perfChart.data.datasets[0].data = Array(maxDataPoints).fill(0);
    perfChart.data.datasets[0].borderColor = useWasm ? '#4CAF50' : '#FF9800';
    perfChart.update();
    
    const TOTAL_BODIES = planetData.length + ASTEROID_COUNT;

    //clear benchmark data
    frameCounter = 0;
    benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];

    //clear the  scene
    planets.forEach(p => {
      scene.remove(p);
      if (p.userData.trail) scene.remove(p.userData.trail.mesh);
    });
    if (asteroidMesh) scene.remove(asteroidMesh);
    planets = [];

    wasm._initEngine(TOTAL_BODIES);
    const wasmPosMass = new Float64Array(wasm.HEAPF64.buffer, wasm._getPosMassPointer(), TOTAL_BODIES * 4);
    const wasmVel = new Float64Array(wasm.HEAPF64.buffer, wasm._getVelPointer(), TOTAL_BODIES * 3);

    
    jsEngine = new PhysicsEngineJS(TOTAL_BODIES);

    //assign the pointers
    activePosMass = useWasm ? wasmPosMass : jsEngine.posMass;
    activeVel = useWasm ? wasmVel : jsEngine.vel;

    let currentBodyIndex = 0; 

    planetData.forEach((data) => {
      let material = data.name == 'Sun' ? 
          new THREE.MeshBasicMaterial({ map: textureLoader.load(data.texturePath) }) : 
          new THREE.MeshPhongMaterial({ map: textureLoader.load(data.texturePath), shininess: 10 });

      const planetMesh = new THREE.Mesh(baseGeometry, material);
      planetMesh.scale.set(data.radius, data.radius, data.radius);
      planetMesh.position.x = data.distance;

     if(data.name == 'Saturn'){
        const ringGeometry = new THREE.RingGeometry(1.2, 1.7, 64); 
        
        const ringMaterial = new THREE.MeshBasicMaterial({ 
          map: textureLoader.load("textures/saturn_ring.png"),
          side: THREE.DoubleSide, 
          transparent: true,
          opacity: 0.8
        });  

        const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        
        ringMesh.rotation.x = Math.PI / 1.5; 
        planetMesh.add(ringMesh);
      }

      const pmIdx = currentBodyIndex * 4;
      const vIdx = currentBodyIndex * 3;

      activePosMass[pmIdx + 0] = data.distance; 
      activePosMass[pmIdx + 1] = 0;             
      activePosMass[pmIdx + 2] = 0;             
      activePosMass[pmIdx + 3] = data.mass;     

      activeVel[vIdx + 0] = 0;                  
      activeVel[vIdx + 1] = 0;                  
      activeVel[vIdx + 2] = data.vz;            
      
      planetMesh.userData.physicsIndex = currentBodyIndex;
      planetMesh.userData.name = data.name;
      planetMesh.userData.originalMass = data.mass;
      currentBodyIndex++; 

      if (data.name !== 'Sun') {
        const maxTrailPoints = 8000; //
        const trailGeometry = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(maxTrailPoints * 3);
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeometry.setDrawRange(0, 0);

        const trailMaterial = new THREE.LineBasicMaterial({
          color: data.trailColor || 0xffffff,
          transparent: true,
          opacity: 0.3,
          linewidth: 0.5
        });

        const trailMesh = new THREE.Line(trailGeometry, trailMaterial);
        scene.add(trailMesh);

        planetMesh.userData.trail = {
          mesh: trailMesh,
          positions: trailPositions,
          pointCount: 0,
          maxPoints: maxTrailPoints,
          updateFreq: 2, // update every nth frame
          ticks: 0
        };
      }

      scene.add(planetMesh);
      planets.push(planetMesh);
    });

    //Asteroids
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0); 
    const rockMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffffff,shininess: 1});
    asteroidMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ASTEROID_COUNT);
    asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
    scene.add(asteroidMesh);

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const distance = 32 + Math.random() * 20; 
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const velocity = Math.sqrt(10000 / distance);
      const vx = -Math.sin(angle) * velocity;
      const vz = Math.cos(angle) * velocity;
      const mass = 0.00001;
      const radius = 0.05 + Math.random() * 0.05;

      const pmIdx = currentBodyIndex * 4;
      const vIdx = currentBodyIndex * 3;

      activePosMass[pmIdx + 0] = x;
      activePosMass[pmIdx + 1] = (Math.random() - 0.5) * 0.5;
      activePosMass[pmIdx + 2] = z;
      activePosMass[pmIdx + 3] = mass;

      activeVel[vIdx + 0] = vx;
      activeVel[vIdx + 1] = 0;
      activeVel[vIdx + 2] = vz;

      dummy.scale.set(radius, radius, radius);
      dummy.position.set(activePosMass[pmIdx + 0], activePosMass[pmIdx + 1], activePosMass[pmIdx + 2]);
      dummy.updateMatrix();
      asteroidMesh.setMatrixAt(i, dummy.matrix);

      currentBodyIndex++;
    }

    // Pre-calculate Frame 0 Gravity
    if(useWasm){
      wasm._preCalculateAccelerations();
    } else {
      jsEngine.preCalculateAccelerations(TOTAL_BODIES); 
    }

    console.log(`Simulation Reset: ${useWasm ? "WASM" : "JS"} with ${ASTEROID_COUNT} asteroids.`);
  }

  
  document.getElementById('restart-btn').addEventListener('click', resetSimulation);

  // ===============================================
  // RAYCASTER AND PLANET SELECTION
  // ===============================================
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selectedPlanetMesh = null;

  window.addEventListener('pointerdown', (event) => {
    if (event.target.tagName !== 'CANVAS') return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(planets, true); 
    if (intersects.length > 0) {
      let object = intersects[0].object;
      while (object && object.userData.physicsIndex === undefined && object.parent) {
        object = object.parent;
      }
      
      if (object && object.userData.physicsIndex !== undefined) {
        selectedPlanetMesh = object;
        const pIndex = object.userData.physicsIndex * 4;
        const currentMass = activePosMass[pIndex + 3];
        const originalMass = object.userData.originalMass;

        document.getElementById('planet-ui').style.display = 'block';
        document.getElementById('selected-planet-name').textContent = object.userData.name;
        document.getElementById('selected-planet-mass-display').textContent = currentMass.toPrecision(4);
        
        const max_slider = Math.max(originalMass * 10, 20000)

        const slider = document.getElementById('selected-planet-mass-slider');
        slider.min = 0;
        slider.max = max_slider; // allow planets to become heavier than the sun
        slider.step = "any";
        slider.value = currentMass;
      }
    } else {
      document.getElementById('planet-ui').style.display = 'none';
      selectedPlanetMesh = null;
    }
  });

  document.getElementById('selected-planet-mass-slider').addEventListener('input', (event) => {
    if (selectedPlanetMesh && activePosMass) {
      const newMass = parseFloat(event.target.value);
      const pIndex = selectedPlanetMesh.userData.physicsIndex * 4;
      activePosMass[pIndex + 3] = newMass;
      document.getElementById('selected-planet-mass-display').textContent = newMass.toPrecision(4);
    }
  });

  //every time the page loads
  //resetSimulation();

  // ===============================================
  // RENDER 
  // ===============================================
  const dt = 0.004;

  function render(time){
    if(resizeRenderer(renderer)){ 
      const canvas = renderer.domElement; 
      camera.aspect = canvas.clientWidth / canvas.clientHeight; 
      camera.updateProjectionMatrix();    
    }

    const t0 = performance.now();
    
    if(useWasm){
      wasm._stepPhysics(dt);  
    } else {
      jsEngine.step(dt);
    }
    
    const t1 = performance.now();
    const physicsTime = t1 - t0;

    if (t1 - lastUiUpdateTime > 250) {
          const physicsFPS = physicsTime > 0 ? (1000 / physicsTime) : 0; 

          timeDisplay.textContent = physicsTime.toFixed(2);
          
          fpsDisplay.textContent = physicsFPS > 9999 ? "Max" : Math.round(physicsFPS);
          
          lastUiUpdateTime = t1;

          perfChart.data.datasets[0].data.push(physicsTime);
          
          // Remove the oldest time from the beginning to make it scroll
          perfChart.data.datasets[0].data.shift(); 
          perfChart.update();
      }

    planets.forEach((planet) => {
      const pIndex = planet.userData.physicsIndex * 4; 
      const px = activePosMass[pIndex + 0];
      const py = activePosMass[pIndex + 1];
      const pz = activePosMass[pIndex + 2];
      planet.position.x = px;
      planet.position.y = py;
      planet.position.z = pz;

      if (planet.userData.trail) {
        const trail = planet.userData.trail;
        trail.ticks++;
        if (trail.ticks >= trail.updateFreq) {
          trail.ticks = 0;
          if (trail.pointCount < trail.maxPoints) {
            trail.positions[trail.pointCount * 3] = px;
            trail.positions[trail.pointCount * 3 + 1] = py;
            trail.positions[trail.pointCount * 3 + 2] = pz;
            trail.pointCount++;
            trail.mesh.geometry.setDrawRange(0, trail.pointCount);
          } else {
            for (let i = 0; i < trail.maxPoints - 1; i++) {
              trail.positions[i * 3] = trail.positions[(i + 1) * 3];
              trail.positions[i * 3 + 1] = trail.positions[(i + 1) * 3 + 1];
              trail.positions[i * 3 + 2] = trail.positions[(i + 1) * 3 + 2];
            }
            trail.positions[(trail.maxPoints - 1) * 3] = px;
            trail.positions[(trail.maxPoints - 1) * 3 + 1] = py;
            trail.positions[(trail.maxPoints - 1) * 3 + 2] = pz;
          }
          trail.mesh.geometry.attributes.position.needsUpdate = true;
        }
      }
    });

    const asteroidPhysicsStartIndex = planetData.length;
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const pIndex = (asteroidPhysicsStartIndex + i) * 4; 
      dummy.position.set(activePosMass[pIndex + 0], activePosMass[pIndex + 1], activePosMass[pIndex + 2]);
      dummy.rotation.x += 0.01;
      dummy.rotation.y += 0.01;
      dummy.updateMatrix();
      asteroidMesh.setMatrixAt(i, dummy.matrix);
    }

    asteroidMesh.instanceMatrix.needsUpdate = true;
    controls.update();

    const t2 = performance.now();
    renderer.render(scene, camera);
    const t3 = performance.now();
    const renderTime = t3 - t2;

    if(frameCounter < max_frames){
      benchmarkData.push([frameCounter, ASTEROID_COUNT, physicsTime.toFixed(4), renderTime.toFixed(4)]);
    } else if(frameCounter === max_frames){
      //exportToCSV(); 
    }

    frameCounter++;

    requestAnimationFrame(render);
  } 
  //requestAnimationFrame(render);
  document.getElementById('enter-sim-btn').addEventListener('click', () => {
    const initEngine = document.getElementById('initial-engine').value;
    const initAsteroids = document.getElementById('initial-asteroids').value;
    
    document.getElementById('engine-select').value = initEngine;
    document.getElementById('asteroid-input').value = initAsteroids;
    
    const welcomeScreen = document.getElementById('welcome-screen');
    welcomeScreen.style.opacity = '0';
    setTimeout(() => {
        welcomeScreen.style.display = 'none'; // Remove it from layout
        document.getElementById('sim-ui').style.display = 'block'; // Show Live UI
    }, 500); 
 
    resetSimulation();
    requestAnimationFrame(render);
  });
}

function resizeRenderer(renderer){
  const canvas = renderer.domElement
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if(needResize){
    renderer.setSize(width, height, false);
  }
  return needResize;
}

function exportToCSV(){
  const csvContent = benchmarkData.map(row => row.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${useWasm ? 'WASM' : 'JS'}_${ASTEROID_COUNT}.csv`);
  link.style_visibility = 'hidden';document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  console.log("benchmark complete");
}

main();
