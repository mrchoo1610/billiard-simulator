// Compares app-engine and pooltool trajectories (outputs of run-js.mjs and run-pooltool.py).
// Writes docs/engine-compare/report.md + one SVG overlay per shot.
// Usage: node scripts/engine-compare/compare.mjs [js.json] [pooltool.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tmp = join(root, 'tmp', 'engine-compare');
const A = JSON.parse(readFileSync(process.argv[2] || join(tmp, 'js.json'), 'utf8'));
const B = JSON.parse(readFileSync(process.argv[3] || join(tmp, 'pooltool.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const outDir = join(root, 'docs', 'engine-compare');
mkdirSync(outDir, { recursive: true });

const { W, H } = A.table;
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

/** Position of ball `id` at time t (linear interpolation; holds the last sample after the shot ends). */
function posAt(samples, id, t) {
  let lo = 0;
  let hi = samples.length - 1;
  if (t >= samples[hi].t) return samples[hi].balls.find((b) => b.id === id);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const s0 = samples[lo];
  const s1 = samples[hi];
  const p0 = s0.balls.find((b) => b.id === id);
  const p1 = s1.balls.find((b) => b.id === id);
  const k = s1.t > s0.t ? (t - s0.t) / (s1.t - s0.t) : 0;
  return { id, x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k, potted: p1.potted };
}

/** Largest sample-to-sample ball speed (mm/s). Above JUMP_LIMIT = an engine artifact (teleport), not physics. */
const JUMP_LIMIT = 12000;
function maxJumpSpeed(s) {
  let worst = 0;
  for (let i = 1; i < s.samples.length; i++) {
    const a = s.samples[i - 1];
    const b = s.samples[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    for (const q of b.balls) {
      const p = a.balls.find((x) => x.id === q.id);
      if (p && !q.potted) worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y) / dt);
    }
  }
  return worst;
}

function compareShot(sa, sb) {
  const ids = sa.samples[0].balls.map((b) => b.id);
  const T = Math.max(sa.duration, sb.duration);
  const perBall = ids.map((id) => {
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let t = 0; t <= T + 1e-9; t += spec.sampleDt) {
      const p = posAt(sa.samples, id, t);
      const q = posAt(sb.samples, id, t);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      max = Math.max(max, d);
      sum += d * d;
      n++;
    }
    const pa = sa.samples.at(-1).balls.find((b) => b.id === id);
    const pb = sb.samples.at(-1).balls.find((b) => b.id === id);
    return { id, final: Math.hypot(pa.x - pb.x, pa.y - pb.y), max, rms: Math.sqrt(sum / n), endA: pa, endB: pb };
  });
  const firstContact = (s) => s.events.contacts[0]?.t ?? null;
  return {
    id: sa.id,
    jumpA: maxJumpSpeed(sa),
    jumpB: maxJumpSpeed(sb),
    desc: spec.shots.find((s) => s.id === sa.id)?.desc || '',
    durA: sa.duration,
    durB: sb.duration,
    cushA: sa.events.cushions.length,
    cushB: sb.events.cushions.length,
    contactA: firstContact(sa),
    contactB: firstContact(sb),
    potA: sa.events.potted,
    potB: sb.events.potted,
    perBall,
  };
}

const COLORS = { 0: '#ffffff', 1: '#f2c14e', 2: '#3a7bd5' };
function svgFor(sa, sb) {
  const pad = 40;
  const sc = 0.3;
  const w = W * sc + 2 * pad;
  const h = H * sc + 2 * pad;
  const X = (x) => (pad + x * sc).toFixed(1);
  const Y = (y) => (pad + y * sc).toFixed(1);
  const line = (s, id, dash) => {
    const pts = s.samples.map((smp) => smp.balls.find((b) => b.id === id)).filter((b) => !b.potted).map((b) => `${X(b.x)},${Y(b.y)}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${COLORS[id] || '#e86a5c'}" stroke-width="2" ${dash ? 'stroke-dasharray="6 4"' : ''} opacity="0.9"/>`;
  };
  const ids = sa.samples[0].balls.map((b) => b.id);
  const starts = sa.samples[0].balls.map((b) => `<circle cx="${X(b.x)}" cy="${Y(b.y)}" r="${(28.575 * sc).toFixed(1)}" fill="${COLORS[b.id] || '#e86a5c'}" opacity="0.6"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 24}" viewBox="0 0 ${w} ${h + 24}">
<rect width="${w}" height="${h + 24}" fill="#3b2a1a"/>
<rect x="${pad}" y="${pad}" width="${W * sc}" height="${H * sc}" fill="#0b6e4f"/>
${starts.join('\n')}
${ids.map((id) => line(sa, id, false)).join('\n')}
${ids.map((id) => line(sb, id, true)).join('\n')}
<text x="${pad}" y="${h + 14}" fill="#eee" font-family="sans-serif" font-size="13">${sa.id} — nét liền: app · nét đứt: pooltool</text>
</svg>`;
}

const rows = [];
for (const sa of A.shots) {
  const sb = B.shots.find((s) => s.id === sa.id);
  if (!sb) {
    console.warn(`missing in pooltool output: ${sa.id}`);
    continue;
  }
  rows.push(compareShot(sa, sb));
  writeFileSync(join(outDir, `${sa.id}.svg`), svgFor(sa, sb));
}

const md = [];
md.push('# So sánh engine: app vs pooltool');
md.push('');
md.push(`Sinh bởi \`scripts/engine-compare/compare.mjs\` — pooltool ${B.version || '?'} (mô hình băng: ${B.cushion || 'stronge'}), bàn \`${spec.table}\` (${W}×${H} mm).`);
md.push('Cả hai engine nhận **cùng trạng thái ban đầu của bi cái** (vận tốc + xoáy), không qua mô hình cơ, nên chênh lệch chỉ đến từ vật lý bàn / băng / va chạm.');
md.push('Thông số pooltool được đặt theo profile bàn của app (xem `run-pooltool.py`). Hình học lỗ hai bên khác nhau.');
md.push('');
md.push('| Cú đánh | Bi | Lệch cuối (mm) | Lệch max (mm) | RMS (mm) | Thời gian app / pt (s) | Số lần chạm băng app / pt | Va chạm bi đầu app / pt (s) | Rơi lỗ app / pt |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  for (const b of r.perBall) {
    md.push(
      `| ${r.id} | ${b.id} | ${f(b.final)} | ${f(b.max)} | ${f(b.rms)} | ${f(r.durA, 2)} / ${f(r.durB, 2)} | ${r.cushA} / ${r.cushB} | ${r.contactA === null ? '–' : f(r.contactA, 3)} / ${r.contactB === null ? '–' : f(r.contactB, 3)} | ${JSON.stringify(r.potA)} / ${JSON.stringify(r.potB)} |`,
    );
  }
}
const bad = rows.filter((r) => r.jumpA > JUMP_LIMIT || r.jumpB > JUMP_LIMIT);
md.push('');
if (bad.length) {
  md.push(`**Cảnh báo:** bi "dịch chuyển tức thời" (> ${JUMP_LIMIT} mm/s giữa hai mẫu) ở: ${bad.map((r) => `${r.id} (${r.jumpA > JUMP_LIMIT ? 'app' : ''}${r.jumpB > JUMP_LIMIT ? ' pooltool' : ''})`).join(', ')} — kết quả cú đó không dùng được.`);
} else {
  md.push(`Kiểm tra dịch chuyển tức thời: không có (ngưỡng ${JUMP_LIMIT} mm/s).`);
}
md.push('');
md.push('## Hình quỹ đạo');
md.push('');
for (const r of rows) {
  md.push(`### ${r.id} — ${r.desc}`);
  md.push('');
  md.push(`![${r.id}](${r.id}.svg)`);
  md.push('');
}
writeFileSync(join(outDir, 'report.md'), md.join('\n'));

console.log('shot'.padEnd(18), 'ball', 'final', '  max', '  rms', ' durA', ' durB', 'cushA/B');
for (const r of rows) {
  for (const b of r.perBall) {
    console.log(r.id.padEnd(18), String(b.id).padEnd(4), f(b.final).padStart(5), f(b.max).padStart(5), f(b.rms).padStart(5), f(r.durA, 2).padStart(5), f(r.durB, 2).padStart(5), `${r.cushA}/${r.cushB}`);
  }
}
console.log(`report -> ${join(outDir, 'report.md')}`);
