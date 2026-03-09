import * as THREE from "../node_modules/three/build/three.module.js"

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight
);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);

document.body.appendChild(renderer.domElement);

const geometry = new THREE.SphereGeometry(1);
const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });

const sun = new THREE.Mesh(geometry, material);
scene.add(sun);

camera.position.z = 5;

function animate() {
  requestAnimationFrame(animate);
  sun.rotation.y += 0.01;
  renderer.render(scene, camera);
}
  
animate();
