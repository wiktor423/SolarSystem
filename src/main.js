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
// GPU drivers. WORLD_LIMIT is far beyond the camera's far plane (4000), so
// clamped bodies are simply frustum-culled.
const WORLD_LIMIT = 20000;
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

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

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

  // The far plane must clear the star shell (radius ~1900); the near plane is
  // pulled out to 0.5 to buy back the depth-buffer precision that the wider
  // far/near ratio would otherwise cost. The smallest rendered body has a
  // radius of 0.05, so 0.5 never clips anything the camera can reach.
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.5, 4000);
  camera.position.z = 95;
  camera.position.y = 52;
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 6;
  controls.maxDistance = 1200;   // stay inside the star shell

  const scene = new THREE.Scene();
  // Inverse-square falloff over a system that now reaches d = 155 needs a
  // much larger nominal intensity than the old d = 115 layout: irradiance at
  // Earth's orbit (d = 30) is 900/30^2 = 1.0, and the filmic tone curve rolls
  // off the resulting overexposure at Mercury (4.6) instead of clipping it.
  // The faint blue ambient term keeps the night sides from going pure black.
  const light = new THREE.PointLight(0xfff4e0, 900, 900);
  light.position.set(0, 0, 0);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x33405e, 2));

  // Star background: two point layers on a spherical shell rather than a cube.
  // A shell reads as a distant sky from every camera angle, whereas a filled
  // cube puts individual stars close to the camera, where perspective makes
  // them look like foreground debris. Size attenuation is disabled so a star
  // keeps a constant pixel size regardless of camera distance.
  function makeStarLayer(count, radius, size, opacity, hueSpread) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Uniform sampling on the sphere: z is uniform in [-1,1], not the polar
      // angle, which would otherwise crowd the poles.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = radius * (0.9 + Math.random() * 0.2);
      pos[i * 3 + 0] = r * s * Math.cos(theta);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(theta);
      // Stellar colours run blue-white to orange; a narrow hue band around
      // the blue/amber ends keeps the field from looking like confetti.
      c.setHSL(Math.random() < 0.5 ? 0.58 + Math.random() * hueSpread
                                   : 0.09 - Math.random() * hueSpread,
               0.35, 0.72 + Math.random() * 0.28);
      col[i * 3 + 0] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity, depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }
  scene.add(makeStarLayer(7000, 1700, 1.1, 0.55, 0.05));  // faint background
  scene.add(makeStarLayer(700,  1700, 1.5, 0.45, 0.05));  // bright foreground

  // `rotationHours` is the sidereal rotation period and `tiltDeg` the axial
  // obliquity, both real values (NASA planetary fact sheets). Bodies always
  // spin the same way about their own +Y axis; retrograde rotation falls out
  // of an obliquity past 90 degrees, which is how Venus (177.4) and Uranus
  // (97.8) are actually described — no separate direction flag needed.
  // `mass` is the true Sun-to-planet mass ratio expressed in the simulation's
  // normalized unit system (G = 1, M_sun = 10000), i.e. m = 10000 / (M_sun/M_p)
  // with the ratios taken from the IAU/NASA planetary fact sheets. `vz` is the
  // circular-orbit speed sqrt(G*M_sun/d) = 100/sqrt(d) for the listed radius,
  // so every entry is dynamically consistent with its own distance.
  // `distance` is the only quantity deliberately unfaithful to reality: the
  // orbital radii are compressed for legibility (Section 2.5 of the thesis).
  const planetData = [
    {name: 'Sun',     texturePath: 'textures/sun-texture.jpg', radius: 3,    distance: 0,   mass: 10000,    vz: 0,     trailColor: 0xffcc33, rotationHours: 609.12, tiltDeg: 7.25},
    {name: 'Mercury', texturePath: 'textures/mercury.jpg',     radius: 0.2,  distance: 14,  mass: 0.00166,  vz: 26.73, trailColor: 0xaaaaaa, rotationHours: 1407.6, tiltDeg: 0.03},
    {name: 'Venus',   texturePath: 'textures/venus.jpg',       radius: 0.9,  distance: 22,  mass: 0.02448,  vz: 21.32, trailColor: 0xffaa00, rotationHours: 5832.5, tiltDeg: 177.36},
    {name: 'Earth',   texturePath: 'textures/earth.jpg',       radius: 1,    distance: 30,  mass: 0.03003,  vz: 18.26, trailColor: 0x4488ff, rotationHours: 23.93,  tiltDeg: 23.44},
    //{name: 'Moon',    texturePath: 'textures/moon.jpg',    radius: 0.01, distance: 22.1,   mass: 0.0003,vz: 21.86},
    {name: 'Mars',    texturePath: 'textures/mars.jpg',        radius: 0.53, distance: 41,  mass: 0.003227, vz: 15.62, trailColor: 0xff4422, rotationHours: 24.62,  tiltDeg: 25.19},
    {name: 'Jupiter', texturePath: 'textures/jupiter.jpg',     radius: 2.5,  distance: 74,  mass: 9.548,    vz: 11.62, trailColor: 0xffaa77, rotationHours: 9.93,   tiltDeg: 3.13},
    {name: 'Saturn',  texturePath: 'textures/saturn.jpg',      radius: 2.1,  distance: 101, mass: 2.859,    vz: 9.95,  trailColor: 0xeeddcc, rotationHours: 10.66,  tiltDeg: 26.73},
    {name: 'Uranus',  texturePath: 'textures/uranus.jpg',      radius: 1.5,  distance: 128, mass: 0.4366,   vz: 8.84,  trailColor: 0x88ccff, rotationHours: 17.24,  tiltDeg: 97.77},
    {name: 'Neptune', texturePath: 'textures/neptune.jpg',     radius: 1.5,  distance: 155, mass: 0.5151,   vz: 8.03,  trailColor: 0x4444ff, rotationHours: 16.11,  tiltDeg: 28.32},
  ];

  // Spin speed is 1/rotationHours scaled by a single constant, so the ratios
  // between bodies are exactly the real ones. The constant only sets the
  // absolute pace: Earth turns once per ~360 frames (~6 s at 60 fps), which
  // leaves Jupiter visibly fast and Venus nearly frozen, as in reality.
  // True proportionality to the orbital timescale is not usable here — one
  // orbit of Earth takes ~27 s in this sim, which would put its day at 0.07 s.
  const SPIN_SCALE = 0.416; // radians * hours, per frame
  const TWO_PI = Math.PI * 2;

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
    if (!textureCache.has(path)) {
      const tex = textureLoader.load(path);
      // Since three r152 a loaded texture defaults to NoColorSpace. Colour maps
      // authored as sRGB JPEGs must say so explicitly, otherwise the renderer
      // treats their values as linear and applies the output transform twice,
      // which is what washed the planet surfaces out.
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      textureCache.set(path, tex);
    }
    return textureCache.get(path);
  }

  // Radial-gradient billboard used as the Sun's corona. Generated once into a
  // canvas rather than shipped as an asset, and cached for the lifetime of the
  // page so that resets never dispose it.
  let glowTexture = null;
  function getGlowTexture() {
    if (glowTexture) return glowTexture;
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.00, 'rgba(255,244,214,1.0)');
    g.addColorStop(0.18, 'rgba(255,206,122,0.55)');
    g.addColorStop(0.45, 'rgba(255,150,60,0.16)');
    g.addColorStop(1.00, 'rgba(255,120,40,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    glowTexture = new THREE.CanvasTexture(cv);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    return glowTexture;
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
      p.children.forEach(child => {          // Saturn's ring, the Sun's corona
        // A Sprite draws from a geometry shared by every sprite in the module;
        // disposing it would break any sprite created after the next reset.
        // Only the per-instance material is owned here, and the corona's
        // texture is cached, so it must not be disposed either.
        if (!child.isSprite) child.geometry.dispose();
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

      // Default Euler order 'XYZ' composes as Rx * Ry, i.e. the Y spin is
      // applied first and the X obliquity tips the already-spinning body —
      // so rotation.y stays a rotation about the planet's own axis.
      planetMesh.rotation.x = THREE.MathUtils.degToRad(data.tiltDeg);
      planetMesh.userData.spinPerFrame = SPIN_SCALE / data.rotationHours;

      if (data.name === 'Sun') {
        // Additive corona billboard. One extra draw call per frame, no
        // post-processing pass: the glow is a textured quad, not bloom.
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }));
        // Sprite scale is in the parent's local units, and the Sun mesh is
        // already scaled by its radius, so 4 gives a corona four solar radii
        // across.
        glow.scale.set(4.2, 4.2, 1);
        planetMesh.add(glow);
      }

     if(data.name == 'Saturn'){
        const ringGeometry = new THREE.RingGeometry(1.2, 1.7, 64);

        const ringMaterial = new THREE.MeshBasicMaterial({
          map: getTexture("textures/saturn_ring.png"),
          side: THREE.DoubleSide, 
          transparent: true,
          opacity: 0.8
        });  

        const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        
        // The ring lies in Saturn's equatorial plane, so as a child of the
        // planet it only needs the flat RingGeometry laid into the local XZ
        // plane; Saturn's own 26.7 degree obliquity then tips it along.
        ringMesh.rotation.x = Math.PI / 2;
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
        // The trail window is a compromise between showing the orbit shape and
        // not letting the lines dominate the image. At 3000 points sampled
        // every other frame the window spans 6000 frames, i.e. a little over
        // two Earth orbits, so the trail reads as a path rather than as a
        // solid ring drawn over itself many times.
        const maxTrailPoints = 3000;
        const trailGeometry = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(maxTrailPoints * 3);
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeometry.setDrawRange(0, 0);

        const trailMaterial = new THREE.LineBasicMaterial({
          color: data.trailColor || 0xffffff,
          transparent: true,
          opacity: 0.12,
          depthWrite: false
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
    // Flat shading on the 12-face solid gives each rock visible facets that
    // catch the Sun individually, which reads far better than the previous
    // white high-specular sphere-like blobs. The base colour is white because
    // per-instance colours multiply it.
    const rockMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff, specular: 0x2a2a2a, shininess: 4, flatShading: true
    });
    asteroidMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ASTEROID_COUNT);
    asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(asteroidMesh);

    asteroidRadii = new Float32Array(ASTEROID_COUNT);
    const rockColor = new THREE.Color();

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      // The belt sits between Mars (d = 41) and Jupiter (d = 74), as in the
      // real Solar System.
      const distance = 44 + Math.random() * 27;
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

      
      let spinAngle = planet.rotation.y + planet.userData.spinPerFrame;
      if (spinAngle > TWO_PI) spinAngle -= TWO_PI;
      planet.rotation.y = spinAngle;

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
