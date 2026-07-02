/* ============================================================
   BioVirtua scenes.js: Three.js r128 procedural device + per-page
   scenes. One WebGL canvas per page, lazy-init after first paint,
   DPR capped, paused offscreen, disposed on unload. All guarded.
   Feature-detects WebGL; falls back to CSS posters otherwise.
   ============================================================ */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.matchMedia('(max-width: 860px)').matches;
  const LOWPOWER = MOBILE || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  // Finish palettes for the device
  const FINISH = {
    Graphite: { body: 0x2b2926, base: 0x151311, glass: 0x0b0a09, chamfer: 0x6f665c, wordmark: 0x8a8178 },
    Bone: { body: 0xe7e0d2, base: 0xc7b18a, glass: 0x14110e, chamfer: 0xe9ddc5, wordmark: 0x6a6155 }
  };

  let THREE = null;

  /* ------------------------------------------------------------
     Device builder: the ONE canonical Meridian, reused everywhere.
     Returns { group, setFinish, ledMat, glassMat, internals }.
     Units: ~ device 1.65 tall (represents 165mm), base radius ~0.9.
     ------------------------------------------------------------ */
  function buildDevice(opts) {
    opts = opts || {};
    const finish = opts.finish || 'Graphite';
    const g = new THREE.Group();

    const pal = FINISH[finish];

    // ----- rounded slab body (extruded rounded rect) -----
    function roundedRectShape(w, h, r) {
      const s = new THREE.Shape();
      const x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y);
      s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r);
      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r);
      s.quadraticCurveTo(x, y, x + r, y);
      return s;
    }
    const bodyW = 0.62, bodyH = 1.65, bodyDepth = 0.32, corner = 0.12;
    const shape = roundedRectShape(bodyW, bodyH, corner);
    const extrude = new THREE.ExtrudeGeometry(shape, { depth: bodyDepth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, steps: 1, curveSegments: 20 });
    extrude.center();
    const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.72, metalness: 0.18 });
    const body = new THREE.Mesh(extrude, bodyMat);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // ----- Fresnel-ish emissive rim shell so the dark device reads on dark bg -----
    const rimMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0xE8A13C) }, uPower: { value: 2.6 }, uIntensity: { value: 0.55 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-wp.xyz); gl_Position = projectionMatrix * wp; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uPower; uniform float uIntensity; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), uPower); gl_FragColor = vec4(uColor * f * uIntensity, f); }'
    });
    const rim = new THREE.Mesh(extrude.clone(), rimMat);
    rim.scale.setScalar(1.06);
    g.add(rim);

    // ----- full-height dark glass front plane -----
    const glassGeo = new THREE.PlaneGeometry(bodyW * 0.82, bodyH * 0.9);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: pal.glass, roughness: 0.08, metalness: 0.0, transmission: 0.0, transparent: true, opacity: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 0.6 });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 0, bodyDepth / 2 + 0.035);
    g.add(glass);

    // ----- depth-camera array behind glass, near top -----
    const internals = new THREE.Group();
    internals.position.set(0, bodyH * 0.30, bodyDepth / 2 + 0.005);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.25, metalness: 0.85 });
    const lensRingMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.4, metalness: 0.9 });
    const glassBlueMat = new THREE.MeshStandardMaterial({ color: 0x22323a, roughness: 0.1, metalness: 0.6, emissive: 0x0a1416, emissiveIntensity: 0.4 });
    // top lens
    function makeLens(y, r) {
      const grp = new THREE.Group(); grp.position.y = y;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 28), lensRingMat);
      ring.rotation.x = Math.PI / 2; grp.add(ring);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.07, 28), lensMat);
      inner.rotation.x = Math.PI / 2; inner.position.z = 0.005; grp.add(inner);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.09, 20), glassBlueMat);
      dot.rotation.x = Math.PI / 2; dot.position.z = 0.008; grp.add(dot);
      return grp;
    }
    const lensTop = makeLens(0.16, 0.075);
    const lensBot = makeLens(-0.16, 0.075);
    internals.add(lensTop, lensBot);
    // textured depth-sensor window between the lenses
    const sensorGeo = new THREE.BoxGeometry(0.18, 0.11, 0.03);
    const sensorMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.35, metalness: 0.7, emissive: 0x0c1518, emissiveIntensity: 0.25 });
    const sensor = new THREE.Mesh(sensorGeo, sensorMat);
    internals.add(sensor);
    // small dot grid texture suggestion on the sensor
    const dotGeo = new THREE.SphereGeometry(0.006, 6, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x2b4a52 });
    for (let ix = -2; ix <= 2; ix++) for (let iy = -1; iy <= 1; iy++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.set(ix * 0.032, iy * 0.032, 0.018);
      sensor.add(d);
    }
    g.add(internals);

    // ----- emissive LED slot low on the front -----
    const ledGeo = new THREE.BoxGeometry(bodyW * 0.5, 0.028, 0.02);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xE8A13C, emissiveIntensity: 1.6, roughness: 0.3 });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, -bodyH * 0.32, bodyDepth / 2 + 0.04);
    g.add(led);

    // ----- wordmark plate (BIOVIRTUA): thin light bar to suggest letterspaced text, no gibberish -----
    const wmCanvas = document.createElement('canvas'); wmCanvas.width = 512; wmCanvas.height = 64;
    const wctx = wmCanvas.getContext('2d');
    wctx.clearRect(0, 0, 512, 64);
    wctx.fillStyle = 'rgba(' + hexRGB(pal.wordmark) + ',0.9)';
    wctx.font = '600 30px "IBM Plex Mono", monospace';
    wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
    wctx.letterSpacing = '10px';
    wctx.fillText('BIOVIRTUA', 256, 34);
    const wmTex = new THREE.CanvasTexture(wmCanvas);
    wmTex.anisotropy = 4;
    const wmMat = new THREE.MeshBasicMaterial({ map: wmTex, transparent: true });
    const wmGeo = new THREE.PlaneGeometry(bodyW * 0.6, bodyW * 0.6 * 64 / 512);
    const wm = new THREE.Mesh(wmGeo, wmMat);
    wm.position.set(0, -bodyH * 0.11, bodyDepth / 2 + 0.037);
    g.add(wm);

    // ----- circular aluminum base -----
    const baseMat = new THREE.MeshStandardMaterial({ color: pal.base, roughness: 0.5, metalness: 0.7 });
    const chamferMat = new THREE.MeshStandardMaterial({ color: pal.chamfer, roughness: 0.25, metalness: 0.9 });
    const baseGrp = new THREE.Group();
    const baseR = 0.9, baseH = 0.12;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR * 0.98, baseH, 48), baseMat);
    base.receiveShadow = true; base.castShadow = true;
    baseGrp.add(base);
    const chamfer = new THREE.Mesh(new THREE.TorusGeometry(baseR * 0.99, 0.012, 12, 48), chamferMat);
    chamfer.rotation.x = Math.PI / 2; chamfer.position.y = baseH / 2; baseGrp.add(chamfer);
    baseGrp.position.y = -bodyH / 2 - baseH / 2 + 0.02;
    g.add(baseGrp);
    g.userData.base = baseGrp;
    g.userData.body = body;
    g.userData.rim = rim;
    g.userData.led = led;

    function setFinish(name) {
      const p = FINISH[name] || FINISH.Graphite;
      bodyMat.color.setHex(p.body);
      baseMat.color.setHex(p.base);
      chamferMat.color.setHex(p.chamfer);
      glassMat.color.setHex(p.glass);
      // regen wordmark color
      wctx.clearRect(0, 0, 512, 64);
      wctx.fillStyle = 'rgba(' + hexRGB(p.wordmark) + ',0.9)';
      wctx.font = '600 30px "IBM Plex Mono", monospace';
      wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
      wctx.letterSpacing = '10px';
      wctx.fillText('BIOVIRTUA', 256, 34);
      wmTex.needsUpdate = true;
    }

    return { group: g, setFinish: setFinish, ledMat: ledMat, glassMat: glassMat, internals: internals, dims: { bodyH: bodyH, bodyDepth: bodyDepth, baseH: baseH } };
  }

  function hexRGB(hex) {
    const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
    return r + ',' + gg + ',' + b;
  }

  /* ------------------------------------------------------------
     Environment: simple gradient env map via PMREM from a scene.
     ------------------------------------------------------------ */
  function makeEnv(renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      // gradient background sphere
      const geo = new THREE.SphereGeometry(8, 24, 24);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: new THREE.Color(0x40372e) }, bot: { value: new THREE.Color(0x0d0b0a) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bot, top, h), 1.0); }'
      });
      envScene.add(new THREE.Mesh(geo, mat));
      // a couple of warm emissive panels for reflections
      const panelMat = new THREE.MeshBasicMaterial({ color: 0xE8A13C });
      const p1 = new THREE.Mesh(new THREE.PlaneGeometry(3, 6), panelMat); p1.position.set(4, 1, 2); p1.lookAt(0, 0, 0); envScene.add(p1);
      const panelMat2 = new THREE.MeshBasicMaterial({ color: 0x7FD8DA });
      const p2 = new THREE.Mesh(new THREE.PlaneGeometry(2, 4), panelMat2); p2.position.set(-4, 0, -1); p2.lookAt(0, 0, 0); envScene.add(p2);
      const tex = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
      return tex;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------
     Renderer harness: builds renderer/scene/camera, handles
     resize, pause offscreen, dispose. Returns control object.
     ------------------------------------------------------------ */
  function makeStage(container, opts) {
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ antialias: !LOWPOWER, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure || 1.05;
    if (opts.shadows && !LOWPOWER) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(opts.fov || 38, w / h, 0.1, 100);
    camera.position.set(0, 0, opts.camZ || 6);

    let env = null;
    if (opts.env !== false) { env = makeEnv(renderer); if (env) scene.environment = env; }

    let running = false, rafId = null, visible = true, tabHidden = false;
    const clock = new THREE.Clock();
    let updateFn = function () {};

    function resize() {
      const nw = container.clientWidth || 1, nh = container.clientHeight || 1;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    function loop() {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      if (!visible || tabHidden) return;
      const dt = clock.getDelta(), t = clock.elapsedTime;
      updateFn(dt, t);
      renderer.render(scene, camera);
    }
    function start() { if (running) return; running = true; clock.start(); loop(); }
    function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); }

    // pause offscreen
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.01 });
    io.observe(container);
    document.addEventListener('visibilitychange', () => { tabHidden = document.hidden; });

    function dispose() {
      stop();
      io.disconnect();
      window.removeEventListener('resize', resize);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach((mm) => { for (const k in mm) { if (mm[k] && mm[k].isTexture) mm[k].dispose(); } mm.dispose && mm.dispose(); }); }
      });
      if (env) env.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }

    return {
      renderer: renderer, scene: scene, camera: camera, env: env,
      setUpdate: (fn) => { updateFn = fn; },
      start: start, stop: stop, dispose: dispose, resize: resize,
      isVisible: () => visible
    };
  }

  function addLights(scene, opts) {
    opts = opts || {};
    const key = new THREE.DirectionalLight(0xfff3e2, opts.key || 1.4);
    key.position.set(3, 5, 4);
    if (opts.shadows) { key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 20; key.shadow.bias = -0.0004; }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7FD8DA, opts.fill || 0.35);
    fill.position.set(-4, 1, -2); scene.add(fill);
    const amb = new THREE.AmbientLight(0x2a241f, opts.amb || 0.6); scene.add(amb);
    const rim = new THREE.PointLight(0xE8A13C, opts.rim || 0.8, 12); rim.position.set(-2, -1, 3); scene.add(rim);
    return { key: key, fill: fill, amb: amb, rim: rim };
  }

  /* ============================================================
     SCENE REGISTRY: each page names a scene via body[data-scene].
     ============================================================ */
  const SCENES = {};
  let active = null;

  /* ---------- HOME: The Meridian Sweep ---------- */
  SCENES.home = function (container) {
    const stage = makeStage(container, { fov: 40, camZ: 6, shadows: true, exposure: 1.1 });
    addLights(stage.scene, { shadows: true, key: 1.5, fill: 0.4, rim: 0.9 });

    const dev = buildDevice({ finish: 'Graphite' });
    dev.group.position.y = 0.15;
    // start slightly above base (docks later)
    dev.group.userData.base.visible = true;
    stage.scene.add(dev.group);

    // additive light plane (the beam)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7FD8DA, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.18), beamMat);
    beam.position.y = 2.4; beam.rotation.x = 0.0;
    stage.scene.add(beam);

    // instanced lattice of octahedra
    const count = LOWPOWER ? 900 : 2200;
    const latGeo = new THREE.OctahedronGeometry(0.028, 0);
    const latMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, emissive: 0x000000, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.5 });
    const lattice = new THREE.InstancedMesh(latGeo, latMat, count);
    const dummy = new THREE.Object3D();
    const cols = Math.ceil(Math.sqrt(count * 1.6));
    const basePos = [];
    let i = 0;
    const gridW = 6.4, gridH = 4.2;
    for (let n = 0; n < count; n++) {
      const gx = (Math.random() - 0.5) * gridW;
      const gy = (Math.random() - 0.5) * gridH;
      const gz = -1.4 - Math.random() * 1.8;
      basePos.push(new THREE.Vector3(gx, gy, gz));
      dummy.position.set(gx, gy, gz);
      dummy.scale.setScalar(0.6 + Math.random() * 0.8);
      dummy.updateMatrix();
      lattice.setMatrixAt(n, dummy.matrix);
      lattice.setColorAt(n, new THREE.Color(0x3a3630));
    }
    lattice.instanceMatrix.needsUpdate = true;
    stage.scene.add(lattice);

    const litColor = new THREE.Color(0x7FD8DA);
    const dimColor = new THREE.Color(0x3a3630);

    // scroll progress driven by ScrollTrigger; fallback via scroll listener
    let prog = 0;
    dev.setFinish('Graphite');

    // camera + device sweep function based on prog (0..1)
    const camStart = new THREE.Vector3(0, 0.3, 6);
    function applyProgress(p) {
      prog = p;
      // beam sweeps top -> bottom during 0.08..0.45
      const bp = clamp((p - 0.06) / 0.42, 0, 1);
      beam.position.y = 2.4 - bp * 4.8;
      beamMat.opacity = bp > 0 && bp < 1 ? 0.8 : (bp >= 1 ? 0 : 0);
      // light lattice near beam
      const by = beam.position.y;
      for (let n = 0; n < count; n++) {
        const d = Math.abs(basePos[n].y - by);
        const lit = d < 0.35 && beamMat.opacity > 0.1;
        const wave = lit ? Math.max(0, 1 - d / 0.35) : 0;
        dummy.position.copy(basePos[n]);
        dummy.position.z += wave * 0.5;
        dummy.scale.setScalar((0.6 + (n % 7) * 0.05) * (1 + wave * 0.8));
        dummy.updateMatrix();
        lattice.setMatrixAt(n, dummy.matrix);
        const col = dimColor.clone().lerp(litColor, wave);
        lattice.setColorAt(n, col);
      }
      lattice.instanceMatrix.needsUpdate = true;
      if (lattice.instanceColor) lattice.instanceColor.needsUpdate = true;

      // camera orbits + descends 0.15..0.7
      const cp = clamp((p - 0.1) / 0.6, 0, 1);
      const ang = cp * Math.PI * 0.5;
      const radius = 6 - cp * 1.6;
      stage.camera.position.set(Math.sin(ang) * radius * 0.5, 0.5 - cp * 0.5, Math.cos(ang) * radius);
      stage.camera.lookAt(0, 0.1 - cp * 0.15, 0);

      // device docks: descends onto base 0.35..0.62
      const dk = clamp((p - 0.35) / 0.27, 0, 1);
      dev.group.userData.body.position.y = (1 - dk) * 0.5; // body eases down
      dev.group.userData.rim.position.y = (1 - dk) * 0.5;
      dev.internals.position.y = 1.65 * 0.30 + (1 - dk) * 0.5;
      dev.group.userData.led.position.y = -1.65 * 0.32 + (1 - dk) * 0.5;

      // glass fades to transparent 0.68..0.95, internals emphasized
      const gl = clamp((p - 0.68) / 0.27, 0, 1);
      dev.glassMat.opacity = 1 - gl * 0.82;
      dev.glassMat.transmission = gl * 0.4;
      // internals labels callouts
      const labels = document.querySelectorAll('.internal-callout');
      labels.forEach((l) => l.style.opacity = gl > 0.4 ? String(clamp((gl - 0.4) / 0.4, 0, 1)) : '0');
    }

    // frame the device on the RIGHT on wide screens (copy sits left), centered on narrow
    function framingX() {
      const wide = stage.camera.aspect > 1.1;
      return wide ? Math.min(1.5, stage.camera.aspect * 0.7) : 0;
    }
    let idleT = 0;
    stage.setUpdate(function (dt, t) {
      idleT += dt;
      // alive on load: slow drift + LED breathing
      const driftAmt = REDUCED ? 0 : 1;
      dev.group.rotation.y = Math.sin(idleT * 0.25) * 0.10 * driftAmt + prog * 0.2;
      dev.group.userData.body.rotation.y = 0;
      // shift device toward the empty right column when docked framing is idle (prog small)
      const targetX = framingX() * (1 - clamp(prog / 0.2, 0, 1));
      dev.group.position.x += (targetX - dev.group.position.x) * 0.08;
      dev.ledMat.emissiveIntensity = 1.2 + Math.sin(idleT * 1.6) * 0.5;
      // LED color: cyan-ish while "scanning" (during sweep), amber at rest
      const scanning = beamMat.opacity > 0.1;
      dev.ledMat.emissive.set(scanning ? 0x7FD8DA : 0xE8A13C);
    });

    applyProgress(0);
    stage.start();

    // hook ScrollTrigger
    let st = null;
    function attachScroll() {
      const heroPin = document.querySelector('[data-sweep-pin]');
      if (window.gsap && window.ScrollTrigger && heroPin && !REDUCED) {
        st = window.ScrollTrigger.create({
          trigger: heroPin,
          start: 'top top',
          end: '+=250%',
          pin: true,
          scrub: 0.6,
          onUpdate: (self) => applyProgress(self.progress)
        });
      } else {
        // fallback: map window scroll over hero height
        const onScroll = () => {
          const pin = document.querySelector('[data-sweep-pin]');
          if (!pin) return;
          const r = pin.getBoundingClientRect();
          const p = clamp(-r.top / (r.height * 1.5 || 1), 0, 1);
          applyProgress(p);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      }
    }
    setTimeout(attachScroll, 60);

    // finish switch (home dock section)
    document.addEventListener('bv:finish', (e) => { if (e.detail && e.detail.finish) dev.setFinish(e.detail.finish); });

    return {
      stage: stage,
      dispose: function () { if (st) st.kill(); stage.dispose(); }
    };
  };

  /* ---------- SHOP: slow orbiting rim-lit row of devices ---------- */
  SCENES.shop = function (container) {
    const stage = makeStage(container, { fov: 42, camZ: 7 });
    addLights(stage.scene, { key: 1.3, fill: 0.4, rim: 0.9 });
    const group = new THREE.Group();
    const finishes = ['Graphite', 'Bone', 'Graphite'];
    const devs = [];
    for (let k = 0; k < 3; k++) {
      const d = buildDevice({ finish: finishes[k] });
      d.group.scale.setScalar(0.62);
      d.group.position.x = (k - 1) * 2.4;
      d.group.position.y = 0.1;
      d.group.userData.base.visible = false;
      group.add(d.group);
      devs.push(d);
    }
    stage.scene.add(group);
    let scrollP = 0;
    stage.setUpdate(function (dt, t) {
      devs.forEach((d, k) => {
        d.group.rotation.y = t * 0.35 + k * 1.4;
        d.group.position.y = 0.1 + Math.sin(t * 0.6 + k) * 0.08;
        d.ledMat.emissiveIntensity = 1.1 + Math.sin(t * 1.5 + k) * 0.4;
      });
      group.rotation.y = scrollP * 0.4;
      stage.camera.position.y = 0.3 - scrollP * 0.4;
      stage.camera.lookAt(0, 0, 0);
    });
    stage.start();
    const onScroll = () => { scrollP = clamp(window.scrollY / (window.innerHeight || 1), 0, 2); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return { stage: stage, dispose: () => stage.dispose() };
  };

  /* ---------- PRODUCT DETAIL: interactive turntable + finish switch ---------- */
  SCENES.pdp = function (container) {
    const finishAttr = container.getAttribute('data-finish') || 'Graphite';
    const showBase = container.getAttribute('data-base') !== 'false';
    const stage = makeStage(container, { fov: 36, camZ: 5.4, shadows: true });
    addLights(stage.scene, { shadows: true, key: 1.5, fill: 0.4, rim: 0.9 });
    const d = buildDevice({ finish: finishAttr });
    d.group.userData.base.visible = showBase;
    stage.scene.add(d.group);

    let rot = 0.4, targetRot = 0.4, rotX = 0, targetRotX = 0, dragging = false, lastX = 0, lastY = 0, vel = 0;
    const allowDrag = !MOBILE && !REDUCED;

    if (allowDrag) {
      const el = stage.renderer.domElement;
      el.style.cursor = 'grab';
      el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.style.cursor = 'grabbing'; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        targetRot += dx * 0.01; vel = dx * 0.01;
        targetRotX = clamp(targetRotX + dy * 0.006, -0.5, 0.5);
        lastX = e.clientX; lastY = e.clientY;
      });
      const end = () => { dragging = false; el.style.cursor = 'grab'; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointerleave', end);
    }

    stage.setUpdate(function (dt, t) {
      if (!dragging) { targetRot += (allowDrag ? 0.15 : 0.35) * dt + vel; vel *= 0.92; }
      rot += (targetRot - rot) * 0.1;
      rotX += (targetRotX - rotX) * 0.1;
      d.group.rotation.y = rot;
      d.group.rotation.x = rotX;
      d.ledMat.emissiveIntensity = 1.2 + Math.sin(t * 1.6) * 0.4;
    });
    stage.start();

    // scoped finish switch
    const scope = container.closest('[data-finish-scope]') || document;
    scope.addEventListener('bv:finish', (e) => { if (e.detail && e.detail.finish) d.setFinish(e.detail.finish); });

    return { stage: stage, dispose: () => stage.dispose() };
  };

  /* ---------- ACCESSORY: rim-lit slow rotate of a primitive (wall mount / field case) ---------- */
  SCENES.accessory = function (container) {
    const kind = container.getAttribute('data-accessory') || 'wall-mount';
    const stage = makeStage(container, { fov: 40, camZ: 5.2, shadows: true });
    addLights(stage.scene, { shadows: true, key: 1.4, fill: 0.35, rim: 0.9 });
    const g = new THREE.Group();
    const alu = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.4, metalness: 0.85 });
    const aluDark = new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.6, metalness: 0.3 });

    if (kind === 'wall-mount') {
      // aluminum bracket: back plate + arm + magnetic seat ring
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.12), alu);
      plate.castShadow = true; g.add(plate);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), alu);
      arm.position.set(0, -0.2, 0.31); g.add(arm);
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.1, 40), alu);
      seat.rotation.x = Math.PI / 2; seat.position.set(0, -0.2, 0.58); g.add(seat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 12, 40), new THREE.MeshStandardMaterial({ color: 0xC7B18A, roughness: 0.3, metalness: 0.9 }));
      ring.position.set(0, -0.2, 0.63); g.add(ring);
      // mounting holes
      [[-0.4, 0.55], [0.4, 0.55], [-0.4, -0.55], [0.4, -0.55]].forEach(([x, y]) => {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 16), aluDark);
        hole.rotation.x = Math.PI / 2; hole.position.set(x, y, 0); g.add(hole);
      });
    } else {
      // field case: rounded hard-shell box with a seam + latch
      function rr(w, h, r) { const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
      const shellMat = new THREE.MeshStandardMaterial({ color: 0x1b1815, roughness: 0.55, metalness: 0.25 });
      const geo = new THREE.ExtrudeGeometry(rr(1.5, 1.9, 0.18), { depth: 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16 });
      geo.center();
      const shell = new THREE.Mesh(geo, shellMat); shell.castShadow = true; g.add(shell);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 0.8), new THREE.MeshStandardMaterial({ color: 0x0d0b0a, roughness: 0.8 }));
      seam.position.y = 0.1; g.add(seam);
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), alu);
      latch.position.set(0, 0.1, 0.4); g.add(latch);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 10, 30, Math.PI), aluDark);
      handle.position.set(0, 0.98, 0); g.add(handle);
    }
    g.rotation.y = 0.5;
    stage.scene.add(g);
    let targetRot = 0.5;
    stage.setUpdate(function (dt, t) {
      targetRot += 0.25 * dt;
      g.rotation.y = targetRot;
      g.rotation.x = Math.sin(t * 0.4) * 0.08;
      g.position.y = Math.sin(t * 0.6) * 0.05;
    });
    stage.start();
    return { stage: stage, dispose: () => stage.dispose() };
  };

  /* ---------- BUNDLE: device + accessory exploded assemble ---------- */
  SCENES.bundle = function (container) {
    const kind = container.getAttribute('data-bundle') || 'home-studio-bundle';
    const finishAttr = container.getAttribute('data-finish') || 'Graphite';
    const stage = makeStage(container, { fov: 40, camZ: 6, shadows: true });
    addLights(stage.scene, { shadows: true, key: 1.45, fill: 0.4, rim: 0.9 });
    const d = buildDevice({ finish: finishAttr });
    d.group.scale.setScalar(0.85);
    d.group.position.x = -1.1;
    stage.scene.add(d.group);

    const alu = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.4, metalness: 0.85 });
    const acc = new THREE.Group();
    acc.position.x = 1.5;
    if (kind === 'home-studio-bundle') {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.1), alu); acc.add(plate);
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.08, 36), alu); seat.rotation.x = Math.PI / 2; seat.position.z = 0.32; seat.position.y = -0.1; acc.add(seat);
    } else {
      const shellMat = new THREE.MeshStandardMaterial({ color: 0x1b1815, roughness: 0.55, metalness: 0.25 });
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 0.5), shellMat); acc.add(shell);
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.06), alu); latch.position.set(0, 0.05, 0.28); acc.add(latch);
    }
    stage.scene.add(acc);
    let p = 0;
    stage.setUpdate(function (dt, t) {
      d.group.rotation.y = t * 0.3;
      acc.rotation.y = -t * 0.25;
      d.ledMat.emissiveIntensity = 1.1 + Math.sin(t * 1.5) * 0.4;
      // gentle breathing separation
      d.group.position.x = -1.1 - Math.sin(t * 0.5) * 0.06;
      acc.position.x = 1.5 + Math.sin(t * 0.5) * 0.06;
    });
    stage.start();
    const scope = container.closest('[data-finish-scope]') || document;
    scope.addEventListener('bv:finish', (e) => { if (e.detail && e.detail.finish) d.setFinish(e.detail.finish); });
    return { stage: stage, dispose: () => stage.dispose() };
  };

  /* ---------- ABOUT: instanced points assemble the year 2017 then relax ---------- */
  SCENES.about = function (container) {
    const stage = makeStage(container, { fov: 45, camZ: 7, env: false });
    stage.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const pt = new THREE.PointLight(0xE8A13C, 1.2, 30); pt.position.set(3, 3, 5); stage.scene.add(pt);

    // sample points along digits "2017" on a canvas
    const cvs = document.createElement('canvas'); cvs.width = 400; cvs.height = 120;
    const cx = cvs.getContext('2d');
    cx.fillStyle = '#fff'; cx.font = '700 96px "IBM Plex Mono", monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('2017', 200, 62);
    const img = cx.getImageData(0, 0, 400, 120).data;
    const targets = [];
    for (let y = 0; y < 120; y += 3) for (let x = 0; x < 400; x += 3) {
      if (img[(y * 400 + x) * 4 + 3] > 128) targets.push(new THREE.Vector3((x - 200) / 55, -(y - 60) / 55, 0));
    }
    const count = LOWPOWER ? Math.min(targets.length, 700) : targets.length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const scattered = [];
    for (let n = 0; n < count; n++) {
      const s = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6);
      scattered.push(s);
      pos[n * 3] = s.x; pos[n * 3 + 1] = s.y; pos[n * 3 + 2] = s.z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xE8A13C, size: 0.045, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    stage.scene.add(points);

    let prog = 0;
    function applyProgress(p) { prog = p; }
    stage.setUpdate(function (dt, t) {
      const arr = geo.attributes.position.array;
      // assemble 0..0.6, relax after
      const a = clamp(prog / 0.6, 0, 1);
      const relax = clamp((prog - 0.6) / 0.4, 0, 1);
      for (let n = 0; n < count; n++) {
        const tg = targets[n % targets.length];
        const sc = scattered[n];
        let tx = tg.x + Math.sin(t * 0.5 + n) * 0.02;
        let ty = tg.y + Math.cos(t * 0.4 + n) * 0.02;
        let tz = tg.z;
        // relax back toward a calm grid drift
        tx = tx * (1 - relax) + sc.x * 0.4 * relax;
        ty = ty * (1 - relax) + sc.y * 0.4 * relax;
        tz = tz * (1 - relax) + sc.z * 0.5 * relax;
        const gx = sc.x, gy = sc.y, gz = sc.z;
        arr[n * 3] += ((gx * (1 - a) + tx * a) - arr[n * 3]) * 0.08;
        arr[n * 3 + 1] += ((gy * (1 - a) + ty * a) - arr[n * 3 + 1]) * 0.08;
        arr[n * 3 + 2] += ((gz * (1 - a) + tz * a) - arr[n * 3 + 2]) * 0.08;
      }
      geo.attributes.position.needsUpdate = true;
      points.rotation.y = Math.sin(t * 0.15) * 0.15;
    });
    stage.start();

    let st = null;
    setTimeout(() => {
      const trg = document.querySelector('[data-about-scene]');
      if (window.gsap && window.ScrollTrigger && trg && !REDUCED) {
        st = window.ScrollTrigger.create({ trigger: trg, start: 'top 80%', end: 'bottom top', scrub: 0.8, onUpdate: (s) => applyProgress(s.progress) });
      } else { applyProgress(1); }
    }, 60);
    return { stage: stage, dispose: () => { if (st) st.kill(); stage.dispose(); } };
  };

  /* ---------- CALM DEVICE (cart / checkout / confirmation) ---------- */
  SCENES.calm = function (container) {
    const steady = container.getAttribute('data-steady') === 'true';
    const stage = makeStage(container, { fov: 38, camZ: 5.6, shadows: true });
    addLights(stage.scene, { shadows: true, key: 1.3, fill: 0.3, rim: 0.8 });
    const d = buildDevice({ finish: 'Graphite' });
    stage.scene.add(d.group);
    // one amber line that completes (confirmation)
    let lineEl = container.parentElement && container.parentElement.querySelector('.confirm-line-progress');
    stage.setUpdate(function (dt, t) {
      d.group.rotation.y = t * 0.25;
      d.group.position.y = Math.sin(t * 0.5) * 0.04;
      if (steady) { d.ledMat.emissive.set(0xffffff); d.ledMat.emissiveIntensity = 1.4; }
      else d.ledMat.emissiveIntensity = 1.1 + Math.sin(t * 1.4) * 0.35;
    });
    stage.start();
    return { stage: stage, dispose: () => stage.dispose() };
  };

  /* ---------- LIGHTWEIGHT SCAN-LINE GRID (blog index, posts, contact, legal) ---------- */
  SCENES.grid = function (container) {
    const variant = container.getAttribute('data-grid') || 'plane';
    const stage = makeStage(container, { fov: 50, camZ: 6, env: false });
    stage.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    // a subtle grid of points + a moving scan bar
    const gw = 40, gh = 22, gap = 0.32;
    const total = gw * gh;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    let idx = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      pos[idx * 3] = (x - gw / 2) * gap;
      pos[idx * 3 + 1] = (y - gh / 2) * gap;
      pos[idx * 3 + 2] = 0;
      idx++;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x4a443d, size: 0.03, transparent: true, opacity: 0.7 });
    const pts = new THREE.Points(geo, mat);
    const tilt = (variant === 'tilt') ? -0.62 : (variant === 'radial' ? -0.32 : -0.2);
    pts.rotation.x = tilt;
    stage.scene.add(pts);

    // scan bar (used by plane/tilt sweep variants)
    const barMat = new THREE.MeshBasicMaterial({ color: 0xE8A13C, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const showBar = (variant === 'plane' || variant === 'tilt' || !variant);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(gw * gap, 0.12), barMat);
    bar.rotation.x = tilt; bar.visible = showBar;
    stage.scene.add(bar);

    stage.setUpdate(function (dt, t) {
      const arr = geo.attributes.position.array;
      if (variant === 'wave') {
        // ripple radiating from center (contact)
        for (let n = 0; n < total; n++) {
          const px = pos[n * 3], py = pos[n * 3 + 1];
          const r = Math.sqrt(px * px + py * py);
          arr[n * 3 + 2] = Math.sin(r * 1.4 - t * 2.0) * 0.28 * Math.max(0, 1 - r / 6);
        }
      } else if (variant === 'columns') {
        // vertical bars breathing per column (legal / terms feel: structured)
        for (let n = 0; n < total; n++) {
          const col = n % gw;
          arr[n * 3 + 2] = Math.sin(t * 1.2 + col * 0.35) * 0.18;
        }
      } else if (variant === 'radial') {
        // concentric rings pulsing (privacy)
        for (let n = 0; n < total; n++) {
          const px = pos[n * 3], py = pos[n * 3 + 1];
          const r = Math.sqrt(px * px + py * py);
          arr[n * 3 + 2] = Math.cos(r * 0.9 - t * 1.3) * 0.2;
        }
      } else {
        // plane / tilt: a single scan bar sweeps and lifts the row it crosses
        const scanY = ((t * 0.7) % (gh * gap + 2)) - (gh * gap / 2) - 1;
        bar.position.y = scanY * Math.cos(tilt);
        bar.position.z = scanY * Math.sin(-tilt);
        for (let n = 0; n < total; n++) {
          const py = pos[n * 3 + 1];
          const d = Math.abs(py - scanY);
          const lift = d < 0.5 ? (1 - d / 0.5) * 0.4 : 0;
          arr[n * 3 + 2] = lift + Math.sin(t * 0.5 + py) * 0.02;
        }
      }
      geo.attributes.position.needsUpdate = true;
      pts.rotation.z = Math.sin(t * 0.1) * 0.03;
    });
    stage.start();
    return { stage: stage, dispose: () => stage.dispose() };
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ============================================================
     BOOT: detect canvas hosts, feature-detect, lazy init one scene.
     ============================================================ */
  function showPosters() {
    document.querySelectorAll('.hero-poster, .plate-poster, .scene-poster').forEach((p) => p.classList.add('show'));
  }

  function boot() {
    // scene name lives on <body data-scene="...">; canvas mounts into [data-scene-host]
    const sceneName = document.body.getAttribute('data-scene');
    if (!sceneName) return;
    const host = document.querySelector('[data-scene-host]');
    if (!host) { showPosters(); return; }
    const posterOnly = REDUCED || !hasWebGL();

    if (posterOnly) { showPosters(); return; }

    // load THREE from global (cdnjs script tag). If missing, poster.
    if (!window.THREE) { showPosters(); return; }
    THREE = window.THREE;

    try {
      const factory = SCENES[sceneName];
      if (!factory) return;
      active = factory(host);
    } catch (err) {
      // any failure -> poster
      try { console.warn('[BV scene] init failed:', err && err.message); } catch (e) {}
      showPosters();
      if (active && active.dispose) { try { active.dispose(); } catch (e) {} active = null; }
    }
  }

  // dispose on unload / navigation
  window.addEventListener('pagehide', () => { if (active && active.dispose) { try { active.dispose(); } catch (e) {} } });
  window.addEventListener('beforeunload', () => { if (active && active.dispose) { try { active.dispose(); } catch (e) {} } });

  // lazy-init after first paint so LCP is never blocked
  function schedule() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => window.requestAnimationFrame(boot), { timeout: 800 });
    else window.setTimeout(() => window.requestAnimationFrame(boot), 120);
  }
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);

})();
