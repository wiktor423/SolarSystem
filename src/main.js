import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import PhysicsModule from '../cpp/physics_wasm.js';
import { PhysicsEngineJS } from './physics_engine.js';

//====GLOBAL=STATE=====

let useWasm = true;
let ASTEROID_COUNT = 1400; 
let activePosMass = null;
let activeVel = null;
let frameCounter = 0;
const max_frames = 1000;
let benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];

//=======================

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

  const scene = new THREE.Scene();
  const light = new THREE.PointLight(0xffffff, 100, 200);
  light.position.set(0, 0, 0);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

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
    
    const TOTAL_BODIES = planetData.length + ASTEROID_COUNT;

    //clear benchmark data
    frameCounter = 0;
    benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];

    //clear the  scene
    planets.forEach(p => scene.remove(p));
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
      currentBodyIndex++; 

      scene.add(planetMesh);
      planets.push(planetMesh);
    });

    //Asteroids
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0); 
    const rockMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 });
    asteroidMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ASTEROID_COUNT);
    asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
    scene.add(asteroidMesh);

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const distance = 32 + Math.random() * 10; 
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const velocity = Math.sqrt(10000 / distance);
      const vx = -Math.sin(angle) * velocity;
      const vz = Math.cos(angle) * velocity;
      const mass = 0.0001;
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

  //every time the page loads
  resetSimulation();



  // ===============================================
  // RENDER 
  // ===============================================
  const dt = 0.008;

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

    planets.forEach((planet) => {
      const pIndex = planet.userData.physicsIndex * 4; 
      planet.position.x = activePosMass[pIndex + 0];
      planet.position.y = activePosMass[pIndex + 1];
      planet.position.z = activePosMass[pIndex + 2];
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