// Realistic 3D "Mắt cơ thủ" view (Phase 6). Lazily imported by app.js on first open; imports the vendored three.js r164.
// Scene layout: `root` (scaled 0.001, in physics millimetres: x -> three.x, y -> three.z, up -> three.y) holds the
// table, balls and aids; the cue stick, hit marker, lights and camera live in metres (three world, table centred).
import * as THREE from '../../assets/vendor/three/three.module.min.js';
import { R, railStripBevel } from '../core/table.js';
import { cueVisualStyle } from '../core/equipment.js';
import { BALL_COLORS } from './render.js';
import { wheelPixels } from './keyboard.js';
import {
  MM, RAIL_WIDTH_3D, CAM_DIST_DEFAULT, CAM_HEIGHT_DEFAULT, clampCamDist, clampCamHeight, cameraPose, topDownPose,
  fovForAspect, createCameraDirector, easeInOut, lerpAngle, smoothAlpha, physQuatToThree, cuePose, pullMm, strokePull,
  cushionFrames, tableOpeningOutline, clothBedOutline, dashSegments, pathSegments, naturalRollIndex, ribbonQuads, ballTexturePixels,
  parseHex, dragToAimDeg, toThree, CAMERA_MODE_LABEL,
} from './view3d-math.js';
import { dropVisual } from './drop-anim.js';

const TRANSITION_MS = 1000; // camera glide back to the cue ball after a shot (slow enough not to cause motion sickness)
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
    // dark pit floor well below the pocket cups
    flat(new THREE.PlaneGeometry(W + 2 * IN, H + 2 * IN), new THREE.MeshBasicMaterial({ color: '#030504' }), W / 2, -92, H / 2);
    // cloth with tapered pocket throat shelves up to each pocket well rim
    const clothShape = new THREE.Shape();
    const clothPts = clothBedOutline({ W, H, pockets: geo.POCKETS, step: 3 });
    clothPts.forEach((p, i) => (i ? clothShape.lineTo(p.x, -p.y) : clothShape.moveTo(p.x, -p.y)));
    clothShape.closePath();
    const clothMat = new THREE.MeshStandardMaterial({ color: '#0b6e4f', roughness: 0.92, metalness: 0, map: clothTex });
    clothTex.repeat.set(1 / 250, 1 / 250);
    const cloth = flat(new THREE.ShapeGeometry(clothShape), clothMat, 0, 0, 0);
    cloth.receiveShadow = true;
    // beveled cushions matching the exact pocket jaw facing angles
    const rubber = new THREE.MeshStandardMaterial({ color: '#0a5a41', roughness: 0.95 });
    const prof = new THREE.Shape();
    prof.moveTo(0, 0);
    prof.lineTo(IN, 0);
    prof.lineTo(IN, YR - 2);
    prof.lineTo(2, R + 3);
    prof.lineTo(0, R);
    const frames = cushionFrames(geo.RAIL_SEGMENTS);
    geo.RAIL_SEGMENTS.forEach((seg, idx) => {
      const f = frames[idx];
      const frameSeg = {
        a: f.origin,
        b: { x: f.origin.x + f.e3.x * f.len, y: f.origin.y + f.e3.z * f.len },
        n: seg.n,
      };
      const bev = railStripBevel(frameSeg, geo.JAWS, IN);
      const geom = new THREE.ExtrudeGeometry(prof, { depth: f.len, bevelEnabled: false });
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const t = f.len > 0 ? z / f.len : 0;
        pos.setZ(i, z + (1 - t) * (x * bev.slopeStart) + t * (x * bev.slopeEnd));
      }
      geom.computeVertexNormals();
      const m = new THREE.Mesh(geom, rubber);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(f.n3.x, f.n3.y, f.n3.z),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(f.e3.x, f.e3.y, f.e3.z),
      );
      basis.setPosition(f.origin.x, 0, f.origin.y);
      basis.decompose(m.position, m.quaternion, m.scale);
      m.receiveShadow = true;
      add(m);
    });
    // 3D pocket wells, dark jaw facings, and leather pocket collars
    const wellMat = new THREE.MeshStandardMaterial({ color: '#0d0f0f', roughness: 0.96, side: THREE.DoubleSide });
    const pitMat = new THREE.MeshBasicMaterial({ color: '#030404' });
    const leatherMat = new THREE.MeshStandardMaterial({ color: '#1b1d1e', roughness: 0.72, metalness: 0.08 });
    for (const pk of geo.POCKETS) {
      const well = new THREE.Mesh(new THREE.CylinderGeometry(pk.dropR, pk.dropR * 0.88, 90, 36, 1, true), wellMat);
      well.position.set(pk.cx, -44.8, pk.cy);
      add(well);
      flat(new THREE.CircleGeometry(pk.dropR * 0.88, 28), pitMat, pk.cx, -89.8, pk.cy);
      // outer pocket leather rim/hood casting around the back of the drop well
      const [j0, j1] = pk.jaws;
      const a0 = Math.atan2(-(j0.b.y - pk.cy), j0.b.x - pk.cx);
      const a1 = Math.atan2(-(j1.b.y - pk.cy), j1.b.x - pk.cx);
      let d1 = (a1 - a0) % (2 * Math.PI);
      if (d1 < 0) d1 += 2 * Math.PI;
      const d2 = d1 - 2 * Math.PI;
      const midAngle = a0 + d1 / 2;
      // shape coords use (x, -y), so table axis in shape plane is (pk.axis.x, -pk.axis.y)
      const back1 = Math.cos(midAngle) * pk.axis.x + Math.sin(midAngle) * -pk.axis.y < 0;
      const sweep = back1 ? d1 : d2;
      const rIn = pk.dropR;
      const rOut = pk.dropR + 10;
      const collar = new THREE.Shape();
      const segs = 24;
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (sweep * i) / segs;
        const x = pk.cx + rIn * Math.cos(a);
        const y = -pk.cy + rIn * Math.sin(a);
        i ? collar.lineTo(x, y) : collar.moveTo(x, y);
      }
      for (let i = segs; i >= 0; i--) {
        const a = a0 + (sweep * i) / segs;
        collar.lineTo(pk.cx + rOut * Math.cos(a), -pk.cy + rOut * Math.sin(a));
      }
      collar.closePath();
      const hood = new THREE.Mesh(new THREE.ExtrudeGeometry(collar, { depth: YR + 1.5, bevelEnabled: false }), leatherMat);
      hood.rotation.x = -Math.PI / 2;
      hood.position.y = 0;
      hood.receiveShadow = true;
      add(hood);
    }
    // subtle leather/rubber facing plates along the inner pocket jaws
    for (const j of geo.JAWS) {
      const fGeo = new THREE.BoxGeometry(j.len, R + 6, 2.2);
      const fMesh = new THREE.Mesh(fGeo, leatherMat);
      const mx = (j.a.x + j.b.x) / 2 - j.n.x * 0.8;
      const my = (j.a.y + j.b.y) / 2 - j.n.y * 0.8;
      fMesh.position.set(mx, (R + 6) / 2, my);
      fMesh.rotation.y = -Math.atan2(j.b.y - j.a.y, j.b.x - j.a.x);
      add(fMesh);
    }
    // wood rail top with the opening (shape y = -physics y, then rotated flat)
    // outer rectangle in (x, -y): shape y' = -physics y
    const outer = new THREE.Shape();
    outer.moveTo(-RW, -(-RW));
    outer.lineTo(W + RW, -(-RW));
    outer.lineTo(W + RW, -(H + RW));
    outer.lineTo(-RW, -(H + RW));
    outer.closePath();
    const hole = new THREE.Path();
    const outline = tableOpeningOutline({ W, H, inset: IN, pockets: geo.POCKETS, step: 3 });
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
    g.font = n >= 10 ? '700 66px system-ui, "Segoe UI", sans-serif' : '700 80px system-ui, "Segoe UI", sans-serif';
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
        : id >= 9
          ? { base: white, stripe: parseHex(BALL_COLORS[id] || BALL_COLORS[9]), dots: false, number: true, glyph: glyph(id) }
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
      m.material.transparent = false;
      m.material.opacity = 1;
      m.castShadow = true;
      m.position.set(b.pos.x, R + (b.z || 0), b.pos.y);
      const q = physQuatToThree(b.q || IDENT_Q);
      m.quaternion.set(q.x, q.y, q.z, q.w);
      seen.add(b.id);
    }
    if (sc.drops) {
      for (const d of sc.drops) {
        if (seen.has(d.id)) continue;
        const { fade } = dropVisual(d);
        if (fade <= 0.01) continue;
        const m = ensureBall(d.id);
        m.visible = true;
        m.material.transparent = fade < 0.999;
        m.material.opacity = fade;
        m.castShadow = fade > 0.5;
        m.position.set(d.x, R - d.z, d.y);
        const q = physQuatToThree(d.q || IDENT_Q);
        m.quaternion.set(q.x, q.y, q.z, q.w);
        seen.add(d.id);
      }
    }
    for (const [id, m] of balls) if (!seen.has(id)) m.visible = false;
  }

  /* ---------------------------------------------------------------- cue stick + hit marker */
  const stick = new THREE.Group();
  stick.scale.setScalar(MM);
  scene.add(stick);
  let stickStyleKey = '';
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.0021, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
  marker.visible = false;
  scene.add(marker);

  function buildStick(cue) {
    const vis = cueVisualStyle(cue);
    disposeGroup(stick);
    stickStyleKey = vis.key;
    const rt = vis.tipDiameterMm / 2;
    const s = vis.profileScale;
    const ferrEnd = vis.tipLenMm + vis.ferruleLenMm;
    const rNeck = rt + 0.3;
    const rJoint = 10.4 * s;
    const rCollar = 11.0 * s;
    const rFore = 12.2 * s;
    const rWrapEnd = 13.6 * s;
    const rCap = 14.8 * s;
    const rButtEnd = 15.2 * s;
    const part = (y0, y1, r0, r1, color, rough = 0.5, metal = 0) => {
      // tip end at y0 (radius r0), butt end at y1 (radius r1); cylinder axis = local Y, tip at the origin
      const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 20, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
      m.position.y = (y0 + y1) / 2;
      m.castShadow = true;
      stick.add(m);
    };
    part(0, vis.tipLenMm, rt, rt, vis.tipColor3d, vis.tipRough); // tip
    part(vis.tipLenMm, ferrEnd, rt, rNeck, vis.ferruleColor, 0.32); // ferrule
    part(ferrEnd, 760, rNeck, rJoint, vis.shaftColor, vis.shaftRough, vis.shaft === 'carbon' ? 0.15 : 0); // shaft
    part(760, 796, rJoint, rCollar, vis.collarColor, 0.25, 0.65); // joint collar / metallic ring
    part(796, 980, rCollar, rFore, vis.forearmColor, 0.35); // forearm
    part(980, 1260, rFore, rWrapEnd, vis.wrapColor, 0.85); // grip / wrap
    part(1260, STICK_LEN - 26, rWrapEnd, rCap, vis.buttColor, 0.35); // butt sleeve
    part(STICK_LEN - 26, STICK_LEN, rCap, rButtEnd, vis.capColor, 0.3, 0.2); // butt cap
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
    const cueSpec = st.cue || { tipDiameterMm: sc.tipDiameterMm || 12.5 };
    const vis = cueVisualStyle(cueSpec);
    if (vis.key !== stickStyleKey) buildStick(cueSpec);
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
      if (o.aim) {
        if (sc.simpleAim) dashed(info.cue, along(info.cue, info.aimDir, info.aimLen), 2.2, [1, 1, 1], 14, 14);
        else solid(info.cue, along(info.cue, info.aimDir, info.aimLen), 3, blocked ? [1, 0.32, 0.32] : [1, 1, 1]);
      }
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
      if (o.pocket && info.manual && hasGhost) solid(info.obj, along(info.obj, info.objDir, sc.objLineLen || 500), 3, [1, 0.835, 0.29]);
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
        const rr = pk.dropR + 8;
        flatRing(aidGroup, pk.cx, pk.cy, rr - 2.5, rr, '#ffd54a', sc.pocketExplicit ? 1 : 0.6, 1.4);
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
  let orbitYaw = 0; // manual orbit offset during bot turns / spectating (radians)
  let autoOrbitAngle = 0; // continuous rotation for 'orbit' broadcast camera mode
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
    animatingNow = false; // recomputed every frame: a latched flag would keep WebGL rendering while idle
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
      if (!trans) {
        if (sc.isBot && Math.abs(lerpAngle(P.h, goal.h, 1) - P.h) > 0.005) {
          P.x = goal.x;
          P.y = goal.y;
          P.h = lerpAngle(P.h, goal.h, smoothAlpha(dt, 7));
          animatingNow = true;
        } else {
          P = { ...goal };
        }
      }
    } else if (camMode === 'follow' && cue) {
      const a = smoothAlpha(dt, 3);
      P.x += (cue.pos.x - P.x) * a;
      P.y += (cue.pos.y - P.y) * a;
      const sp = cue.vel ? Math.hypot(cue.vel.x, cue.vel.y) : 0;
      if (sp > 200) P.h = lerpAngle(P.h, Math.atan2(cue.vel.y, cue.vel.x), smoothAlpha(dt, 2.5));
    }
    if (camMode === 'orbit') {
      autoOrbitAngle += dt * 0.35;
      animatingNow = true;
      if (shooting && cue) {
        const a = smoothAlpha(dt, 3);
        P.x += (cue.pos.x - P.x) * a;
        P.y += (cue.pos.y - P.y) * a;
      }
    }
    if (host.canRotate() && Math.abs(orbitYaw) > 1e-3) {
      orbitYaw = lerpAngle(orbitYaw, 0, smoothAlpha(dt, 8));
      animatingNow = true;
    } else if (host.canRotate()) {
      orbitYaw = 0;
    }
    // situational director (Tự động)
    let blend = 0;
    let moving = false;
    let dirActive = false;
    if (camMode === 'auto') {
      const r = director.update({ shooting, scratch: !!sc.scratch, userInput: snapRequested }, now);
      blend = r.blend;
      moving = r.moving;
      dirActive = r.state !== 'eye' && r.state !== 'top';
    } else {
      director.reset();
    }
    snapRequested = false;
    wasShooting = shooting;
    blendNow = blend;

    const aspect = camera.aspect;
    const fovEye = fovForAspect(aspect);
    const camHeading = P.h + orbitYaw + (camMode === 'orbit' ? autoOrbitAngle : 0);
    const eye = cameraPose({ cue: { x: P.x, y: P.y }, heading: camHeading, distance: cam.dist, height: cam.height, dims: tableDims });
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
    } else {
      camera.position.set(eye.position.x, eye.position.y, eye.position.z);
      camera.quaternion.copy(qEye);
    }
    if (Math.abs(camera.fov - fovEye) > 1e-4) {
      camera.fov = fovEye;
      camera.updateProjectionMatrix();
    }
    animatingNow = !!trans || moving || dirActive || strokeActive || (shooting && camMode === 'follow') || (camMode === 'orbit') || animatingNow;
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
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
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
        } else if (host.canRotate()) {
          if (dx !== 0) {
            orbitYaw = 0;
            host.onRotate(dragToAimDeg(dx));
            poke();
          }
        } else {
          // Free camera view adjustment during Bot turns / BvB matches / rolling balls
          if (dx !== 0) orbitYaw -= dragToAimDeg(dx) * (Math.PI / 180);
          if (dy !== 0) cam.height = clampCamHeight(cam.height - dy * 0.0015);
          saveCam();
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
    if (!cancelled && !gestureMoved && pts.size === 0 && p.btn === 0) {
      const now = performance.now();
      if (now - lastTapTime < 340 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 36) {
        // Double tap on tablet / touch screen: reset camera angle behind cue ball
        orbitYaw = 0;
        poke();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
        tapBall(e);
      }
    }
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', () => {
    orbitYaw = 0;
    poke();
  });
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
      if (m === 'orbit') autoOrbitAngle = 0;
      director.reset();
      trans = null;
      host.requestFrame();
    },
    getCameraMode: () => camMode,
    /** Leaving / entering the view: next draw snaps the camera to the aim pose. */
    activate() {
      P = null;
      trans = null;
      orbitYaw = 0;
      autoOrbitAngle = 0;
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
      return { x: P.x, y: P.y, h: P.h + orbitYaw + (camMode === 'orbit' ? autoOrbitAngle : 0), top: blendNow > 0.5 };
    },
    label: (m) => CAMERA_MODE_LABEL[m],
    toThree: (p) => toThree(p, tableDims),
    dispose() {
      renderer.dispose();
    },
  };
}
