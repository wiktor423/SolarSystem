import * as THREE from "../node_modules/three/build/three.module.js"
import { Body, PhysicsEngine } from "./physics_engine.js";

function main(){
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas}); 
  
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  const physics = new PhysicsEngine(10);

  camera.position.z = 80; 
  camera.position.y = 20;

  camera.lookAt(15, 0, 0);

  const planetData = [
    {name: 'Sun', texturePath: 'textures/sun.jpg', radius: 3, distance: 0, mass: 10000, vy: 0},
    {name: 'Earth', texturePath: 'textures/earth.jpg', radius: 1, distance: 10, mass: 1, vy: 30}, 
    {name: 'Mars', texturePath: 'textures/mars.jpg', radius: 0.53, distance: 15, mass: 0.1, vy: 25},
  ]

  const scene = new THREE.Scene();

  const baseGeometry = new THREE.SphereGeometry(1,32,32);
  const textureLoader = new THREE.TextureLoader();

  const planets = [];

  planetData.forEach((data, index) => {
    const texture = textureLoader.load(data.texturePath);
    const material = new THREE.MeshPhongMaterial({map: texture});

    const planetMesh = new THREE.Mesh(baseGeometry, material);

    planetMesh.scale.set(data.radius, data.radius, data.radius);

    planetMesh.position.x = data.distance;
    
    planetMesh.name = data.name;
    
    physics.addBody(data.distance, 0, 0, 0, data.vy, 0, data.mass, data.radius);
    
    planetMesh.userData.physicsIndex = index;

    scene.add(planetMesh);
    planets.push(planetMesh);
  });

  const light = new THREE.PointLight(0xffffff, 30, 100);
  light.position.set(2, 2, 10);
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); 
  scene.add(ambientLight);

  const dt = 0.016;

  function render(time){
    if(resizeRenderer(renderer)){ 
      const canvas = renderer.domElement; 
      camera.aspect = canvas.clientWidth / canvas.clientHeight; 
      camera.updateProjectionMatrix();    
    }

    physics.step(dt)

    planets.forEach((planet) => {
    const pIndex = planet.userData.physicsIndex * physics.STRIDE;
    
    planet.position.x = physics.data[pIndex + 0];
    planet.position.y = physics.data[pIndex + 1];
    planet.position.z = physics.data[pIndex + 2];
    
  });
   
    renderer.render(scene, camera);
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



main();
