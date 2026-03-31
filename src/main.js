import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Body, PhysicsEngine } from "./physics_engine.js";
//import { shininess } from 'three/tsl';

const benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];
const ASTEROID_COUNT = 1400;    

function main(){
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas}); 

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  const physics = new PhysicsEngine(ASTEROID_COUNT + 20);

  camera.position.z = 25; 
  camera.position.y = 10;

  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  
  //Settings for movable camera   
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

  const scene = new THREE.Scene();


  const baseGeometry = new THREE.SphereGeometry(1,32,32);
  const textureLoader = new THREE.TextureLoader();
  const planets = [];


  planetData.forEach((data, index) => {
    const texture = textureLoader.load(data.texturePath);
    let material; 

    if (data.name == 'Sun'){
      material = new THREE.MeshBasicMaterial({
        map: texture
      });
    }
    else{
      material = new THREE.MeshPhongMaterial({
        map: texture, 
        shininess: 10
      });
    }

    const planetMesh = new THREE.Mesh(baseGeometry, material);
    planetMesh.scale.set(data.radius, data.radius, data.radius);


    if (data.name === 'Saturn') {
      //Ring is created relatively to Saturn's geometry 
      const innerRadius = 1.2;  
      const outerRadius = 2.2;  
      const thetaSegments = 64; 
      const ringGeometry = new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments);
      
      const ringTexture = textureLoader.load("textures/saturn_ring.png");
      const ringMaterial = new THREE.MeshBasicMaterial({ 
        map: ringTexture,
        side: THREE.DoubleSide, //visible from both top and bottom
        transparent: true       
      });

      const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
      ringMesh.rotation.x = Math.PI / 2;

      //ring is the child mesh of Saturn
      planetMesh.add(ringMesh);

      //tilting the planet by the real world value
      planetMesh.rotation.z = 26.7 * (Math.PI / 180); 
    }

    planetMesh.position.x = data.distance;
    planetMesh.name = data.name;
    physics.addBody(data.distance, 0, 0, 0, 0, data.vz, data.mass, data.radius);
    
    planetMesh.userData.physicsIndex = index;
    scene.add(planetMesh);
    planets.push(planetMesh);
  });


  
/**
 *  Ateroid belt used to increase the computational load - it's ultimate purpose is to comapre 
 * JS engine with WASM engine, for now it just looks nice and causes lagging after addition of 
 * too many objects
 */

  const asteroidData = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {

    // random distributin between Mars and Jupiter
    const distance = 32 + Math.random() * 10; 
    
    const angle = Math.random() * Math.PI * 2;
    
    // conversion of polar coordinates to cartesian 
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    //calculate velocity from sqrt(GM/R) [G is one in this simulation]
    const velocity = Math.sqrt(10000 / distance);
    const vx = -Math.sin(angle) * velocity;
    const vz = Math.cos(angle) * velocity;

    asteroidData.push({
      x: x,
      y: (Math.random() - 0.5) * 0.5, //random small vertical scatter
      z: z,
      vx: vx,
      vy: 0,
      vz: vz,
      mass: 0.0001, 
      radius: 0.05 + Math.random() * 0.05, 
    });
  }


  //something that will look like a rock 
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0); 
  const rockMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 });

  
  const asteroidMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ASTEROID_COUNT);
  asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
  scene.add(asteroidMesh);

  
  const dummy = new THREE.Object3D();

  //start of the asteroid data in the physics engine array 
  const asteroidPhysicsStartIndex = planetData.length; 

  asteroidData.forEach((data, index) => {
    physics.addBody(data.x, data.y, data.z, data.vx, data.vy, data.vz, data.mass, data.radius);

    dummy.scale.set(data.radius, data.radius, data.radius);
    dummy.position.set(data.x, data.y, data.z);
    dummy.updateMatrix();

    asteroidMesh.setMatrixAt(index, dummy.matrix);
  });



  const light = new THREE.PointLight(0xffffff, 100, 200);
  light.position.set(0, 0, 0);
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); 
  scene.add(ambientLight);

  const dt = 0.008;


/**
 * Render function
 */

  let frameCounter = 0;
  const max_frames = 1000;


  function render(time){
    if(resizeRenderer(renderer)){ 
      const canvas = renderer.domElement; 
      camera.aspect = canvas.clientWidth / canvas.clientHeight; 
      camera.updateProjectionMatrix();    
    }

    const t0 = performance.now();
    physics.step(dt);
    const t1 = performance.now();
    const physicsTime = t1-t0;

    planets[0].rotation.y = time*0.001;
    planets.forEach((planet) => {
    const pIndex = planet.userData.physicsIndex * physics.STRIDE;


    planet.position.x = physics.data[pIndex + 0];
    planet.position.y = physics.data[pIndex + 1];
    planet.position.z = physics.data[pIndex + 2];
  });

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      //index of a specific asteroid
      const pIndex = (asteroidPhysicsStartIndex + i) * physics.STRIDE;
      
      const ax = physics.data[pIndex + 0];
      const ay = physics.data[pIndex + 1];
      const az = physics.data[pIndex + 2];

      dummy.position.set(ax, ay, az);
      
      dummy.rotation.x += 0.01;
      dummy.rotation.y += 0.01;
      
      dummy.updateMatrix();

      asteroidMesh.setMatrixAt(i, dummy.matrix);
    }

    //ateroids are being redrawn each frame
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
  link.setAttribute("download", `JS_Benchmark_${ASTEROID_COUNT}_bodies.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log("benchmark complete");
}


main();
