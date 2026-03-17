import * as THREE from "../node_modules/three/build/three.module.js"


function main(){
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas}); 
  
  const camera = new THREE.PerspectiveCamera(75, 2, 0.1, 100);
  camera.position.z = 5;

  const scene = new THREE.Scene();

  const geometry = new THREE.SphereGeometry(2, 32, 32);
  const material = new THREE.MeshPhongMaterial({
    color: 0xf1c818,
    emissive: 0xf1c818,
    emissiveIntensity: 0.6,
  });

  const sun = new THREE.Mesh(geometry, material); 
  scene.add(sun);

  const light = new THREE.PointLight(0xffffff, 2, 100);
  light.position.set(5, 5, 5);
  scene.add(light);

  function render(time){
    time *= 0.001; 
      if(resizeRenderer(renderer)){ 
        const canvas = renderer.domElement; 
        camera.aspect = canvas.clientWidth / canvas.clientHeight; 
        camera.updateProjectionMatrix();    
      }

    sun.rotation.y = time;

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