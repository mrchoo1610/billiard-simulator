// Realistic 3D "Mắt cơ thủ" view (Phase 6). Lazily imported by app.js on first open; imports the vendored three.js r164.
// Scene layout: `root` (scaled 0.001, in physics millimetres: x -> three.x, y -> three.z, up -> three.y) holds the
// table, balls and aids; the cue stick, hit marker, lights and camera live in metres (three world, table centred).
import * as THREE from '../../assets/vendor/three/three.module.min.js';
import { R } from '../core/table.js';
import { BALL_COLORS } from './render.js';
import { wheelPixels } from './keyboard.js';
import {
  MM, RAIL_WIDTH_3D, CAM_DIST_DEFAULT, CAM_HEIGHT_DEFAULT, clampCamDist, clampCamHeight, cameraPose, topDownPose,
  fovForAspect, createCameraDirector, easeInOut, lerpAngle, smoothAlpha, physQuatToThree, cuePose, pullMm, strokePull,
  cushionFrames, railHoleOutline, dashSegments, pathSegments, naturalRollIndex, ribbonQuads, ballTexturePixels,
  parseHex, dragToAimDeg, toThree, CAMERA_MODE_LABEL,
} from './view3d-math.js';

const TRANSITION_MS = 600;
const STICK_LEN = 1470;
const IDENT_Q = { w: 1, x: 0, y: 0, z: 0 };
const SLIDE_RGB = [1, 0.596, 0];

const hexRgb01 = (hex) => parseHex(hex).map((v) => v / 255);
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* ignore */
  }
};

/** Throws when WebGL is unavailable. */
export async function createView3D(host) {
  const { canvas } = host;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let quality = coarse ? 'low' : 'high';
  let camMode = 'auto';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0f0d');
  scene.fog = new THREE.Fog('#0b0f0d', 3.5, 11);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 30);
  const root = new THREE.Group();
  root.scale.setScalar(MM);
  scene.add(root);
  const tableGroup = new THREE.Group();
  const ballGroup = new THREE.Group();
  const aidGroup = new THREE.Group();
  const predGroup = new THREE.Group();
  root.add(tableGroup, ballGroup, aidGroup, predGroup);

  /* ---------------------------------------------------------------- lights, environment, floor */
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x14110d, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1da, 1.6);
  sun.position.set(0.4, 2.4, 0.5);
  sun.target.position.set(0, 0, 0);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -1.6;
  sun.shadow.camera.right = 1.6;
  sun.shadow.camera.top = 0.9;
  sun.shadow.camera.bottom = -0.9;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.002;
  scene.add(sun, sun.target);
  for (const x of [-0.65, 0, 0.65]) {
    const lamp = new THREE.PointLight(0xffe2b0, 2.6, 0, 2);
    lamp.position.set(x, 1.4, 0);
    scene.add(lamp);
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 32),
    new THREE.MeshStandardMaterial({ color: '#15110d', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  scene.add(floor);

  let envTex = null;
  try {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#2b2218');
    grad.addColorStop(0.5, '#0c0f0d');
    grad.addColorStop(1, '#050706');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff1d0';
    for (const u of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.ellipse(u * 256, 26, 22, 7, 0, 0, Math.PI * 2);
      g.fill();
    }
    const src = new THREE.CanvasTexture(c);
    src.mapping = THREE.EquirectangularReflectionMapping;
    src.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromEquirectangular(src).texture;
    pm.dispose();
    src.dispose();
  } catch (e) {
    envTex = null;
  }

  /* ---------------------------------------------------------------- shared materials / textures */
  function clothTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 200 + Math.floor(Math.random() * 55);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }
  const clothTex = clothTexture();

  /* ---------------------------------------------------------------- table */
  let tableKey = null;
  let tableDims = { W: 2540, H: 1270 };
  let mouths = { corner: 127, side: 140 };
  let curGeo = null;

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) m.dispose();
      }
    });
    g.clear();
  }

  function pocketCircle(pk) {
    const out = pk.type === 'corner' ? 20 : 16;
    return { cx: pk.x - pk.axis.x * out, cy: pk.y - pk.axis.y * out, r: pk.type === 'corner' ? 0.44 * mouths.corner : 0.34 * mouths.side };
  }

  function buildTable(geo) {
    disposeGroup(tableGroup);
    const { W, H } = geo;
    const IN = 36; // cushion width (mm) between the nose line and the wood rail
    const YR = 46; // rail top height (mm)
    const RW = RAIL_WIDTH_3D;
    const add = (m) => {
      tableGroup.add(m);
      return m;
    };
    const flat = (geom, mat, x, y, z) => {
      const m = new THREE.Mesh(geom, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      return add(m);
    };
    // dark pit under pocket mouths
    flat(new THREE.PlaneGeometry(W + 2 * IN, H + 2 * IN), new THREE.MeshBasicMaterial({ color: '#030504' }), W / 2, -1, H / 2);
    // cloth
    const clothMat = new THREE.MeshStandardMaterial({ color: '#0b6e4f', roughness: 0.92, metalness: 0, map: clothTex });
    clothMat.map = clothTex;
    clothTex.repeat.set(W / 250, H / 250);
    const cloth = flat(new THREE.PlaneGeometry(W, H), clothMat, W / 2, 0, H / 2);
    cloth.receiveShadow = true;
    // cushions
    const rubber = new THREE.MeshStandardMaterial({ color: '#0a5a41', roughness: 0.95 });
    const prof = new THREE.Shape();
    prof.moveTo(0, 0);
    prof.lineTo(IN, 0);
    prof.lineTo(IN, YR - 2);
    prof.lineTo(2, R + 3);
    prof.lineTo(0, R);
    for (const f of cushionFrames(geo.RAIL_SEGMENTS)) {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: f.len, bevelEnabled: false }), rubber);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(f.n3.x, f.n3.y, f.n3.z),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(f.e3.x, f.e3.y, f.e3.z),
      );
      basis.setPosition(f.origin.x, 0, f.origin.y);
      basis.decompose(m.position, m.quaternion, m.scale);
      m.receiveShadow = true;
      add(m);
    }
    // pockets: dark discs at cloth level
    const pitMat = new THREE.MeshBasicMaterial({ color: '#050606' });
    const circles = geo.POCKETS.map(pocketCircle);
    for (const c of circles) flat(new THREE.CircleGeometry(c.r, 40), pitMat, c.cx, 0.6, c.cy);
    // wood rail top with the opening (shape y = -physics y, then rotated flat)
    // outer rectangle in (x, -y): shape y' = -physics y
    const outer = new THREE.Shape();
    outer.moveTo(-RW, -(-RW));
    outer.lineTo(W + RW, -(-RW));
    outer.lineTo(W + RW, -(H + RW));
    outer.lineTo(-RW, -(H + RW));
    outer.closePath();
    const hole = new THREE.Path();
    const outline = railHoleOutline({ W, H, inset: IN, circles, step: 3 });
    outline.forEach((p, i) => (i ? hole.lineTo(p.x, -p.y) : hole.moveTo(p.x, -p.y)));
    hole.closePath();
    outer.holes.push(hole);
    const wood = new THREE.MeshStandardMaterial({ color: '#6b3f1f', roughness: 0.5, metalness: 0.05 });
    const base = -90;
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: YR - base, bevelEnabled: false, curveSegments: 1 }), wood);
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = base;
    frame.castShadow = false;
    frame.receiveShadow = true;
    add(frame);
    // cabinet + floor contact
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * RW - 40, 700, H + 2 * RW - 40), new THREE.MeshStandardMaterial({ color: '#2a1a0e', roughness: 0.7 }));
    cab.position.set(W / 2, base - 350, H / 2);
    add(cab);
    // diamonds
    const pearl = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.3 });
    const dGeo = new THREE.CylinderGeometry(7, 7, 1.5, 4);
    const mid = (IN + RW) / 2;
    const dia = (x, y) => {
      const m = new THREE.Mesh(dGeo, pearl);
      m.position.set(x, YR + 0.6, y);
      add(m);
    };
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      dia((i * W) / 8, -mid);
      dia((i * W) / 8, H + mid);
    }
    for (let j = 1; j < 4; j++) {
      dia(-mid, (j * H) / 4);
      dia(W + mid, (j * H) / 4);
    }
    // head string + spots (faint)
    const faint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.14, depthWrite: false });
    flat(new THREE.PlaneGeometry(1.5, H), faint, geo.HEAD_X, 0.3, H / 2);
    const spotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false });
    for (const sp of [geo.HEAD_SPOT, geo.FOOT_SPOT, { x: W / 2, y: H / 2 }]) flat(new THREE.CircleGeometry(5, 16), spotMat, sp.x, 0.35, sp.y);

    root.position.set((-W / 2) * MM, 0, (-H / 2) * MM);
    tableDims = { W, H };
    curGeo = geo;
    // shadow frustum follows the table
    sun.shadow.camera.left = -(W / 2 + RW) * MM;
    sun.shadow.camera.right = (W / 2 + RW) * MM;
    sun.shadow.camera.top = (H / 2 + RW) * MM;
    sun.shadow.camera.bottom = -(H / 2 + RW) * MM;
    sun.shadow.camera.updateProjectionMatrix();
    dirty = true;
  }

  /* ---------------------------------------------------------------- balls */
  const ballGeo = new THREE.SphereGeometry(R, 48, 32);
  const texCache = new Map();
  const glyphCache = new Map();
  const balls = new Map(); // id -> mesh

  function glyph(n) {
    if (glyphCache.has(n)) return glyphCache.get(n);
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 80px system-ui, "Segoe UI", sans-serif';
    g.fillText(String(n), S / 2, S / 2 + 4);
    const d = g.getImageData(0, 0, S, S).data;
    const alpha = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) alpha[i] = d[i * 4 + 3];
    const res = { size: S, alpha };
    glyphCache.set(n, res);
    return res;
  }

  function ballTexture(id) {
    const [w, h] = quality === 'high' ? [1024, 512] : [512, 256];
    const key = `${id}:${w}`;
    if (texCache.has(key)) return texCache.get(key);
    const white = [247, 246, 239];
    const spec =
      id === 0
        ? { base: white, stripe: null, dots: true, number: false, glyph: null }
        : id === 9
          ? { base: white, stripe: parseHex(BALL_COLORS[9]), dots: false, number: true, glyph: glyph(9) }
          : { base: parseHex(BALL_COLORS[id] || '#888888'), stripe: null, dots: false, number: true, glyph: glyph(id) };
    const t = new THREE.DataTexture(ballTexturePixels(spec, w, h), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    texCache.set(key, t);
    return t;
  }

  function ensureBall(id) {
    let m = balls.get(id);
    const tex = ballTexture(id);
    if (!m) {
      const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
      if (envTex) {
        mat.envMap = envTex;
        mat.envMapIntensity = 0.9;
      }
      m = new THREE.Mesh(ballGeo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.id = id;
      ballGroup.add(m);
      balls.set(id, m);
    } else if (m.material.map !== tex) {
      m.material.map = tex;
      m.material.needsUpdate = true;
    }
    return m;
  }

  const seen = new Set();
  function updateBalls(sc) {
    seen.clear();
    for (const b of sc.balls) {
      if (b.potted) continue;
      const m = ensureBall(b.id);
      m.visible = true;
      m.position.set(b.pos.x, R, b.pos.y);
      const q = physQuatToThree(b.q || IDENT_Q);
      m.quaternion.set(q.x, q.y, q.z, q.w);
      seen.add(b.id);
    }
    for (const [id, m] of balls) if (!seen.has(id)) m.visible = false;
  }

  /* ---------------------------------------------------------------- cue stick + hit marker */
  const stick = new THREE.Group();
  stick.scale.setScalar(MM);
  scene.add(stick);
  let stickTipD = 0;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.0021, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
  marker.visible = false;
  scene.add(marker);

  function buildStick(tipD) {
    disposeGroup(stick);
    stickTipD = tipD;
    const rt = tipD / 2;
    const part = (y0, y1, r0, r1, color, rough = 0.5) => {
      // tip end at y0 (radius r0), butt end at y1 (radius r1); cylinder axis = local Y, tip at the origin
      const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 20, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough }));
      m.position.y = (y0 + y1) / 2;
      m.castShadow = true;
      stick.add(m);
    };
    part(0, 8, rt, rt, '#2f6fb8', 0.9); // chalked leather tip
    part(8, 30, rt, rt + 0.3, '#f4f1e6', 0.35); // ferrule
    part(30, 760, rt + 0.3, 10.3, '#e7c98f', 0.45); // maple shaft
    part(760, 800, 10.3, 11, '#c9a24a', 0.3); // joint ring
    part(800, 1010, 11, 13, '#241a14', 0.8); // wrap
    part(1010, STICK_LEN, 13, 15, '#150e0a', 0.5); // butt
  }

  const Y = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3();
  let stroke = null; // { t0, dur, from }
  let lastStick = null;
  let lastPull = 0;
  let strokeActive = false;
  function updateStick(sc, now) {
    const st = sc.stick;
    if (!st) {
      stick.visible = false;
      marker.visible = false;
      stroke = null;
      strokeActive = false;
      return;
    }
    lastStick = st;
    const td = (sc.tipDiameterMm || 12.5) + 0;
    if (td !== stickTipD) buildStick(td);
    let pull = pullMm(st.power);
    if (stroke) {
      const t = (now - stroke.t0) / stroke.dur;
      pull = strokePull(stroke.from, t);
      strokeActive = t < 1;
    } else {
      lastPull = pull;
    }
    const pose = cuePose({ ball: st.pos, aimDir: st.dir, elevationDeg: st.elevationDeg || 0, tip: st.tip || { x: 0, y: 0 }, pull, dims: tableDims });
    stick.visible = true;
    stick.position.set(pose.tip.x, pose.tip.y, pose.tip.z);
    stick.quaternion.setFromUnitVectors(Y, tmpV.set(pose.butt.x, pose.butt.y, pose.butt.z));
    marker.visible = true;
    marker.position.set(pose.contact.x, pose.contact.y, pose.contact.z);
  }

  /* ---------------------------------------------------------------- aids (aim line, ghost ball, predictions) */
  const matCache = new Map();
  const basicMat = (color, opacity = 1) => {
    const k = `${color}|${opacity}`;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide });
      matCache.set(k, m);
    }
    return m;
  };
  const ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const ringGeos = new Map();
  const ringGeo = (r0, r1) => {
    const k = `${r0.toFixed(2)}|${r1.toFixed(2)}`;
    let g = ringGeos.get(k);
    if (!g) {
      g = new THREE.RingGeometry(r0, r1, 48);
      ringGeos.set(k, g);
    }
    return g;
  };
  const discGeo = new THREE.CircleGeometry(1, 24);

  function ribbonMesh(segs, y = 1) {
    const q = ribbonQuads(segs, y);
    if (!q.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(q.colors, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(q.indices, 1));
    const m = new THREE.Mesh(g, ribbonMat);
    m.renderOrder = 2;
    m.userData.own = true;
    return m;
  }
  function flatRing(group, x, y, r0, r1, color, opacity = 1, h = 1.1) {
    const m = new THREE.Mesh(ringGeo(r0, r1), basicMat(color, opacity));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, h, y);
    m.renderOrder = 2;
    group.add(m);
  }
  function flatDisc(group, x, y, r, color, opacity = 1, h = 1.2) {
    const m = new THREE.Mesh(discGeo, basicMat(color, opacity));
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(r);
    m.position.set(x, h, y);
    m.renderOrder = 2;
    group.add(m);
  }
  const along = (p, d, k) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const clearGroup = (g) => {
    for (const ch of [...g.children]) {
      if (ch.userData.own) ch.geometry.dispose(); // ribbons only; rings / discs / ghost ball share geometry
      g.remove(ch);
    }
  };

  let aidKey = null;
  function updateAids(sc) {
    const o = sc.overlays;
    const info = sc.info;
    const key = [sc.info, sc.zone, sc.targetId, sc.showTarget, sc.showPocketRing, sc.pocketExplicit, JSON.stringify(o), sc.phase].map((v) => (v && typeof v === 'object' ? sc._ids.get(v) : v)).join('|');
    if (key === aidKey) return;
    aidKey = key;
    clearGroup(aidGroup);
    const segs = [];
    const solid = (a, b, w, rgb) => segs.push({ a, b, w, c: rgb });
    const dashed = (a, b, w, rgb, dash, gap) => {
      for (const s of dashSegments(a, b, dash, gap)) segs.push({ a: s.a, b: s.b, w, c: rgb });
    };
    if (sc.zone) {
      flatDisc(aidGroup, sc.zone.x, sc.zone.y, sc.zone.r, '#ffd54a', 0.14, 0.9);
      flatRing(aidGroup, sc.zone.x, sc.zone.y, sc.zone.r - 2.5, sc.zone.r, '#ffd54a', 0.9, 0.95);
    }
    if (info) {
      const hasGhost = !!info.ghost;
      const blocked = info.blockedCue !== null;
      if (o.aim) solid(info.cue, along(info.cue, info.aimDir, info.aimLen), 3, blocked ? [1, 0.32, 0.32] : [1, 1, 1]);
      if (o.actual && info.actualDir && Math.abs(info.squirtDeg) > 0.005) {
        const e = along(info.cue, info.actualDir, info.aimLen);
        dashed(info.cue, e, 3, SLIDE_RGB, 18, 10);
        flatDisc(aidGroup, e.x, e.y, 6, '#ff9800', 1, 1.3);
      }
      if (o.ghost && hasGhost) {
        const gm = new THREE.Mesh(ballGeo, basicMat('#ffffff', 0.32));
        gm.position.set(info.ghost.x, R, info.ghost.y);
        gm.renderOrder = 1;
        aidGroup.add(gm);
        flatRing(aidGroup, info.ghost.x, info.ghost.y, R - 1.5, R + 0.5, '#ffffff', 0.9);
      }
      if (o.pocket && info.manual && hasGhost) solid(info.obj, along(info.obj, info.objDir, 500), 3, [1, 0.835, 0.29]);
      else if (o.pocket && !info.manual && info.pocketAim) solid(info.obj, info.pocketAim, 3, info.blockedObj !== null ? [1, 0.32, 0.32] : [1, 0.835, 0.29]);
      if (o.tangent && hasGhost) dashed(info.ghost, along(info.ghost, info.stunDir, 420), 2.6, hexRgb01('#4fc3f7'), 14, 9);
      if (o.roll && hasGhost) dashed(info.ghost, along(info.ghost, info.rollDir, 380), 2.6, hexRgb01('#ce93d8'), 6, 9);
      for (const id of [info.blockedCue, info.blockedObj]) {
        if (id === null) continue;
        const b = sc.balls.find((x) => x.id === id);
        if (b) flatRing(aidGroup, b.pos.x, b.pos.y, R + 3, R + 6, '#ff5252', 1);
      }
      if (info.pocketIdx !== null && info.pocketIdx !== undefined && (o.pocket || sc.showPocketRing) && curGeo) {
        const pk = curGeo.POCKETS[info.pocketIdx];
        const rr = (pk.type === 'corner' ? 0.44 * mouths.corner : 0.34 * mouths.side) + 10;
        flatRing(aidGroup, pk.x - pk.axis.x * 18, pk.y - pk.axis.y * 18, rr - 2.5, rr, '#ffd54a', sc.pocketExplicit ? 1 : 0.6, 1.4);
      }
    }
    if (sc.targetId && sc.showTarget) {
      const t = sc.balls.find((b) => b.id === sc.targetId && !b.potted);
      if (t) flatRing(aidGroup, t.pos.x, t.pos.y, R + 2.5, R + 5, '#ffd54a', 1);
    }
    const mesh = ribbonMesh(segs, 1.0);
    if (mesh) aidGroup.add(mesh);
  }

  let predRef = null;
  let predOn = false;
  function updatePrediction(sc) {
    const pred = sc.prediction && sc.overlays.predict ? sc.prediction : null;
    if (pred === predRef && predOn === !!pred) return;
    predRef = pred;
    predOn = !!pred;
    clearGroup(predGroup);
    if (!pred) return;
    const segs = [];
    for (const id of Object.keys(pred.paths)) {
      const path = pred.paths[id];
      if (!path || path.length < 2) continue;
      const nid = Number(id);
      const roll = nid === 0 ? [1, 1, 1] : hexRgb01(BALL_COLORS[nid] || '#cccccc');
      const w = nid === 0 ? 2.4 : 3;
      for (const s of pathSegments(path)) segs.push({ a: s.a, b: s.b, w, c: s.slide ? SLIDE_RGB : roll });
      const k = naturalRollIndex(path);
      if (k > 0) {
        flatDisc(predGroup, path[k].x, path[k].y, 5.5, '#ffffff', 1, 1.5);
        flatDisc(predGroup, path[k].x, path[k].y, 4, '#ff9800', 1, 1.6);
      }
    }
    for (const b of pred.balls) {
      if (b.potted) {
        flatRing(predGroup, b.pos.x, b.pos.y, R * 1.2 - 2.5, R * 1.2, b.id === 0 ? '#ff5252' : '#69f0ae', 1, 1.2);
        continue;
      }
      const start = sc.balls.find((o2) => o2.id === b.id);
      if (!start || Math.hypot(b.pos.x - start.pos.x, b.pos.y - start.pos.y) < 6) continue;
      flatRing(predGroup, b.pos.x, b.pos.y, R - 1.6, R, b.id === 0 ? '#ffffff' : BALL_COLORS[b.id] || '#cccccc', 0.85, 1.2);
    }
    const mesh = ribbonMesh(segs, 1.2);
    if (mesh) predGroup.add(mesh);
  }

  /* ---------------------------------------------------------------- camera director */
  const cam = { dist: CAM_DIST_DEFAULT, height: CAM_HEIGHT_DEFAULT };
  try {
    const saved = JSON.parse(lsGet('bida9-v3-view') || 'null');
    if (saved && Number.isFinite(saved.dist) && Number.isFinite(saved.height)) {
      cam.dist = clampCamDist(saved.dist);
      cam.height = clampCamHeight(saved.height);
    }
  } catch (e) {
    /* ignore */
  }
  const saveCam = () => lsSet('bida9-v3-view', JSON.stringify(cam));
  const director = createCameraDirector();
  let P = null; // shown focus: { x, y, h }
  let trans = null;
  let wasShooting = false;
  let lastHeading = 0;
  let lastNow = 0;
  let snapRequested = false;
  let blendNow = 0;
  let dirty = true;
  const mEye = new THREE.Matrix4();
  const qEye = new THREE.Quaternion();
  const qTop = new THREE.Quaternion();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  let animatingNow = false;

  function applyPose(pos, target, up, q) {
    mEye.lookAt(v1.set(pos.x, pos.y, pos.z), v2.set(target.x, target.y, target.z), v3.set(up.x, up.y, up.z));
    q.setFromRotationMatrix(mEye);
  }

  function updateCamera(sc, now) {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    const shooting = sc.phase === 'shooting';
    const cue = sc.balls.find((b) => b.id === 0 && !b.potted);
    let aimH = lastHeading;
    if (!shooting) {
      if (sc.headingHint !== null && sc.headingHint !== undefined) aimH = sc.headingHint;
      else if (sc.info && sc.info.aimDir) aimH = Math.atan2(sc.info.aimDir.y, sc.info.aimDir.x);
      lastHeading = aimH;
    }
    const goal = { x: cue ? cue.pos.x : P ? P.x : tableDims.W / 2, y: cue ? cue.pos.y : P ? P.y : tableDims.H / 2, h: aimH };
    if (!P) {
      P = { ...goal };
    } else if (!shooting) {
      if (wasShooting) trans = { t0: now, from: { ...P } };
      if (snapRequested) trans = null;
      if (trans) {
        const u = (now - trans.t0) / TRANSITION_MS;
        if (u >= 1) trans = null;
        else {
          const e = easeInOut(u);
          P = { x: trans.from.x + (goal.x - trans.from.x) * e, y: trans.from.y + (goal.y - trans.from.y) * e, h: lerpAngle(trans.from.h, goal.h, e) };
        }
      }
      if (!trans) P = { ...goal };
    } else if (camMode === 'follow' && cue) {
      const a = smoothAlpha(dt, 3);
      P.x += (cue.pos.x - P.x) * a;
      P.y += (cue.pos.y - P.y) * a;
      const sp = cue.vel ? Math.hypot(cue.vel.x, cue.vel.y) : 0;
      if (sp > 200) P.h = lerpAngle(P.h, Math.atan2(cue.vel.y, cue.vel.x), smoothAlpha(dt, 2.5));
    }
    // situational director (Tự động)
    let blend = 0;
    let moving = false;
    if (camMode === 'auto') {
      const r = director.update({ shooting, scratch: !!sc.scratch, userInput: snapRequested }, now);
      blend = r.blend;
      moving = r.moving;
    } else {
      director.reset();
    }
    snapRequested = false;
    wasShooting = shooting;
    blendNow = blend;

    const aspect = camera.aspect;
    const fovEye = fovForAspect(aspect);
    const eye = cameraPose({ cue: { x: P.x, y: P.y }, heading: P.h, distance: cam.dist, height: cam.height, dims: tableDims });
    applyPose(eye.position, eye.target, { x: 0, y: 1, z: 0 }, qEye);
    if (blend > 0) {
      const top = topDownPose(tableDims.W, tableDims.H, fovEye, aspect);
      applyPose(top.position, top.target, top.up, qTop);
      camera.position.set(
        eye.position.x + (top.position.x - eye.position.x) * blend,
        eye.position.y + (top.position.y - eye.position.y) * blend,
        eye.position.z + (top.position.z - eye.position.z) * blend,
      );
      camera.quaternion.slerpQuaternions(qEye, qTop, blend);
      camera.fov = fovEye;
    } else {
      camera.position.set(eye.position.x, eye.position.y, eye.position.z);
      camera.quaternion.copy(qEye);
      camera.fov = fovEye;
    }
    camera.updateProjectionMatrix();
    animatingNow = !!trans || moving || strokeActive || (shooting && camMode === 'follow');
  }

  /* ---------------------------------------------------------------- sizing / quality */
  function shadowsOn() {
    return quality === 'high' && !coarse;
  }
  function applyQuality() {
    const wasOn = renderer.shadowMap.enabled;
    const on = shadowsOn();
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    if (wasOn !== on) scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    resize();
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const pr = quality === 'low' ? 1 : Math.min(dpr, coarse ? 1.5 : 2);
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  /* ---------------------------------------------------------------- draw */
  let idSeq = 0;
  const idMap = new WeakMap();
  const ids = { get: (o) => idMap.get(o) };
  function tag(o) {
    if (o && typeof o === 'object' && !idMap.has(o)) idMap.set(o, ++idSeq);
  }
  let lastScene = null;

  function draw(sc) {
    const now = performance.now();
    tag(sc.info);
    tag(sc.zone);
    sc._ids = ids;
    lastScene = sc;
    updateBalls(sc);
    updateAids(sc);
    updatePrediction(sc);
    updateStick(sc, now);
    updateCamera(sc, now);
    renderer.render(scene, camera);
    dirty = false;
  }

  /* ---------------------------------------------------------------- input (drag / pinch / wheel / tap) */
  const pts = new Map();
  let gestureMoved = false;
  const poke = () => {
    snapRequested = true;
    host.requestFrame();
  };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function tapBall(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([...balls.values()].filter((m) => m.visible), false);
    if (hits.length) host.onTapBall(hits[0].object.userData.id);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, type: e.pointerType });
    if (pts.size === 1) gestureMoved = false;
    else gestureMoved = true;
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (pts.size === 1) {
      if (!gestureMoved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) gestureMoved = true;
      if (gestureMoved) {
        if (p.type === 'mouse' && (p.btn === 2 || (e.buttons & 2))) {
          cam.height = clampCamHeight(cam.height - dy * 0.0015);
          saveCam();
          poke();
        } else if (dx !== 0 && host.canRotate()) {
          host.onRotate(dragToAimDeg(dx));
          poke();
        }
      }
      p.x = e.clientX;
      p.y = e.clientY;
    } else if (pts.size === 2) {
      const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(p.x - other.x, p.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      p.x = e.clientX;
      p.y = e.clientY;
      if (before > 10 && after > 10) cam.dist = clampCamDist((cam.dist * before) / after);
      cam.height = clampCamHeight(cam.height - (dy / 2) * 0.0015);
      saveCam();
      poke();
    }
  });
  const end = (e, cancelled) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (!cancelled && !gestureMoved && pts.size === 0 && p.btn === 0) tapBall(e);
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      cam.dist = clampCamDist(cam.dist * Math.exp(wheelPixels(e) * 0.0012));
      saveCam();
      poke();
    },
    { passive: false },
  );
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    host.onLost();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    dirty = true;
    host.requestFrame();
  });

  /* ---------------------------------------------------------------- public API */
  buildStick(12.5);
  applyQuality();

  return {
    draw,
    resize,
    setTable(geo, profile) {
      if (profile) mouths = { corner: profile.cornerMouth, side: profile.sideMouth };
      const key = `${geo.W}|${geo.H}|${mouths.corner}|${mouths.side}`;
      if (key === tableKey && curGeo === geo) return;
      tableKey = key;
      buildTable(geo);
      aidKey = null;
      host.requestFrame();
    },
    setQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      applyQuality();
      host.requestFrame();
    },
    getQuality: () => quality,
    setCameraMode(m) {
      camMode = m;
      director.reset();
      trans = null;
      host.requestFrame();
    },
    getCameraMode: () => camMode,
    /** Leaving / entering the view: next draw snaps the camera to the aim pose. */
    activate() {
      P = null;
      trans = null;
      lastNow = 0;
      wasShooting = false;
      director.reset();
      aidKey = null;
      predRef = null;
      resize();
    },
    /** A user action moved the aim: skip any camera transition. */
    userInput() {
      snapRequested = true;
    },
    stroke(ms) {
      if (!lastStick) return;
      stroke = { t0: performance.now(), dur: ms, from: lastPull };
      strokeActive = true;
      host.requestFrame();
    },
    animating: () => animatingNow,
    camHeight(delta) {
      cam.height = clampCamHeight(cam.height + delta);
      saveCam();
      poke();
      return `Độ cao mắt ${Math.round(cam.height * 100)} cm`;
    },
    camDist(delta) {
      cam.dist = clampCamDist(cam.dist + delta);
      saveCam();
      poke();
      return `Khoảng cách ${Math.round(cam.dist * 100)} cm`;
    },
    /** Camera position / heading in physics mm for the minimap marker. */
    cameraMarker() {
      if (!P) return null;
      return { x: P.x, y: P.y, h: P.h, top: blendNow > 0.5 };
    },
    label: (m) => CAMERA_MODE_LABEL[m],
    toThree: (p) => toThree(p, tableDims),
    dispose() {
      renderer.dispose();
    },
  };
}
