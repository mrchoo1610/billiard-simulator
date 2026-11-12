// Encode / decode table positions in the URL hash. Pure module.
// Format: c=1270,635;1=1905,635;9=2000,700;t=1;p=2;tb=club-9ft;cu=user-cue
// a = manual aim angle in degrees (1 decimal, optional).
// tb = table profile id, cu = cue profile id (both optional). Positions are in mm on the sharer's table.
import { R } from '../core/table.js';
import { SIZES } from '../core/equipment.js';

const POCKET_COUNT = 6;
const ID_RE = /^[a-z0-9-]{1,24}$/;
const { W, H } = SIZES['9ft']; // widest table: the app clamps to the real table after loading

export function encodeState({ balls, targetId, pocket, tableId, cueId, aimDeg }) {
  const parts = [];
  for (const b of [...balls].sort((a, c) => a.id - c.id)) {
    const key = b.id === 0 ? 'c' : String(b.id);
    parts.push(`${key}=${Math.round(b.pos.x)},${Math.round(b.pos.y)}`);
  }
  if (targetId !== null && targetId !== undefined && targetId > 0) parts.push(`t=${targetId}`);
  if (pocket !== null && pocket !== undefined) parts.push(`p=${pocket}`);
  if (tableId && ID_RE.test(tableId)) parts.push(`tb=${tableId}`);
  if (cueId && ID_RE.test(cueId)) parts.push(`cu=${cueId}`);
  if (aimDeg !== null && aimDeg !== undefined && Number.isFinite(aimDeg)) parts.push(`a=${aimDeg.toFixed(1)}`);
  return parts.join(';');
}

/** Returns { balls: [{id,x,y}], targetId, pocket, tableId, cueId, aimDeg } or null when invalid/empty. */
export function decodeState(hash) {
  if (!hash) return null;
  const str = String(hash).replace(/^#/, '').trim();
  if (!str) return null;
  const balls = [];
  let targetId = null;
  let pocket = null;
  let tableId = null;
  let cueId = null;
  let aimDeg = null;
  const seen = new Set();
  for (const part of str.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = parseInt(val, 10);
      if (n >= 1 && n <= 9) targetId = n;
    } else if (key === 'a') {
      const n = Number(val);
      if (val !== '' && Number.isFinite(n)) aimDeg = Math.round((((n % 360) + 540) % 360 - 180) * 10) / 10;
    } else if (key === 'tb') {
      if (ID_RE.test(val)) tableId = val;
    } else if (key === 'cu') {
      if (ID_RE.test(val)) cueId = val;
    } else if (key === 'p') {
      const n = parseInt(val, 10);
      if (n >= 0 && n < POCKET_COUNT) pocket = n;
    } else {
      const id = key === 'c' ? 0 : parseInt(key, 10);
      if (!(id >= 0 && id <= 9) || seen.has(id)) continue;
      const [xs, ys] = val.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y) || xs === '' || ys === undefined || ys === '') continue;
      seen.add(id);
      balls.push({
        id,
        x: Math.max(R, Math.min(W - R, x)),
        y: Math.max(R, Math.min(H - R, y)),
      });
    }
  }
  if (!balls.length) return null;
  return { balls, targetId, pocket, tableId, cueId, aimDeg };
}
