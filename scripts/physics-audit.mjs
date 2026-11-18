// Physics audit: runs one scenario per criterion of docs/physics-criteria.md against src/core and writes
// docs/physics-audit-report.md. Pure Node. Measures the engine as it is: no constants are tuned here.
// Usage: node scripts/physics-audit.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { R, buildTable } from '../src/core/table.js';
import { Sim, createBall, computeLaunch, strike, G, E_BALL, CUSHION_CONTACT_SIN } from '../src/core/physics.js';
import { defaultTable, defaultCue, cuePreset, tablePreset, powerForStick } from '../src/core/equipment.js';
// Shots were designed on the old linear 500..9000 mm/s power scale; P(old) keeps the same stick speed.
const P = (old) => powerForStick(500 + 8500 * old);
import { rad, deg } from '../src/core/vec.js';

const OK = 'ĐẠT';
const PART = 'MỘT PHẦN';
const FAIL = 'KHÔNG ĐẠT';
const NA = 'CHƯA HỖ TRỢ';

const TABLE = defaultTable();
const GEO = buildTable(TABLE);
const CUE = defaultCue();
const NOSQ = { ...CUE, squirtDegPerFullSide: 0 }; // isolates throw / swerve from squirt
const E = E_BALL; // ball-ball restitution used by the engine (not part of TableProfile)
const EC = TABLE.cushionRestitution; // cushion restitution of the active table profile
const FULL = { ...CUE, squirtDegPerFullSide: 0, spinEfficiency: 1 }; // exact natural-roll tip height 0.4
const noMis = () => 0.5;
const hv = (v) => Math.hypot(v.x, v.y);
const ang = (v) => deg(Math.atan2(v.y, v.x));
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : 'n/a');
const rows = [];
const add = (id, effect, expected, measured, status, note = '') => rows.push({ id, effect, expected, measured, status, note });
/** ĐẠT within tol, MỘT PHẦN within 2*tol (or `partial`), else KHÔNG ĐẠT. */
const byErr = (err, tol) => (err <= tol ? OK : err <= 2 * tol ? PART : FAIL);

const newSim = (balls, cue = CUE, table = TABLE) => new Sim(balls, { table, cue, rng: noMis, orientation: false });
const shotAt = (sim, o) => sim.strike({ aimDir: { x: 1, y: 0 }, power: P(0.1), tip: { x: 0, y: 0 }, elevationDeg: 0, ...o });

/** Step until the cue ball touches a ball; returns pre-contact state of cue and the others (null if none). */
function toContact(sim, maxT = 8) {
  while (sim.time < maxT && sim.isMoving()) {
    const pre = sim.balls.map((b) => ({ id: b.id, vel: { ...b.vel }, w: { ...b.w }, pos: { ...b.pos } }));
    sim.substep();
    if (sim.events.firstContact !== null) return pre;
  }
  return null;
}
const byId = (sim, id) => sim.balls.find((b) => b.id === id);

/** Cut-shot layout: object at (1000,635); cue aims along +x, contact at `cutDeg` (sign: + = object goes +y). */
function cutLayout(cutDeg, sign = 1, gap = 400, cueFirst = true) {
  const th = rad(cutDeg * sign);
  const objDir = { x: Math.cos(th), y: Math.sin(th) };
  const obj = { x: 1000, y: 635 };
  const ghost = { x: obj.x - objDir.x * 2 * R, y: obj.y - objDir.y * 2 * R };
  const cuePos = { x: ghost.x - gap, y: ghost.y };
  return [createBall(0, cuePos.x, cuePos.y), createBall(1, obj.x, obj.y)];
}
/** Object-ball heading vs centre line at the first contact (deg, sign-normalised: + = away from the aim line). */
function cutThrow(cutDeg, sign, cue, power, tipY, gap = 400) {
  const sim = newSim(cutLayout(cutDeg, sign, gap), cue);
  shotAt(sim, { power, tip: { x: 0, y: tipY } });
  const pre = toContact(sim);
  if (!pre) return null;
  const ev = sim.events;
  const centres = ang({ x: ev.firstContactObjPos.x - ev.firstContactPos.x, y: ev.firstContactObjPos.y - ev.firstContactPos.y });
  const o = byId(sim, 1);
  const c = byId(sim, 0);
  return { throwDeg: wrap(ang(o.vel) - centres) * sign, centres, cueAfter: { ...c.vel }, objAfter: { ...o.vel }, pre, sim };
}

/* ------------------------------------------------------------------ A. motion on the cloth */
{
  const sim = newSim([createBall(0, 150, 635)]);
  const L = shotAt(sim, { power: P(0.1) });
  let slid = false;
  let onset = null;
  while (sim.time < 5) {
    sim.substep();
    const b = sim.balls[0];
    if (b.sliding) slid = true;
    else if (slid) {
      onset = { v: hv(b.vel), d: b.pos.x - 150 };
      break;
    }
  }
  const v0 = L.speed;
  add('A1', 'Trượt → lăn (bi đánh giữa)', 'v lăn = 5/7·v0 (±2 %)', `v0=${f(v0, 0)} mm/s; v lăn=${f(onset.v, 0)}; tỉ lệ=${f(onset.v / v0, 4)} (5/7=${f(5 / 7, 4)})`, byErr(Math.abs(onset.v / v0 / (5 / 7) - 1), 0.02));
  const dTheory = (12 * v0 * v0) / (49 * TABLE.muSlide * G);
  add('A2', 'Quãng trượt', 'd = 12·v0²/(49·μs·g) (±5 %)', `đo=${f(onset.d, 1)} mm; lý thuyết=${f(dTheory, 1)} mm; sai lệch=${f(((onset.d / dTheory) - 1) * 100, 2)} %`, byErr(Math.abs(onset.d / dTheory - 1), 0.05));
}
{
  const v = 500;
  const b = createBall(0, 100, 635);
  b.vel = { x: v, y: 0 };
  b.w = { x: 0, y: -v / R, z: 0 };
  const sim = newSim([b]);
  sim.run(60);
  const d = sim.balls[0].pos.x - 100;
  const th = (v * v) / (2 * TABLE.muRoll * G);
  add('A3', 'Quãng lăn đến khi dừng', 'd = v²/(2·μr·g) (±5 %)', `đo=${f(d, 1)} mm; lý thuyết=${f(th, 1)} mm; sai lệch=${f((d / th - 1) * 100, 2)} %`, byErr(Math.abs(d / th - 1), 0.05));
}
{
  const roll = (tipY) => {
    const sim = newSim([createBall(0, 150, 635)]);
    const L = shotAt(sim, { power: P(0.1), tip: { x: 0, y: tipY } });
    let slid = false;
    while (sim.time < 5) {
      sim.substep();
      const b = sim.balls[0];
      if (b.sliding) slid = true;
      else if (slid) return b.vel.x / L.speed;
    }
    return NaN;
  };
  const hi = roll(0.5);
  const lo = roll(-0.5);
  add('A4', 'Xoáy trên/dưới khi đánh', 'cao: v lăn > 5/7·v0 (tăng tốc); thấp: v lăn < 5/7·v0', `cao 50 %: v lăn/v0=${f(hi, 3)}; thấp 50 %: ${f(lo, 3)} (5/7=${f(5 / 7, 3)})`, hi > 5 / 7 && lo < 5 / 7 ? OK : FAIL, lo < 0 ? 'Đánh thấp: bi quay ngược (v lăn < 0)' : '');
}
{
  const sim = newSim([createBall(0, 200, 635)], NOSQ);
  const L = shotAt(sim, { power: P(0.12), tip: { x: 0.5, y: 0 } });
  const wz0 = sim.balls[0].w.z;
  let dev = null;
  let wz1 = null;
  while (sim.time < 3) {
    sim.substep();
    if (sim.time >= 1 && wz1 === null) wz1 = sim.balls[0].w.z;
    if (dev === null && sim.balls[0].pos.x - 200 >= 1000) dev = sim.balls[0].pos.y - 635;
    if (dev !== null && wz1 !== null) break;
  }
  const lateral = dev === null ? NaN : Math.abs(dev);
  add('A5', 'Xoáy ngang suy giảm (θ=0)', 'wz giảm dần; lệch ngang < 1 mm/1 m (không squirt)', `lệch ngang tại 1 m=${f(lateral, 3)} mm; wz(1 s)/wz(0)=${f(wz1 / wz0, 3)}`, lateral < 1 && Math.abs(wz1) < Math.abs(wz0) ? OK : FAIL, `squirt=0 để cô lập; tốc độ ban đầu ${f(L.speed, 0)} mm/s`);
}

/* ------------------------------------------------------------------ B. ball-ball collisions */
{
  const sim = newSim([createBall(0, 1200 - 2 * R - 8, 635), createBall(1, 1200, 635)]);
  const L = shotAt(sim, { power: P(0.14) });
  const pre = toContact(sim);
  sim.substep();
  const r = hv(byId(sim, 0).vel) / hv(pre[0].vel);
  add('B1', 'Đánh dừng (stun) thẳng', 'v bi cái sau chạm < 3 % v0', `v_cue sau/v_cue trước=${f(r * 100, 2)} % (v0=${f(L.speed, 0)} mm/s)`, r < 0.03 ? OK : r < 0.06 ? PART : FAIL, 'Còn lại 2,5 % là do e=0,95: (1−e)/2');
}
{
  const sim = newSim([createBall(0, 1200 - 2 * R - 8, 635), createBall(1, 1200, 635)]);
  shotAt(sim, { power: P(0.14) });
  const pre = toContact(sim);
  const vc = hv(pre[0].vel);
  const vo = hv(byId(sim, 1).vel);
  const e = (2 * vo) / vc - 1;
  add('B2', 'Hệ số phục hồi bi–bi', 'e hiệu dụng 0,93–0,98', `v_obj/v_cue=${f(vo / vc, 4)}; e=${f(e, 4)}`, e >= 0.93 && e <= 0.98 ? OK : FAIL);
}
{
  // criteria v2: deviation from the tangent line = atan(((1-e)/2)*cos(a)/sin(a)); a = cut angle; + = towards the line of centres
  const rows3 = [];
  for (const cut of [15, 30, 45]) {
    const r = cutThrow(cut, 1, CUE, 0.2, 0, 400);
    const tangent = r.centres - 90; // cue travels to the -y side
    const meas = wrap(ang(r.cueAfter) - tangent);
    const expected = deg(Math.atan((((1 - E) / 2) * Math.cos(rad(cut))) / Math.sin(rad(cut))));
    rows3.push({ cut, meas, expected, err: meas - expected });
  }
  const m = Math.max(...rows3.map((r) => Math.abs(r.err)));
  add('B3', 'Quy tắc 90° (stun cắt), có tính e', `lệch so với tiếp tuyến = atan(((1−e)/2)·cosα/sinα), e=${E} (±2°)`, rows3.map((r) => `${r.cut}°: đo ${f(r.meas, 2)}° / lý thuyết ${f(r.expected, 2)}° (sai ${f(r.err, 2)}°)`).join('; '), byErr(m, 2), 'e bi–bi là hằng số của engine (E_BALL), không nằm trong TableProfile');
}
{
  // criteria v2: empirical 30-degree rule, cue-ball deflection 27-34 deg for 1/4, 1/2, 3/4 ball hits (rolling cue ball)
  const out = [];
  for (const frac of [0.25, 0.5, 0.75]) {
    const cut = deg(Math.asin(1 - frac));
    const sim = newSim(cutLayout(cut, 1, 900), FULL);
    shotAt(sim, { power: P(0.08), tip: { x: 0, y: 0.4 } });
    toContact(sim);
    let slid = false;
    while (sim.time < 6) {
      sim.substep();
      if (byId(sim, 0).sliding) slid = true;
      else if (slid) break;
    }
    out.push({ frac, cut, a: Math.abs(ang(byId(sim, 0).vel)) });
  }
  const outside = Math.max(...out.map((o) => Math.max(27 - o.a, o.a - 34, 0)));
  add('B4', 'Quy tắc 30° (bi lăn, cắt 1/4–3/4 bi)', 'góc lệch bi cái 27°–34° (khoảng kinh nghiệm)', out.map((o) => `${o.frac * 100} % bi (cắt ${f(o.cut, 1)}°): ${f(o.a, 2)}°`).join('; '), outside === 0 ? OK : outside <= 2 ? PART : FAIL, 'MỘT PHẦN = lệch ra ngoài khoảng ≤ 2°; công thức lý tưởng e=1 (33,7°) chỉ để tham khảo');
}
{
  const sim = newSim([createBall(0, 1000 - 2 * R - 900, 635), createBall(1, 1000, 635)], FULL);
  shotAt(sim, { power: P(0.08), tip: { x: 0, y: 0.4 } });
  const pre = toContact(sim);
  const vpre = hv(pre[0].vel);
  let slid = false;
  while (sim.time < 6) {
    sim.substep();
    if (byId(sim, 0).sliding) slid = true;
    else if (slid) break;
  }
  const vf = byId(sim, 0).vel.x;
  const exp5 = (5 * ((1 - E) / 2) + 2) / 7;
  add('B5', 'Bi theo thẳng, có tính e', `v cuối/v trước = (5·(1−e)/2+2)/7 = ${f(exp5, 4)} với e=${E} (±3 %)`, `v cuối/v trước=${f(vf / vpre, 4)}; sai lệch=${f((vf / vpre / exp5 - 1) * 100, 2)} %`, byErr(Math.abs(vf / vpre / exp5 - 1), 0.03), 'Lý thuyết bỏ qua ma sát bi–bi theo phương đứng (xoáy trên bị bào mòn nhẹ khi chạm)');
}
{
  const sim = newSim([createBall(0, 1000 - 2 * R - 150, 635), createBall(1, 1000, 635)], FULL);
  shotAt(sim, { power: P(0.15), tip: { x: 0, y: -0.4 } });
  const pre = toContact(sim);
  const sPre = -R * pre[0].w.y; // roll vector before impact (negative = backspin)
  let slid = false;
  while (sim.time < 6) {
    sim.substep();
    if (byId(sim, 0).sliding) slid = true;
    else if (slid) break;
  }
  const vf = byId(sim, 0).vel.x;
  const vAfter = ((1 - E) / 2) * hv(pre[0].vel);
  const expected = (5 * vAfter + 2 * sPre) / 7;
  add('B6', 'Bi kéo thẳng, có tính e', `v cuối = (5·v_sau + 2·R·ω)/7, v_sau=(1−e)/2·v_trước (e=${E}); ngược chiều, ±5 %`, `R·ω trước=${f(sPre, 0)} mm/s; v_sau=${f(vAfter, 0)}; v cuối=${f(vf, 0)}; kỳ vọng=${f(expected, 0)}; tỉ lệ=${f(vf / expected, 3)}`, vf < 0 ? byErr(Math.abs(vf / expected - 1), 0.05) : FAIL, 'Lý thuyết bỏ qua ma sát bi–bi theo phương đứng (làm giảm xoáy lùi khi chạm)');
}
{
  const sim = newSim(cutLayout(30, 1, 900), FULL);
  shotAt(sim, { power: P(0.08), tip: { x: 0, y: 0.4 } });
  toContact(sim);
  const headings = [];
  let last = { ...byId(sim, 0).pos };
  let lastT = sim.time;
  while (sim.time < lastT + 0.7 && sim.isMoving()) {
    for (let i = 0; i < 5; i++) sim.substep();
    const p = byId(sim, 0).pos;
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) headings.push(ang({ x: p.x - last.x, y: p.y - last.y }));
    last = { ...p };
  }
  let maxJump = 0;
  for (let i = 4; i < headings.length; i++) maxJump = Math.max(maxJump, Math.abs(wrap(headings[i] - headings[i - 1])));
  const total = Math.abs(wrap(headings[headings.length - 1] - headings[3]));
  add('B7', 'Đường cong bi cái sau va chạm (bi theo cắt)', 'có cong (tổng đổi hướng > 3°), không gãy khúc (bước < 3°)', `tổng đổi hướng=${f(total, 2)}°; bước lớn nhất=${f(maxJump, 2)}°`, total > 3 && maxJump < 3 ? OK : total > 3 ? PART : FAIL);
}
{
  const sim = newSim(cutLayout(0, 1, 400));
  shotAt(sim, { power: P(0.14) });
  toContact(sim);
  const vo = hv(byId(sim, 1).vel);
  let slid = false;
  while (sim.time < 6) {
    sim.substep();
    if (byId(sim, 1).sliding) slid = true;
    else if (slid) break;
  }
  const vr = hv(byId(sim, 1).vel);
  add('B8', 'Bi mục tiêu trượt rồi lăn', 'v lăn = 5/7·v sau va chạm (±3 %)', `v sau chạm=${f(vo, 0)}; v lăn=${f(vr, 0)}; tỉ lệ=${f(vr / vo, 4)}`, byErr(Math.abs(vr / vo / (5 / 7) - 1), 0.03));
}
const cit30 = cutThrow(30, 1, CUE, 0.2, 0, 400);
add('B9', 'Throw do cắt (CIT)', 'lệch về phía hướng bi cái đi, 0,5–5° (stun cắt 30°)', `lệch so với đường nối tâm=${f(cit30.throwDeg, 2)}° (− = về phía đường ngắm)`, cit30.throwDeg < -0.5 && cit30.throwDeg > -5 ? OK : FAIL);
{
  const run = (tipX) => {
    const sim = newSim([createBall(0, 400, 635), createBall(1, 1000, 635)], NOSQ);
    shotAt(sim, { power: P(0.2), tip: { x: tipX, y: 0 } });
    toContact(sim);
    return ang(byId(sim, 1).vel); // + = right of the aim direction (+y)
  };
  const l = run(-0.5);
  const r = run(0.5);
  add('B10', 'Throw do má phê (SIT)', 'má trái → bi mục tiêu lệch phải (+y), má phải → lệch trái; 1–5°', `má trái 50 %: ${f(l, 2)}°; má phải 50 %: ${f(r, 2)}°`, l > 1 && l < 5 && r < -1 && r > -5 ? OK : l > 0 && r < 0 ? PART : FAIL, 'Squirt=0 để cô lập throw');
}
{
  // contact speed ~1 m/s vs ~5 m/s (stick speed chosen so the ball speed after the tip hit is about that), 30 deg stun cut
  const powerFor = (vBall) => powerForStick(vBall / ((1 + CUE.tipRestitution) * CUE.massG / (CUE.massG + 170)));
  const slow = cutThrow(30, 1, CUE, powerFor(1000), 0, 25);
  const fast = cutThrow(30, 1, CUE, powerFor(5000), 0, 25);
  const ts = Math.abs(slow.throwDeg);
  const tf = Math.abs(fast.throwDeg);
  const r11 = tf / ts;
  add('B11', 'Throw giảm khi đánh mạnh', 'throw(5 m/s) ≤ 0,6 × throw(1 m/s) (stun cắt 30°)', `~1 m/s: ${f(ts, 2)}° (v chạm ${f(hv(slow.pre[0].vel), 0)}); ~5 m/s: ${f(tf, 2)}° (v chạm ${f(hv(fast.pre[0].vel), 0)}); tỉ lệ=${f(r11, 3)}`, r11 <= 0.6 ? OK : r11 <= 0.7 ? PART : FAIL, 'MỘT PHẦN = tỉ lệ ≤ 0,7. Ma sát bi–bi μ(v)=a+b·exp(−c·v) theo tốc độ trượt tiếp xúc');
}
{
  const stun = cutThrow(30, 1, FULL, 0.1, 0, 25);
  const roll = cutThrow(30, 1, FULL, 0.1, 0.4, 25);
  const draw = cutThrow(30, 1, FULL, 0.1, -0.5, 25);
  const a = Math.abs(stun.throwDeg);
  const rr = Math.abs(roll.throwDeg) / a;
  const rd = Math.abs(draw.throwDeg) / a;
  const worst = Math.max(rr, rd);
  add('B12', 'Throw giảm khi bi cái lăn / kéo', 'CIT (lăn) và CIT (kéo) ≤ 0,8 × CIT (stun), cùng tốc độ, cắt 30°', `stun: ${f(a, 2)}°; bi lăn: ${f(Math.abs(roll.throwDeg), 2)}° (tỉ lệ ${f(rr, 3)}); kéo: ${f(Math.abs(draw.throwDeg), 2)}° (tỉ lệ ${f(rd, 3)}); v chạm stun/lăn/kéo=${f(hv(stun.pre[0].vel), 0)}/${f(hv(roll.pre[0].vel), 0)}/${f(hv(draw.pre[0].vel), 0)} mm/s`, worst <= 0.8 ? OK : worst <= 0.9 ? PART : FAIL, 'MỘT PHẦN = tỉ lệ xấu nhất ≤ 0,9');
}
{
  const sim = newSim([createBall(0, 400, 635), createBall(1, 1000, 635)], NOSQ);
  shotAt(sim, { power: P(0.2), tip: { x: -0.5, y: 0 } });
  const pre = toContact(sim);
  const wzCue = pre[0].w.z;
  const wzObj = byId(sim, 1).w.z;
  add('B13', 'Truyền xoáy sang bi mục tiêu', 'bi mục tiêu nhận side spin ngược chiều bi cái', `wz bi cái trước chạm=${f(wzCue, 1)} rad/s; wz bi mục tiêu sau chạm=${f(wzObj, 1)} rad/s`, wzObj !== 0 && Math.sign(wzObj) === -Math.sign(wzCue) ? OK : FAIL);
}
{
  const gap = 0.5;
  const sim = newSim([createBall(0, 300, 635), createBall(1, 800, 635), createBall(2, 800 + 2 * R + gap, 635), createBall(3, 800 + 4 * R + 2 * gap, 635)]);
  shotAt(sim, { power: P(0.2) });
  let minD = Infinity;
  let pFirst = null;
  let pAfter = null;
  while (sim.time < 0.6) {
    sim.substep();
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) minD = Math.min(minD, Math.hypot(sim.balls[i].pos.x - sim.balls[j].pos.x, sim.balls[i].pos.y - sim.balls[j].pos.y));
    if (pFirst === null && sim.events.contacts.length >= 1) pFirst = sim.balls.reduce((s, b) => s + b.vel.x, 0);
    if (pAfter === null && sim.events.contacts.length >= 3) pAfter = sim.balls.reduce((s, b) => s + b.vel.x, 0);
  }
  add('B14', 'Combo / cụm bi thẳng hàng', 'không chồng bi (khoảng cách ≥ 2R), bảo toàn động lượng', `khoảng cách nhỏ nhất=${f(minD, 3)} mm (2R=${f(2 * R, 3)}); động lượng sau chuỗi/ngay sau chạm đầu=${f(pAfter / pFirst, 4)}`, minD >= 2 * R - 0.05 && Math.abs(pAfter / pFirst - 1) < 0.03 ? OK : minD >= 2 * R - 0.5 ? PART : FAIL, 'So sánh tổng vx ngay sau lần chạm 1 với ngay sau lần chạm 3 (bỏ qua ma sát vải giữa hai lần)');
}

/* ------------------------------------------------------------------ C. cue + tip */
{
  const defl = (cue) => {
    const sim = newSim([createBall(0, 300, 635)], cue);
    shotAt(sim, { power: P(0.15), tip: { x: 0.5, y: 0 } });
    for (let i = 0; i < 300; i++) sim.substep();
    const b = sim.balls[0];
    return deg(Math.atan2(b.pos.y - 635, b.pos.x - 300));
  };
  const s = defl(cuePreset('standard'));
  const l = defl(cuePreset('low-deflection'));
  const c = defl(cuePreset('carbon'));
  add('C1', 'Squirt', 'má phải → lệch trái (y<0); |thường| > |LD| > |carbon|', `thường=${f(s, 2)}°; LD=${f(l, 2)}°; carbon=${f(c, 2)}°`, s < 0 && l < 0 && c < 0 && Math.abs(s) > Math.abs(l) && Math.abs(l) > Math.abs(c) ? OK : FAIL, 'Góc đo từ vị trí bi sau 0,5 s so với điểm xuất phát');
}
{
  const dev = (th) => {
    const sim = newSim([createBall(0, 300, 635)], STD_CUE());
    const L = shotAt(sim, { power: P(0.15), tip: { x: 0.5, y: 0 }, elevationDeg: th });
    let d = 0;
    while (sim.isMoving() && sim.balls[0].pos.x < GEO.W - 150) {
      sim.step(1 / 60);
      const p = sim.balls[0].pos;
      d = (p.y - 635) * L.dir.x - (p.x - 300) * L.dir.y;
    }
    return d;
  };
  const d0 = dev(0);
  const d5 = dev(5);
  const d15 = dev(15);
  const d25 = dev(25);
  add('C2', 'Swerve (nâng cơ + má phải)', 'θ=0: không cong; θ>0: cong về phải (+), tăng theo θ', `độ lệch ngang so với hướng xuất phát: θ0=${f(d0, 2)}; θ5=${f(d5, 2)}; θ15=${f(d15, 2)}; θ25=${f(d25, 2)} mm`, Math.abs(d0) < 0.5 && d5 > 0 && d15 > d5 && d25 > d15 ? OK : FAIL);
}
function STD_CUE() {
  return cuePreset('standard');
}
{
  const ok = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0.5 }, CUE);
  const bad = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0.8 }, CUE, () => 1);
  const wmag = Math.hypot(bad.w.x, bad.w.y, bad.w.z);
  const a = Math.abs(deg(Math.atan2(bad.dir.y, bad.dir.x)));
  add('C3', 'Trượt cơ (miscue)', 'tip > giới hạn → 30 % tốc độ, ≤ 3° lệch, không xoáy', `miscue=${bad.miscue}; tốc độ=${f((bad.speed / ok.speed) * 100, 1)} %; lệch=${f(a, 2)}°; |w|=${f(wmag, 3)}`, bad.miscue && Math.abs(bad.speed / ok.speed - 0.3) < 1e-6 && a <= 3 + 1e-9 && wmag === 0 ? OK : FAIL);
}
{
  const a = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 }, { ...CUE, massG: 539 });
  const b = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 }, { ...CUE, massG: 595 });
  add('C4', 'Khối lượng gậy', 'gậy nặng → bi nhanh hơn', `539 g: ${f(a.speed, 0)} mm/s; 595 g: ${f(b.speed, 0)} mm/s`, b.speed > a.speed ? OK : FAIL);
}
{
  const out = [];
  for (const th of [0, 5, 15]) {
    const sim = newSim([createBall(0, 500, 635)], CUE);
    const L = shotAt(sim, { power: P(0.3), tip: { x: 0, y: -0.55 }, elevationDeg: th });
    const b = sim.balls[0];
    out.push(R * Math.hypot(b.w.x, b.w.y, b.w.z) / (2.5 * L.speed * 0.55));
  }
  const max = Math.max(...out);
  add('C5', 'Xoáy tối đa hợp lý', 'R·|ω| ≤ 2,5·v·b (b = độ lệch điểm chạm)', `R|ω|/(2,5·v·b) tại θ=0/5/15°: ${out.map((x) => f(x, 3)).join(' / ')} (spinEfficiency=${CUE.spinEfficiency})`, max <= 1.0001 && Math.abs(out[0] - CUE.spinEfficiency) < 0.01 ? OK : FAIL,
    'Tại θ>0 ω lớn hơn 1/cosθ lần vì xung J được nhân 1/cosθ để giữ nguyên tốc độ ngang');
}

/* ------------------------------------------------------------------ D. cushions + pockets */
function firstCushion(setup) {
  const b = createBall(0, setup.x, setup.y);
  b.vel = { ...setup.vel };
  b.w = { ...(setup.w || { x: setup.vel.y / R, y: -setup.vel.x / R, z: 0 }) };
  const sim = newSim([b], setup.cue || CUE);
  let pre = null;
  while (sim.time < 5) {
    pre = { vel: { ...sim.balls[0].vel }, w: { ...sim.balls[0].w } };
    sim.substep();
    if (sim.events.cushionHits.length) return { sim, pre, post: sim.balls[0] };
  }
  return null;
}
{
  const r = firstCushion({ x: 2200, y: 635, vel: { x: 800, y: 0 } });
  const e = -r.post.vel.x / r.pre.vel.x;
  add('D1', 'Phục hồi băng', 'v pháp tuyến sau/trước 0,70–0,85', `đo=${f(e, 4)} (profile club-9ft: ${TABLE.cushionRestitution})`, e >= 0.7 && e <= 0.85 ? OK : FAIL);
}
{
  const s = 400 / Math.SQRT2;
  const r = firstCushion({ x: 1200, y: 200, vel: { x: s, y: -s } });
  const out = deg(Math.atan2(Math.abs(r.post.vel.y), Math.abs(r.post.vel.x))); // angle off the rail
  // Han (2005) eqs. 14-23 written out for this case: rolling ball, no english, cushion frame
  // (X into the cushion, Y along it, Z up): vX = vY = s, rolling => wY = vX/R, wX = -vY/R, wZ = 0.
  const MU_C = TABLE.cushionSpinTransfer;
  const sn = CUSHION_CONTACT_SIN;
  const cs = Math.sqrt(1 - sn * sn);
  const vX = s;
  const vY = s;
  const wX = -vY / R;
  const wY = vX / R;
  const hx = vX * sn + R * wY;
  const hy = -vY + R * wX * sn;
  const PzE = (1 + EC) * vX * cs;
  const hs = Math.hypot(hx, hy);
  const stick = hs / 3.5 <= MU_C * PzE;
  const PxE = stick ? hx / 3.5 : (MU_C * PzE * hx) / hs;
  const PyE = stick ? hy / 3.5 : (MU_C * PzE * hy) / hs;
  const nvX = vX - PxE * sn - PzE * cs;
  const nvY = vY + PyE;
  const expOut = deg(Math.atan2(Math.abs(nvX), Math.abs(nvY)));
  add('D2', 'Góc phản xạ không xoáy, băng Han 2005 (45°, bi lăn)', `Han 2005 (pt. 14–23), mũi băng sinθ=${f(sn, 3)}, e=${EC}, μ_băng=${MU_C} → ${f(expOut, 2)}° (±3°)`, `góc ra so với băng=${f(out, 2)}° (vào 45°) ngay sau chạm; sai=${f(out - expOut, 2)}°`, byErr(Math.abs(out - expOut), 3));
}
{
  const out = (side) => {
    const s = 400 / Math.SQRT2;
    const w = { x: -s / R, y: -s / R, z: -side / R }; // roll about both axes + english (side = -R*wz)
    const r = firstCushion({ x: 600, y: 90, vel: { x: s, y: -s }, w, cue: NOSQ }); // start near the rail (away from the side pocket) so the english is still there
    return { vx: r.post.vel.x, vy: Math.abs(r.post.vel.y) };
  };
  const run = out(300); // right english, moving +x along the top rail = running english
  const none = out(0);
  const rev = out(-300);
  const t = (o) => o.vx / o.vy; // tangential / normal speed after the bounce (bigger = wider along the rail)
  add('D3', 'Má phê xuôi/ngược ở băng', 'vận tốc dọc băng: xuôi > không effet > ngược', `vx/vy sau băng: xuôi=${f(t(run), 3)}; không=${f(t(none), 3)}; ngược=${f(t(rev), 3)}`, t(run) > t(none) && t(none) > t(rev) ? OK : FAIL, 'xuôi = má phải khi bi chạy +x dọc băng trên');
}
{
  // criteria v2: angle between the path and the cushion at 0.05 s and 0.35 s after the bounce.
  // follow: angle shrinks (curves towards the cushion); draw: angle grows (curves away).
  const bounce = (tipY) => {
    const sim = newSim([createBall(0, 800, 700)], FULL);
    sim.strike({ aimDir: { x: 0.7071, y: -0.7071 }, power: P(0.18), tip: { x: 0, y: tipY }, elevationDeg: 0 });
    while (sim.time < 5 && !sim.events.cushionHits.length) sim.substep();
    const t0 = sim.time;
    const at = (dt) => {
      while (sim.time < t0 + dt) sim.substep();
      const v = sim.balls[0].vel;
      return deg(Math.atan2(Math.abs(v.y), Math.abs(v.x))); // angle off the (horizontal) rail
    };
    const a1 = at(0.05);
    const a2 = at(0.35);
    return { a1, a2 };
  };
  const fo = bounce(0.4);
  const dr = bounce(-0.4);
  const okFollow = fo.a2 < fo.a1;
  const okDraw = dr.a2 > dr.a1;
  add('D4', 'Xoáy trên/dưới qua băng', 'theo: góc với băng giảm dần (0,05 s → 0,35 s); kéo: góc tăng dần', `theo: ${f(fo.a1, 2)}° → ${f(fo.a2, 2)}° (${okFollow ? 'đúng' : 'sai'} chiều); kéo: ${f(dr.a1, 2)}° → ${f(dr.a2, 2)}° (${okDraw ? 'đúng' : 'sai'} chiều)`, okFollow && okDraw ? OK : okFollow || okDraw ? PART : FAIL);
}
{
  const shoot = (off, y0 = null, dir = { x: -1, y: -1 }) => {
    const s = Math.SQRT1_2;
    const x0 = y0 === null ? 700 + off * s : 700;
    const yy = y0 === null ? 700 - off * s : y0;
    const sim = newSim([createBall(0, x0, yy)]);
    sim.strike({ aimDir: dir, power: P(0.25), tip: { x: 0, y: 0 }, elevationDeg: 0 });
    sim.run(8);
    return sim.balls[0].potted;
  };
  const o0 = shoot(0);
  const o20 = shoot(20);
  const o50 = shoot(50);
  const hug = shoot(0, R + 8, { x: -1, y: 0 });
  const ok = o0 && o20 && !o50;
  add('D5', 'Lỗ góc: lệch mép lỗ', 'lệch 0/20 mm vào, 50 mm bị bật ra; đi sát băng vào được', `lệch 0: ${o0 ? 'vào' : 'không'}; 20: ${o20 ? 'vào' : 'không'}; 50: ${o50 ? 'vào' : 'không'}; sát băng: ${hug ? 'vào' : 'không'}`, ok && hug ? OK : ok ? PART : FAIL, ok && !hug ? 'Bi lăn sát băng (tâm cách băng R+8 mm) không rơi: mô hình dùng hướng vào tối thiểu (minCos)' : '');
}
{
  const attempt = (thetaDeg) => {
    const pk = GEO.POCKETS[4]; // side pocket on the top rail, axis (0,1)
    const t = rad(thetaDeg);
    const start = { x: pk.x + 600 * Math.sin(t), y: pk.y + 600 * Math.cos(t) };
    const dir = { x: -Math.sin(t), y: -Math.cos(t) };
    const sim = newSim([createBall(0, start.x, start.y)]);
    sim.strike({ aimDir: dir, power: P(0.25), tip: { x: 0, y: 0 }, elevationDeg: 0 });
    sim.run(8);
    return sim.balls[0].potted;
  };
  const a30 = attempt(30);
  const a70 = attempt(70);
  add('D6', 'Lỗ giữa khó hơn khi góc lớn', 'góc 30° vào; góc 70° bị từ chối', `30°: ${a30 ? 'vào' : 'không'}; 70°: ${a70 ? 'vào' : 'không'} (bắn thẳng vào tâm lỗ)`, a30 && !a70 ? OK : FAIL);
}
{
  const t = rad(55);
  const sideSim = newSim([createBall(0, GEO.W / 2 + 300 * Math.sin(t) + 25, 300 * Math.cos(t))]);
  sideSim.strike({ aimDir: { x: -Math.sin(t), y: -Math.cos(t) }, power: P(0.45), tip: { x: 0, y: 0 }, elevationDeg: 0 });
  sideSim.run(8);
  const jaws = sideSim.events.cushionHits.filter((c) => c.wall === 'jaw').length;
  add('D7', 'Lắc miệng lỗ (pocket jaw rattle)', 'đánh lệch vào má lỗ bị nảy qua lại ≥ 2 lần và bật ra', `số lần đập má lỗ=${jaws}; vào lỗ=${sideSim.balls[0].potted ? 'có' : 'không'}`, !sideSim.balls[0].potted && jaws >= 2 ? OK : FAIL);
}

/* ------------------------------------------------------------------ E. outside the model */
add('E2', 'Bi bẩn / phấn trên bi (kick/skid)', 'ngoài phạm vi', 'không đo', NA, 'Ma sát đồng nhất, không có độ bẩn');
add('E3', 'Mặt bàn nghiêng, vải mòn theo hướng', 'ngoài phạm vi', 'không đo', NA, 'Mặt bàn phẳng, ma sát đẳng hướng');
// E4 (bi lắc trong miệng lỗ) đã được hỗ trợ từ mô hình má lỗ vát và hố rơi.
// E5 (ma sát bi–bi phụ thuộc tốc độ) đã được hỗ trợ từ Giai đoạn 4: không còn thuộc mục E.

/* ------------------------------------------------------------------ report */
const count = (s) => rows.filter((r) => r.status === s).length;
const fails = rows.filter((r) => r.status === FAIL);
const parts = rows.filter((r) => r.status === PART);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const here = dirname(fileURLToPath(import.meta.url));
const lines = [];
lines.push('# Báo cáo kiểm tra vật lý (physics audit)');
lines.push('');
lines.push(`Sinh bởi \`scripts/physics-audit.mjs\` (chạy: \`npm run audit\`) vào ${new Date().toISOString().slice(0, 10)}. Tiêu chí: \`docs/physics-criteria.md\`.`);
lines.push('Thiết bị đo: bàn Club 9ft, gậy mặc định (Gậy thường) trừ khi ghi chú khác; các thông số là ước lượng, **không được chỉnh để đạt tiêu chí**.');
lines.push('Quy ước trạng thái: ĐẠT = trong dung sai của tiêu chí; MỘT PHẦN = trong 2× dung sai hoặc đúng chiều nhưng chưa kiểm hết; KHÔNG ĐẠT = ngoài khoảng đó hoặc sai chiều; CHƯA HỖ TRỢ = ngoài phạm vi mô hình (mục E).');
lines.push('Giá trị kỳ vọng trong tiêu chí là **[Unverified]** (xem đầu `physics-criteria.md`, Bản 2). Kỳ vọng phụ thuộc e dùng E_BALL của engine và `cushionRestitution` của bàn đang đo.');
lines.push('');
lines.push('## Tóm tắt');
lines.push('');
lines.push(`ĐẠT: ${count(OK)} · MỘT PHẦN: ${count(PART)} · KHÔNG ĐẠT: ${count(FAIL)} · CHƯA HỖ TRỢ: ${count(NA)} (tổng ${rows.length})`);
lines.push('');
lines.push(`Không đạt: ${fails.length ? fails.map((r) => r.id).join(', ') : 'không có'}`);
lines.push(`Một phần: ${parts.length ? parts.map((r) => r.id).join(', ') : 'không có'}`);
lines.push('');
lines.push('## Chi tiết');
lines.push('');
lines.push('| ID | Hiệu ứng | Kỳ vọng | Đo được | Trạng thái | Ghi chú |');
lines.push('|---|---|---|---|---|---|');
for (const r of rows) lines.push(`| ${r.id} | ${esc(r.effect)} | ${esc(r.expected)} | ${esc(r.measured)} | **${r.status}** | ${esc(r.note)} |`);
lines.push('');
writeFileSync(join(here, '..', 'docs', 'physics-audit-report.md'), lines.join('\n'), 'utf8');

console.log(`Audit: ĐẠT ${count(OK)} · MỘT PHẦN ${count(PART)} · KHÔNG ĐẠT ${count(FAIL)} · CHƯA HỖ TRỢ ${count(NA)}`);
for (const r of rows) console.log(`${r.id.padEnd(4)} ${r.status.padEnd(11)} ${r.measured}`);
void strike;
void tablePreset;
