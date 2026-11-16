import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toThree, fromThree, physQuatToThree, rotateVec, cameraPose, fovForAspect, topDownPose, createCameraDirector,
  cuePose, pullMm, strokePull, cushionFrames, railHoleOutline, clothCutoutOutline, tableOpeningOutline, clothBedOutline, dashSegments, pathSegments, naturalRollIndex,
  ribbonQuads, ballTexturePixels, uvOfBodyPoint, discLocal, NUMBER_DISCS, clampCamDist, clampCamHeight,
  lerpAngle, easeInOut, nextCameraMode, parseHex, RAIL_WIDTH_3D,
} from '../../src/ui/view3d-math.js';
import { createDropAnim, stepDropAnim, dropVisual, DROP_DURATION } from '../../src/ui/drop-anim.js';
import { integrateQuat, quatIdentity, simulate, createBall } from '../../src/core/physics.js';
import { buildTable, railStripBevel, R } from '../../src/core/table.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const dims = { W: 2540, H: 1270 };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('coordinate mapping round-trip and ball height', () => {
  const p = { x: 700, y: 400, z: -R };
  const t = toThree(p, dims);
  near(t.x, (700 - 1270) / 1000);
  near(t.z, (400 - 635) / 1000);
  near(t.y, R / 1000);
  const b = fromThree(t, dims);
  near(b.x, 700, 1e-6);
  near(b.y, 400, 1e-6);
  near(b.z, -R, 1e-6);
});

test('quaternion mapping: a ball rolling +x moves its top feature toward +x (three frame)', () => {
  const q = quatIdentity();
  // rolling +x: vx = -R * wy  =>  wy < 0
  integrateQuat(q, { x: 0, y: -10, z: 0 }, 0.05);
  const top0 = rotateVec(physQuatToThree(quatIdentity()), { x: 0, y: 0, z: -1 }); // physics "up" body point
  near(top0.y, 1);
  const top = rotateVec(physQuatToThree(q), { x: 0, y: 0, z: -1 });
  assert.ok(top.x > 0.1, `top.x = ${top.x}`);
  near(top.z, 0, 1e-9);
  // identity maps physics axes: +x -> +x, +y -> +z, up(-z) -> +y
  const m = physQuatToThree(quatIdentity());
  const ex = rotateVec(m, { x: 1, y: 0, z: 0 });
  const ey = rotateVec(m, { x: 0, y: 1, z: 0 });
  near(ex.x, 1); near(ey.z, 1);
  // rolling +y (down the screen) moves the top toward +z
  const q2 = quatIdentity();
  integrateQuat(q2, { x: 10, y: 0, z: 0 }, 0.05); // vy = R * wx > 0
  assert.ok(rotateVec(physQuatToThree(q2), { x: 0, y: 0, z: -1 }).z > 0.1);
});

test('camera pose sits behind the cue ball at the requested height for several aims', () => {
  for (const deg of [0, 37, 90, 180, -120, 251]) {
    const h = (deg * Math.PI) / 180;
    const cue = { x: 600, y: 500 };
    const p = cameraPose({ cue, heading: h, distance: 0.55, height: 0.2, dims });
    const ball = toThree({ x: cue.x, y: cue.y, z: -R }, dims);
    const toBall = { x: ball.x - p.position.x, y: 0, z: ball.z - p.position.z };
    assert.ok(dot(toBall, p.aim) > 0.5);
    near(Math.hypot(toBall.x, toBall.z), 0.55, 1e-9);
    near(p.position.y, 0.2);
    assert.ok(dot({ x: p.target.x - ball.x, y: 0, z: p.target.z - ball.z }, p.aim) > 1.1);
    near(p.target.y, R / 1000);
  }
  near(clampCamDist(5), 2); near(clampCamDist(0), 0.25); near(clampCamHeight(2), 0.8); near(clampCamHeight(0), 0.06);
});

test('cue tip touches the ball surface at the english offset; pull-back is monotone with power', () => {
  const ball = { x: 800, y: 600 };
  const aimDir = { x: Math.cos(0.7), y: Math.sin(0.7) };
  for (const tip of [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: -0.3, y: 0.5 }, { x: 0, y: -0.6 }]) {
    for (const el of [0, 5, 20]) {
      const pose = cuePose({ ball, aimDir, elevationDeg: el, tip, pull: 0, dims });
      const c = pose.center;
      const dist = Math.hypot(pose.contact.x - c.x, pose.contact.y - c.y, pose.contact.z - c.z) * 1000;
      assert.ok(Math.abs(dist - R) < 0.5, `dist ${dist}`);
      const rel = { x: pose.contact.x - c.x, y: pose.contact.y - c.y, z: pose.contact.z - c.z };
      near(dot(rel, pose.right) * 1000, tip.x * R, 1e-6);
      near(dot(rel, pose.up) * 1000, tip.y * R, 1e-6);
      assert.ok(dot(pose.dir, rel) < 0); // contact is on the side facing the cue
    }
  }
  let prev = -1;
  for (const pw of [0, 0.25, 0.5, 0.75, 1]) {
    const v = pullMm(pw);
    assert.ok(v > prev);
    prev = v;
  }
  near(pullMm(0), 50); near(pullMm(1), 250);
  const pose = cuePose({ ball, aimDir, elevationDeg: 5, pull: 100, dims });
  const contact = cuePose({ ball, aimDir, elevationDeg: 5, pull: 0, dims }).contact;
  near(Math.hypot(pose.tip.x - contact.x, pose.tip.y - contact.y, pose.tip.z - contact.z) * 1000, 100, 1e-6);
  assert.ok(strokePull(150, 0.5) < 150 && strokePull(150, 1) === 0);
});

test('fovForAspect and topDownPose fit the table + rails and align the long axis', () => {
  near(fovForAspect(16 / 9), 50);
  assert.ok(fovForAspect(9 / 16) > 50 && fovForAspect(9 / 16) <= 75);
  for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16, 3 / 4]) {
    const fov = fovForAspect(aspect);
    const t = topDownPose(2540, 1270, fov, aspect);
    const th = Math.tan((fov * Math.PI) / 360);
    const halfX = (1270 + RAIL_WIDTH_3D) / 1000;
    const halfZ = (635 + RAIL_WIDTH_3D) / 1000;
    const screenV = t.height * th; // vertical half extent
    const screenH = screenV * aspect;
    if (aspect >= 1) {
      assert.ok(screenH >= halfX && screenV >= halfZ, `landscape ${aspect}`);
      assert.deepEqual(t.up, { x: 0, y: 0, z: -1 });
    } else {
      assert.ok(screenV >= halfX && screenH >= halfZ, `portrait ${aspect}`);
      assert.deepEqual(t.up, { x: 1, y: 0, z: 0 });
    }
    assert.ok(t.position.y > 1 && t.position.z / t.position.y < Math.tan(5 * Math.PI / 180));
  }
});

test('camera director: eye -> hold -> top-down -> hold -> eye, scratch hold, input snaps', () => {
  const d = createCameraDirector();
  let r = d.update({ shooting: false }, 0);
  assert.equal(r.state, 'eye'); assert.equal(r.blend, 0);
  r = d.update({ shooting: true }, 1000);
  assert.equal(r.state, 'hold1');
  r = d.update({ shooting: true }, 1200);
  assert.equal(r.blend, 0); // still player-eye during the 250 ms
  r = d.update({ shooting: true }, 1260);
  assert.equal(r.state, 'toTop');
  r = d.update({ shooting: true }, 1560);
  assert.ok(r.blend > 0.4 && r.blend < 0.6 && r.moving);
  r = d.update({ shooting: true }, 1900);
  assert.equal(r.state, 'top'); assert.equal(r.blend, 1);
  r = d.update({ shooting: false }, 3000);
  assert.equal(r.state, 'hold2'); assert.equal(r.blend, 1);
  r = d.update({ shooting: false }, 3200);
  assert.equal(r.blend, 1);
  r = d.update({ shooting: false }, 3310);
  assert.equal(r.state, 'toEye');
  r = d.update({ shooting: false }, 3620);
  assert.ok(r.blend > 0 && r.blend < 1);
  r = d.update({ shooting: false }, 4000);
  assert.equal(r.state, 'eye'); assert.equal(r.blend, 0);

  // short shot that stops before the 250 ms hold ends: never leaves the eye pose
  d.update({ shooting: true }, 5000);
  r = d.update({ shooting: false }, 5100);
  assert.equal(r.state, 'eye'); assert.equal(r.blend, 0);

  // scratch: stays top-down for the longer hold
  d.update({ shooting: true }, 6000);
  d.update({ shooting: true }, 6300);
  d.update({ shooting: true }, 7000);
  d.update({ shooting: false, scratch: true }, 8000);
  r = d.update({ shooting: false, scratch: true }, 8800);
  assert.equal(r.state, 'hold2'); assert.equal(r.blend, 1);
  r = d.update({ shooting: false, scratch: true }, 9250);
  assert.equal(r.state, 'toEye');

  // user input snaps: during toTop -> top, during toEye -> eye
  const e = createCameraDirector();
  e.update({ shooting: true }, 0);
  e.update({ shooting: true }, 300);
  r = e.update({ shooting: true, userInput: true }, 400);
  assert.equal(r.state, 'top'); assert.equal(r.blend, 1);
  e.update({ shooting: false }, 500);
  e.update({ shooting: false }, 900);
  r = e.update({ shooting: false, userInput: true }, 1000);
  assert.equal(r.state, 'eye'); assert.equal(r.blend, 0);
  assert.equal(nextCameraMode('auto'), 'orbit');
  assert.equal(nextCameraMode('orbit'), 'follow');
  assert.equal(nextCameraMode('follow'), 'fixed');
  assert.equal(nextCameraMode('fixed'), 'auto');
});

test('cushion frames are right-handed for every rail segment of every table', () => {
  for (const size of ['7ft', '8ft', '9ft']) {
    const geo = buildTable({ size, cornerMouth: 127, sideMouth: 140, pocketCaptureScale: 0.85 });
    for (const f of cushionFrames(geo.RAIL_SEGMENTS)) {
      const cx = { x: -f.n3.z, y: 0, z: f.n3.x }; // n3 x up
      near(cx.x, f.e3.x); near(cx.z, f.e3.z);
      assert.ok(f.len > 100);
    }
  }
});

test('rail hole outline = cushion rectangle united with pocket circles', () => {
  const geo = buildTable({ size: '9ft', cornerMouth: 127, sideMouth: 140, pocketCaptureScale: 0.85 });
  const circles = geo.POCKETS.map((pk) => {
    const out = pk.type === 'corner' ? 20 : 16;
    return { cx: pk.x - pk.axis.x * out, cy: pk.y - pk.axis.y * out, r: pk.type === 'corner' ? 0.44 * 127 : 0.34 * 140 };
  });
  const inset = 36;
  const pts = railHoleOutline({ W: geo.W, H: geo.H, inset, circles });
  assert.ok(pts.length > 500);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
    const insideRect = a.x > -inset + 1e-3 && a.x < geo.W + inset - 1e-3 && a.y > -inset + 1e-3 && a.y < geo.H + inset - 1e-3;
    assert.ok(!insideRect, 'outline point strictly inside the rectangle');
    for (const c of circles) assert.ok(Math.hypot(a.x - c.cx, a.y - c.cy) > c.r - 1e-3, 'outline point inside a pocket circle');
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 12, 'no jumps');
  }
  const rect = (geo.W + 2 * inset) * (geo.H + 2 * inset);
  assert.ok(Math.abs(area) / 2 > rect);
  // without circles it is exactly the rectangle
  const plain = railHoleOutline({ W: 100, H: 50, inset: 10, circles: [] });
  assert.ok(plain.every((p) => p.x >= -10 && p.x <= 110 && p.y >= -10 && p.y <= 60));
});

test('path helpers: segments, natural roll marker, dashes and ribbons', () => {
  const path = [{ x: 0, y: 0, s: 0 }, { x: 10, y: 0, s: 1 }, { x: 20, y: 0, s: 1 }, { x: 30, y: 0, s: 0 }];
  const segs = pathSegments(path);
  assert.deepEqual(segs.map((s) => s.slide), [true, true, false]);
  assert.equal(naturalRollIndex(path), 3);
  assert.equal(naturalRollIndex([{ x: 0, y: 0, s: 0 }, { x: 1, y: 0, s: 0 }]), -1);
  const dashes = dashSegments({ x: 0, y: 0 }, { x: 100, y: 0 }, 9, 5);
  assert.equal(dashes.length, 8);
  near(dashes[0].b.x, 9);
  near(dashes[7].b.x, 100);
  const rb = ribbonQuads([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, w: 4, c: [1, 0.5, 0] }, { a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, w: 4, c: [1, 1, 1] }], 1.5);
  assert.equal(rb.positions.length, 12); // degenerate segment skipped
  assert.equal(rb.indices.length, 6);
  near(rb.positions[0], 0); near(rb.positions[1], 1.5); near(Math.abs(rb.positions[2] - rb.positions[5]), 4);
});

test('ball textures: stripe, number disc orientation, cue dots', () => {
  const W = 256;
  const H = 128;
  const px = (data, u, v) => {
    const c = Math.min(W - 1, Math.floor(u * W));
    const r = Math.min(H - 1, Math.floor(v * H));
    const o = (r * W + c) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const at = (p) => {
    const t = uvOfBodyPoint(p);
    return t;
  };
  const orange = parseHex('#f77f00');
  const solid = ballTexturePixels({ id: 5, base: orange, stripe: null, dots: false, number: true, glyph: null }, W, H);
  let uv = at({ x: 1, y: 0, z: 0 }); // far from both discs
  assert.deepEqual(px(solid, uv.u, uv.v), orange);
  uv = at({ x: 0, y: 0, z: -1 }); // disc centre
  assert.ok(px(solid, uv.u, uv.v)[0] > 240 && px(solid, uv.u, uv.v)[2] > 230);
  uv = at({ x: 0, y: 0, z: 1 });
  assert.ok(px(solid, uv.u, uv.v)[2] > 230);
  // uv sanity: UP disc centre at u 0.75, equator
  near(at({ x: 0, y: 0, z: -1 }).u, 0.75, 1e-9);
  near(at({ x: 0, y: 0, z: -1 }).v, 0.5, 1e-9);

  const yellow = parseHex('#f4c20d');
  const nine = ballTexturePixels({ id: 9, base: [247, 246, 239], stripe: yellow, dots: false, number: true, glyph: null }, W, H);
  uv = at({ x: 1, y: 0.1, z: 0 });
  assert.deepEqual(px(nine, uv.u, uv.v), yellow);
  uv = at({ x: 0.2, y: 0.98, z: 0.05 }); // near the pole: white
  assert.ok(px(nine, uv.u, uv.v)[2] > 200);

  const cue = ballTexturePixels({ id: 0, base: [247, 246, 239], stripe: null, dots: true, number: false, glyph: null }, W, H);
  const l = Math.hypot(0.55, 0.35, 0.76);
  uv = at({ x: 0.55 / l, y: 0.35 / l, z: -0.76 / l });
  assert.ok(px(cue, uv.u, uv.v)[0] > 190 && px(cue, uv.u, uv.v)[1] < 80);
  uv = at({ x: -0.55 / l, y: -0.35 / l, z: 0.76 / l });
  assert.ok(px(cue, uv.u, uv.v)[1] < 80);

  // text orientation: on the UP disc, text-right = body +x and text-down = body +y (as in the 2D renderer)
  const up = NUMBER_DISCS[0];
  const right = discLocal({ x: 0.2, y: 0, z: -0.98 }, up);
  assert.ok(right.gx > 0 && Math.abs(right.gy) < 1e-9);
  const down = discLocal({ x: 0, y: 0.2, z: -0.98 }, up);
  assert.ok(down.gy > 0);
  const dn = NUMBER_DISCS[1];
  assert.ok(discLocal({ x: -0.2, y: 0, z: 0.98 }, dn).gx > 0);
  assert.ok(discLocal({ x: 0, y: 0.2, z: 0.98 }, dn).gy > 0);
  // a glyph that is opaque only in its right half darkens only the right side
  const glyph = { size: 16, alpha: new Uint8Array(256).map((_, i) => ((i % 16) >= 8 ? 255 : 0)) };
  const g = ballTexturePixels({ id: 3, base: [214, 40, 40], stripe: null, dots: false, number: true, glyph }, 512, 256);
  const pxg = (u, v) => { const o = (Math.floor(v * 256) * 512 + Math.floor(u * 512)) * 4; return g[o]; };
  const pr = uvOfBodyPoint({ x: 0.25, y: 0, z: -Math.sqrt(1 - 0.0625) });
  const pl = uvOfBodyPoint({ x: -0.25, y: 0, z: -Math.sqrt(1 - 0.0625) });
  assert.ok(pxg(pr.u, pr.v) < 80 && pxg(pl.u, pl.v) > 200);
});

test('small math helpers', () => {
  near(lerpAngle(3, -3, 0.5), 3 + (2 * Math.PI - 6) / 2 , 1e-9);
  near(easeInOut(0.5), 0.5); near(easeInOut(0), 0); near(easeInOut(1), 1);
  assert.deepEqual(parseHex('#0b6e4f'), [11, 110, 79]);
});

test('cloth cutout outline = playing rectangle minus pocket circles', () => {
  const geo = buildTable({ size: '9ft', cornerMouth: 127, sideMouth: 140, pocketCaptureScale: 0.85 });
  const circles = geo.POCKETS.map((pk) => {
    const out = pk.type === 'corner' ? 20 : 16;
    return { cx: pk.x - pk.axis.x * out, cy: pk.y - pk.axis.y * out, r: pk.type === 'corner' ? 0.44 * 127 : 0.34 * 140 };
  });
  const pts = clothCutoutOutline({ W: geo.W, H: geo.H, circles });
  assert.ok(pts.length > 500);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
    assert.ok(a.x >= -1e-3 && a.x <= geo.W + 1e-3 && a.y >= -1e-3 && a.y <= geo.H + 1e-3, 'stays inside playing rectangle');
    for (const c of circles) assert.ok(Math.hypot(a.x - c.cx, a.y - c.cy) >= c.r - 1e-3, 'stays outside pocket circles');
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 12, 'no jumps');
  }
  assert.ok(Math.abs(area) / 2 < geo.W * geo.H, 'smaller than full rectangle');
});

test('pocket drop animation: Sim records drop info, ball falls downward and fades out inside pocket cup', () => {
  const res = simulate([createBall(0, 300, 300)], { aimDir: { x: -1, y: -1 }, power: 0.4, tip: { x: 0, y: 0 } }, { recordPaths: false });
  assert.equal(res.events.drops.length, 1);
  const d0 = res.events.drops[0];
  assert.equal(d0.id, 0);
  assert.ok(d0.pr > 30);
  const anim = createDropAnim(d0);
  let alive = true;
  let maxZ = 0;
  for (let i = 0; i < 60 && alive; i++) {
    alive = stepDropAnim(anim, 1 / 60);
    maxZ = Math.max(maxZ, anim.z);
    assert.ok(Math.hypot(anim.x - anim.px, anim.y - anim.py) <= anim.pr, 'stays inside pocket well');
  }
  assert.equal(alive, false, 'finishes within 1 s');
  assert.ok(anim.t >= DROP_DURATION);
  assert.ok(maxZ > 40, `ball dropped visibly (${maxZ} mm)`);
  assert.equal(dropVisual(anim).fade, 0);
});

test('pocket mouth geometry: beveled cushion strips, cloth throat bed and rail opening outline', () => {
  const geo = buildTable({ size: '9ft', cornerMouth: 127, sideMouth: 140, pocketCaptureScale: 0.85 });
  // beveled cushion ends flare away from pocket openings (back shorter than nose)
  for (const s of geo.RAIL_SEGMENTS) {
    const bev = railStripBevel(s, geo.JAWS, 36);
    assert.ok(bev.slopeStart < 0 && bev.slopeEnd > 0, 'cushion bevels inward on both pocket ends');
    near(Math.hypot(bev.pts[1].x - bev.pts[0].x, bev.pts[1].y - bev.pts[0].y), bev.len);
  }
  // cushionFrames oriented bevels keep exact back corners even when segment ends swap for right-handedness
  const frames = cushionFrames(geo.RAIL_SEGMENTS);
  geo.RAIL_SEGMENTS.forEach((s, idx) => {
    const f = frames[idx];
    const fSeg = { a: f.origin, b: { x: f.origin.x + f.e3.x * f.len, y: f.origin.y + f.e3.z * f.len }, n: s.n };
    const fBev = railStripBevel(fSeg, geo.JAWS, 36);
    const orig = railStripBevel(s, geo.JAWS, 36);
    assert.ok(fBev.slopeStart < 0 && fBev.slopeEnd > 0, `frame-oriented bevel flares inward on seg ${idx}`);
    const back0 = { x: f.origin.x + 36 * f.n3.x + 36 * fBev.slopeStart * f.e3.x, y: f.origin.y + 36 * f.n3.z + 36 * fBev.slopeStart * f.e3.z };
    const back1 = { x: fSeg.b.x + 36 * f.n3.x + 36 * fBev.slopeEnd * f.e3.x, y: fSeg.b.y + 36 * f.n3.z + 36 * fBev.slopeEnd * f.e3.z };
    const set = [orig.pts[2], orig.pts[3]];
    assert.ok(set.some((p) => Math.hypot(p.x - back0.x, p.y - back0.y) < 1e-6));
    assert.ok(set.some((p) => Math.hypot(p.x - back1.x, p.y - back1.y) < 1e-6));
  });
  const clothPts = clothBedOutline({ W: geo.W, H: geo.H, pockets: geo.POCKETS, step: 3 });
  assert.ok(clothPts.length > 100);
  for (const p of clothPts) {
    for (const pk of geo.POCKETS) {
      assert.ok(Math.hypot(p.x - pk.cx, p.y - pk.cy) >= pk.dropR - 1e-3, 'cloth stays outside drop wells');
    }
  }
  const openPts = tableOpeningOutline({ W: geo.W, H: geo.H, inset: 36, pockets: geo.POCKETS, step: 3 });
  assert.ok(openPts.length > 100);
  for (const p of openPts) {
    assert.ok(Math.abs(p.x) <= geo.W + RAIL_WIDTH_3D && Math.abs(p.y) <= geo.H + RAIL_WIDTH_3D);
    for (const pk of geo.POCKETS) {
      assert.ok(Math.hypot(p.x - pk.cx, p.y - pk.cy) >= pk.dropR - 1e-3, 'rail frame stays outside drop wells');
    }
  }
});
