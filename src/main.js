import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PhysicsEngineJS } from './physics_engine.js';
import Chart from 'chart.js/auto';

//====GLOBAL=STATE=====

let useWasm = true;
let ASTEROID_COUNT = 1400; //default value, matches the UI inputs
const MAX_ASTEROIDS = 50000;

// Close encounters with the softened potential are not energy-bounded, so
// slingshot-ejected bodies can reach extreme coordinates. Nothing non-finite
// or absurdly large may ever be written into a GPU buffer (instance matrices,
// trail vertices): NaN/Inf vertex data is undefined-behaviour territory for
// GPU drivers. WORLD_LIMIT is far beyond the camera's far plane (1000), so
// clamped bodies are simply frustum-culled.
const WORLD_LIMIT = 5000;
function safeCoord(v) {
  if (!Number.isFinite(v)) return WORLD_LIMIT;
  return v > WORLD_LIMIT ? WORLD_LIMIT : (v < -WORLD_LIMIT ? -WORLD_LIMIT : v);
}
let activePosMass = null;
let activeVel = null;
let asteroidRadii = null;
// isResetting: true while a reset is running (render loop skips physics steps).
// queuedReset: a reset was requested while one was already running; will be
//              re-run automatically with the latest UI settings once done.
// resetEpoch: bumped at the start of every reset so an in-flight frame that
//             resumes after its awaited step can detect it belongs to a
//             previous simulation and bail out.
let isResetting = false;
let queuedReset = false;
let resetEpoch = 0;

const timeDisplay = document.getElementById('physics-time-display');
const fpsDisplay = document.getElementById('physics-fps-display');
let lastUiUpdateTime = 0;

let frameCounter = 0;
const max_frames = 1000;
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
  if (!crossOriginIsolated) {
    console.error(
      'Multithreading requires cross-origin isolation (COOP/COEP headers). ' +
      'Start the app with: python server.py'
    );
    alert(
      'Multithreading requires cross-origin isolation.\n\n' +
      'Please start the server with:\n  python server.py\n\n' +
      'Then open http://localhost:8000'
    );
    return;
  }

  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({antialias: true, canvas});

  // If the GPU driver resets (or the browser evicts the context), stop all
  // GL work until the context comes back instead of hammering a dead/
  // recovering context — resubmitting during driver recovery is exactly how
  // one reset cascades into the next. Three.js re-uploads geometries and
  // textures itself once the context is restored.
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // signal that we handle restoration
    contextLost = true;
    console.warn('WebGL context lost — pausing rendering until restored.');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    console.warn('WebGL context restored — resuming rendering.');
  });

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
  // WASM ENGINE WORKER LIFECYCLE
  // ===============================================
  // The worker is created lazily when the WASM engine is selected and
  // terminated when switching to the JS engine. Terminating it also tears
  // down the Emscripten pthread pool workers it spawned and releases the
  // module's growable shared WASM heap — otherwise 17 orphaned workers and
  // their memory stay alive alongside the JS engine's 16 workers.

  let wasmWorker = null;
  const wasmPending = new Map();
  let wasmRequestId = 1;

  function ensureWasmWorker() {
    if (wasmWorker) return;
    wasmWorker = new Worker(new URL('./wasm_worker.js', import.meta.url), { type: 'module' });

    wasmWorker.onmessage = (e) => {
      const pending = wasmPending.get(e.data.requestId);
      if (!pending) return;
      wasmPending.delete(e.data.requestId);

      if (e.data.type === 'init_done') {
        // Size the views from the request echoed back by the worker, never
        // from global state that a later reset may already have changed.
        const wasmPosMass = new Float64Array(e.data.buffer, e.data.posMassPtr, e.data.maxBodies * 4);
        const wasmVel = new Float64Array(e.data.buffer, e.data.velPtr, e.data.maxBodies * 3);
        pending.resolve({ wasmPosMass, wasmVel });
      } else if (e.data.type === 'done') {
        pending.resolve();
      } else if (e.data.type === 'error') {
        console.error('WASM worker error:', e.data.message, e.data.stack);
        pending.reject(new Error(e.data.message));
      }
    };

    const worker = wasmWorker;
    worker.onerror = (err) => {
      // A stale error event from an already-replaced worker must not tear
      // down its successor.
      if (wasmWorker !== worker) return;
      // An ErrorEvent (.message set) is a runtime error that escaped the
      // worker; a plain Event means the worker never started — its module
      // script failed to fetch/parse, or the browser killed it (e.g. OOM).
      console.error('WASM worker crashed:', err.message ||
        'worker failed to start (script fetch failed or the browser killed the worker)');
      disposeWasmWorker();
    };
  }

  function disposeWasmWorker() {
    if (!wasmWorker) return;
    wasmWorker.terminate();
    wasmWorker = null;
    // Settle every in-flight request so an awaiting render frame or reset
    // can bail out instead of hanging forever on a dead worker.
    for (const pending of wasmPending.values()) {
      pending.reject(new Error('WASM worker disposed'));
    }
    wasmPending.clear();
  }

  function wasmRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!wasmWorker) {
        reject(new Error('WASM worker is not running'));
        return;
      }
      const requestId = wasmRequestId++;
      wasmPending.set(requestId, { resolve, reject });
      wasmWorker.postMessage({ type, requestId, ...payload });
    });
  }

  let jsEngine = null; 

  // Mesh setup
  const baseGeometry = new THREE.SphereGeometry(1,32,32);
  const textureLoader = new THREE.TextureLoader();
  // Textures are cached across resets; only materials/geometries are rebuilt.
  const textureCache = new Map();
  function getTexture(path) {
    if (!textureCache.has(path)) textureCache.set(path, textureLoader.load(path));
    return textureCache.get(path);
  }
  let planets = [];
  let asteroidMesh = null;
  const dummy = new THREE.Object3D();

  // ===============================================
  // RESET FUNCTION 
  // ===============================================

  async function resetSimulation() {
    // Null buffers immediately so the render loop skips during the entire reset.
    resetEpoch++;
    activePosMass = null;
    activeVel = null;

    useWasm = document.getElementById('engine-select').value === "WASM";
    const requestedCount = parseInt(document.getElementById('asteroid-input').value, 10);
    ASTEROID_COUNT = Number.isFinite(requestedCount)
      ? Math.min(Math.max(requestedCount, 0), MAX_ASTEROIDS)
      : 1400;
    document.getElementById('asteroid-input').value = ASTEROID_COUNT;

    perfChart.data.datasets[0].data = Array(maxDataPoints).fill(0);
    perfChart.data.datasets[0].borderColor = useWasm ? '#4CAF50' : '#FF9800';
    perfChart.update();

    const TOTAL_BODIES = planetData.length + ASTEROID_COUNT;

    //clear benchmark data
    frameCounter = 0;
    benchmarkData = [["Frame", "AsteroidCount", "PhysicsTime_ms", "RenderTime_ms"]];
    const exportBtn = document.getElementById('export-csv-btn');
    if (exportBtn) exportBtn.disabled = true;
    const progDisplay = document.getElementById('benchmark-progress');
    if (progDisplay) progDisplay.textContent = '0 / 1000';

    //clear the scene, releasing GPU resources of the previous run
    //(textures are cached and reused; baseGeometry is shared and kept)
    planets.forEach(p => {
      scene.remove(p);
      p.material.dispose();
      p.children.forEach(child => {          // Saturn's ring
        child.geometry.dispose();
        child.material.dispose();
      });
      if (p.userData.trail) {
        scene.remove(p.userData.trail.mesh);
        p.userData.trail.mesh.geometry.dispose();
        p.userData.trail.mesh.material.dispose();
      }
    });
    if (asteroidMesh) {
      scene.remove(asteroidMesh);
      asteroidMesh.geometry.dispose();
      asteroidMesh.material.dispose();
      asteroidMesh.dispose();
      asteroidMesh = null;
    }
    planets = [];

    if (jsEngine) {
      jsEngine.dispose();
      jsEngine = null;
    }

    if (useWasm) {
      ensureWasmWorker();
      let ptrs;
      try {
        ptrs = await wasmRequest('init', { maxBodies: TOTAL_BODIES });
      } catch (err) {
        // A worker that dies during startup (transient script-fetch failure,
        // browser-side kill) surfaces here as a rejected init. One retry with
        // a fresh worker recovers the transient case; a persistent failure
        // still propagates to enqueueReset.
        console.warn('WASM init failed, retrying with a fresh worker:', err.message);
        disposeWasmWorker();
        ensureWasmWorker();
        ptrs = await wasmRequest('init', { maxBodies: TOTAL_BODIES });
      }
      activePosMass = ptrs.wasmPosMass;
      activeVel = ptrs.wasmVel;
    } else {
      // Switching away from WASM: kill the worker, its pthread pool and the
      // shared WASM heap so they don't linger for the whole JS run.
      disposeWasmWorker();
      jsEngine = new PhysicsEngineJS(TOTAL_BODIES);
      activePosMass = jsEngine.posMass;
      activeVel = jsEngine.vel;
    }

    let currentBodyIndex = 0; 

    planetData.forEach((data) => {
      let material = data.name == 'Sun' ?
          new THREE.MeshBasicMaterial({ map: getTexture(data.texturePath) }) :
          new THREE.MeshPhongMaterial({ map: getTexture(data.texturePath), shininess: 10 });

      const planetMesh = new THREE.Mesh(baseGeometry, material);
      planetMesh.scale.set(data.radius, data.radius, data.radius);
      planetMesh.position.x = data.distance;

     if(data.name == 'Saturn'){
        const ringGeometry = new THREE.RingGeometry(1.2, 1.7, 64); 
        
        const ringMaterial = new THREE.MeshBasicMaterial({
          map: getTexture("textures/saturn_ring.png"),
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

    asteroidRadii = new Float32Array(ASTEROID_COUNT);

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
      asteroidRadii[i] = radius;

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
      dummy.rotation.set(i * 2.4, i * 1.7, 0);
      dummy.position.set(activePosMass[pmIdx + 0], activePosMass[pmIdx + 1], activePosMass[pmIdx + 2]);
      dummy.updateMatrix();
      asteroidMesh.setMatrixAt(i, dummy.matrix);

      currentBodyIndex++;
    }

    // Pre-calculate Frame 0 Gravity
    if(useWasm){
      await wasmRequest('preCalc');
    } else {
      await jsEngine.preCalculateAccelerations(TOTAL_BODIES); 
    }

    console.log(`Simulation Reset: ${useWasm ? "WASM" : "JS"} with ${ASTEROID_COUNT} asteroids.`);
  }

  // Queue-last reset: if a reset is already running, remember to run one more
  // after it finishes (using the latest UI settings at that point).
  async function enqueueReset() {
    if (isResetting) {
      queuedReset = true;
      return;
    }
    isResetting = true;
    queuedReset = false;
    try {
      await resetSimulation();
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      isResetting = false;
      if (queuedReset) enqueueReset();
    }
  }

  
  document.getElementById('restart-btn').addEventListener('click', async () => { await enqueueReset(); });

  //every time the page loads
  //resetSimulation();

  // ===============================================
  // RENDER 
  // ===============================================
  const dt = 0.004;

  async function render(time){
    if (contextLost) {
      requestAnimationFrame(render);
      return;
    }

    if(resizeRenderer(renderer)){
      const canvas = renderer.domElement; 
      camera.aspect = canvas.clientWidth / canvas.clientHeight; 
      camera.updateProjectionMatrix();    
    }

    if (isResetting || !activePosMass || !asteroidMesh) {
      requestAnimationFrame(render);
      return;
    }

    const epochAtFrame = resetEpoch;
    const t0 = performance.now();

    try {
      if(useWasm){
        await wasmRequest('step', { dt: dt });
      } else {
        await jsEngine.step(dt);
      }
    } catch {
      // A reset started while we were awaiting; bail out and let the render
      // loop reschedule itself once the reset finishes.
      requestAnimationFrame(render);
      return;
    }

    // Drop the frame if any reset began while the step was in flight, even
    // one that already finished (the step result belongs to the old world).
    if (isResetting || epochAtFrame !== resetEpoch || !activePosMass || !asteroidMesh) {
      requestAnimationFrame(render);
      return;
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
      const px = safeCoord(activePosMass[pIndex + 0]);
      const py = safeCoord(activePosMass[pIndex + 1]);
      const pz = safeCoord(activePosMass[pIndex + 2]);
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
            // Shift the whole window left by one point (fast memmove)
            trail.positions.copyWithin(0, 3);
            trail.positions[(trail.maxPoints - 1) * 3] = px;
            trail.positions[(trail.maxPoints - 1) * 3 + 1] = py;
            trail.positions[(trail.maxPoints - 1) * 3 + 2] = pz;
          }
          trail.mesh.geometry.attributes.position.needsUpdate = true;
        }
      }
    });

    const asteroidPhysicsStartIndex = planetData.length;
    const spin = time * 0.0005;
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const pIndex = (asteroidPhysicsStartIndex + i) * 4;
      dummy.position.set(
        safeCoord(activePosMass[pIndex + 0]),
        safeCoord(activePosMass[pIndex + 1]),
        safeCoord(activePosMass[pIndex + 2])
      );
      // Per-asteroid size and a slow deterministic tumble; the shared dummy
      // must be fully re-set every instance, it carries state otherwise.
      dummy.scale.setScalar(asteroidRadii[i]);
      dummy.rotation.set(spin + i * 2.4, spin * 0.7 + i * 1.7, 0);
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
      const progDisplay = document.getElementById('benchmark-progress');
      if (progDisplay) progDisplay.textContent = `${frameCounter + 1} / ${max_frames}`;
    } else if(frameCounter === max_frames){
      const exportBtn = document.getElementById('export-csv-btn');
      if (exportBtn) exportBtn.disabled = false;
      const progDisplay = document.getElementById('benchmark-progress');
      if (progDisplay) progDisplay.textContent = 'Ready';
    }
    frameCounter++;

    requestAnimationFrame(render);
  } 
  let renderLoopStarted = false;
  document.getElementById('enter-sim-btn').addEventListener('click', async () => {
    // Guard against double-clicks: a second click would start a second
    // concurrent render loop, doubling the physics rate.
    if (renderLoopStarted) return;
    renderLoopStarted = true;
    document.getElementById('enter-sim-btn').disabled = true;

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

    await enqueueReset();
    requestAnimationFrame(render);
  });

  document.getElementById('export-csv-btn').addEventListener('click', () => { exportToCSV(); });
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
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log(`benchmark exported (${benchmarkData.length - 1} frames)`);
}

main();
