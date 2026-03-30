import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import PhysicsModule from '../cpp/physics_wasm.js';

const benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];
const ASTEROID_COUNT = 1400; 

async function main(){
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas}); 

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.z = 25; 
  camera.position.y = 10;
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;    
  controls.dampingFactor = 0.05;

  const planetData = [
    {name: 'Sun', texturePath: 'textures/sun.jpg', radius: 3, distance: 0, mass: 10000, vz: 0},
    {name: 'Mercury', texturePath: 'textures/mercury.jpg', radius: 0.2, distance: 10, mass: 0.05, vz: 31.62},
    {name: 'Venus',   texturePath: 'textures/venus.jpg',   radius: 0.9, distance: 16, mass: 0.8,  vz: 25.00},
    {name: 'Earth',   texturePath: 'textures/earth.jpg',   radius: 1,   distance: 22, mass: 1,    vz: 21.32}, 
    {name: 'Mars',    texturePath: 'textures/mars.jpg',    radius: 0.53,distance: 30, mass: 0.1,  vz: 18.26},
    {name: 'Jupiter', texturePath: 'textures/jupiter.jpg', radius: 2.5, distance: 44, mass: 10,   vz: 15.08}, 
    {name: 'Saturn',  texturePath: 'textures/saturn.jpg',  radius: 2.1, distance: 60, mass: 3,    vz: 12.91},
    {name: 'Uranus',  texturePath: 'textures/uranus.jpg',  radius: 1.5, distance: 76, mass: 0.5,  vz: 11.47}, 
    {name: 'Neptune', texturePath: 'textures/neptune.jpg', radius: 1.5, distance: 90, mass: 0.6,  vz: 10.54},
  ];

  const MAX_BODIES = planetData.length + ASTEROID_COUNT;
  
  // ===============================================
  // BOOT WASM ENGINE
  // ===============================================

  const wasm = await PhysicsModule();
  wasm._initEngine(MAX_BODIES);

  const posMassData = new Float64Array(wasm.HEAPF64.buffer, wasm._getPosMassPointer(), MAX_BODIES * 4);
  const velData = new Float64Array(wasm.HEAPF64.buffer, wasm._getVelPointer(), MAX_BODIES * 3);

  let currentBodyIndex = 0; 
  // ===============================================

  const scene = new THREE.Scene();
  const baseGeometry = new THREE.SphereGeometry(1,32,32);
  const textureLoader = new THREE.TextureLoader();
  const planets = [];

  planetData.forEach((data, index) => {
    const texture = textureLoader.load(data.texturePath);
    let material; 

    if (data.name == 'Sun'){
      material = new THREE.MeshBasicMaterial({ map: texture });
    } else {
      material = new THREE.MeshPhongMaterial({ map: texture, shininess: 10 });
    }

    const planetMesh = new THREE.Mesh(baseGeometry, material);
    planetMesh.scale.set(data.radius, data.radius, data.radius);

    if (data.name === 'Saturn') {
      const ringGeometry = new THREE.RingGeometry(1.2, 2.2, 64);
      const ringTexture = textureLoader.load("textures/saturn_ring.png");
      const ringMaterial = new THREE.MeshBasicMaterial({ 
        map: ringTexture, side: THREE.DoubleSide, transparent: true       
      });
      const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
      ringMesh.rotation.x = Math.PI / 2;
      planetMesh.add(ringMesh);
      planetMesh.rotation.z = 26.7 * (Math.PI / 180); 
    }

    planetMesh.position.x = data.distance;
    planetMesh.name = data.name;

    // Write Planet data to C++ RAM
    const pmIdx = currentBodyIndex * 4;
    const vIdx = currentBodyIndex * 3;

    posMassData[pmIdx + 0] = data.distance; 
    posMassData[pmIdx + 1] = 0;             
    posMassData[pmIdx + 2] = 0;             
    posMassData[pmIdx + 3] = data.mass;     

    velData[vIdx + 0] = 0;                  
    velData[vIdx + 1] = 0;                  
    velData[vIdx + 2] = data.vz;            
    
    planetMesh.userData.physicsIndex = currentBodyIndex;
    currentBodyIndex++; 

    scene.add(planetMesh);
    planets.push(planetMesh);
  });

  const asteroidData = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const distance = 32 + Math.random() * 10; 
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const velocity = Math.sqrt(10000 / distance);
    const vx = -Math.sin(angle) * velocity;
    const vz = Math.cos(angle) * velocity;

    asteroidData.push({
      x: x, y: (Math.random() - 0.5) * 0.5, z: z,
      vx: vx, vy: 0, vz: vz,
      mass: 0.0001, radius: 0.05 + Math.random() * 0.05, 
    });
  }

  const rockGeometry = new THREE.DodecahedronGeometry(1, 0); 
  const rockMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 });
  const asteroidMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ASTEROID_COUNT);
  asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
  scene.add(asteroidMesh);
  
  const dummy = new THREE.Object3D();
  const asteroidPhysicsStartIndex = planetData.length; 

  asteroidData.forEach((data, index) => {
    // Write Asteroid data to C++ RAM
    const pmIdx = currentBodyIndex * 4;
    const vIdx = currentBodyIndex * 3;

    posMassData[pmIdx + 0] = data.x;
    posMassData[pmIdx + 1] = data.y;
    posMassData[pmIdx + 2] = data.z;
    posMassData[pmIdx + 3] = data.mass;

    velData[vIdx + 0] = data.vx;
    velData[vIdx + 1] = data.vy;
    velData[vIdx + 2] = data.vz;

    dummy.scale.set(data.radius, data.radius, data.radius);
    dummy.position.set(data.x, data.y, data.z);
    dummy.updateMatrix();

    asteroidMesh.setMatrixAt(index, dummy.matrix);
    currentBodyIndex++;
  });

  const light = new THREE.PointLight(0xffffff, 100, 200);
  light.position.set(0, 0, 0);
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); 
  scene.add(ambientLight);



//==========================================
  wasm._preCalculateAccelerations();
  
  const dt = 0.008;
  let frameCounter = 0;
  const max_frames = 1000;

  function render(time){
    if(resizeRenderer(renderer)){ 
      const canvas = renderer.domElement; 
      camera.aspect = canvas.clientWidth / canvas.clientHeight; 
      camera.updateProjectionMatrix();    
    }

    // --- PHYSICS BENCHMARK ---
    const t0 = performance.now();
    wasm._stepPhysics(dt);
    const t1 = performance.now();
    const physicsTime = t1 - t0;

    planets[0].rotation.y = time*0.001;

    planets.forEach((planet) => {
      const pIndex = planet.userData.physicsIndex * 4; 
      planet.position.x = posMassData[pIndex + 0];
      planet.position.y = posMassData[pIndex + 1];
      planet.position.z = posMassData[pIndex + 2];
    });

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const pIndex = (asteroidPhysicsStartIndex + i) * 4; 
      
      const ax = posMassData[pIndex + 0];
      const ay = posMassData[pIndex + 1];
      const az = posMassData[pIndex + 2];

      dummy.position.set(ax, ay, az);
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

    const renderTime = t3-t2;

    if(frameCounter < max_frames){
      benchmarkData.push([frameCounter, ASTEROID_COUNT, physicsTime.toFixed(4), renderTime.toFixed(4)]);
    }
    else if(frameCounter === max_frames){
      exportToCSV();
    }
    frameCounter++;

    requestAnimationFrame(render);
  } 

  requestAnimationFrame(render);
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
  //convertion to the csv string 
  const csvContent = benchmarkData.map(row => row.join(",")).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  //automatic download
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `WASM_Benchmark_${ASTEROID_COUNT}_bodies.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log("benchmark complete");
}


main();