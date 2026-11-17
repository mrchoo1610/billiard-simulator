// Equipment profiles: table + cue. Pure module (no DOM).
// All preset numbers are APPROXIMATIONS for training feel, not measured data ("(ước lượng)" in the UI).

/** Playing-surface sizes in mm. */
export const SIZES = {
  '7ft': { W: 1980, H: 990 },
  '8ft': { W: 2240, H: 1120 },
  '9ft': { W: 2540, H: 1270 },
};

export const BALL_MASS_G = 170;
export const STICK_MIN = 300; // mm/s at power 0
export const STICK_MAX = 9000; // mm/s at power 1
export const DEFAULT_TABLE_ID = 'club-9ft';
export const DEFAULT_CUE_ID = 'standard';
export const USER_CUE_DEFAULT_NAME = 'Gậy của tôi';
export const USER_CUE_NOTE = '';

/* ------------------------------------------------------------------ table presets */

export const TABLE_PRESETS = [
  {
    id: 'pro-9ft',
    name: 'Pro 9ft',
    desc: 'Vải nhanh, băng nảy mạnh, lỗ hẹp',
    size: '9ft',
    muSlide: 0.18,
    muRoll: 0.015,
    sideSpinDecay: 0.25,
    cushionRestitution: 0.82,
    cushionSpinTransfer: 0.22,
    cornerMouth: 114,
    sideMouth: 127,
    pocketCaptureScale: 0.85,
    ballFriction: 1,
    ballFrictionA: 0.01,
    ballFrictionB: 0.108,
    ballFrictionC: 1.088,
  },
  {
    id: 'club-9ft',
    name: 'Club 9ft',
    desc: 'Bàn câu lạc bộ tiêu chuẩn',
    size: '9ft',
    muSlide: 0.2,
    muRoll: 0.02,
    sideSpinDecay: 0.3,
    cushionRestitution: 0.75,
    cushionSpinTransfer: 0.25,
    cornerMouth: 127,
    sideMouth: 140,
    pocketCaptureScale: 0.85,
    ballFriction: 1,
    ballFrictionA: 0.01,
    ballFrictionB: 0.108,
    ballFrictionC: 1.088,
  },
  {
    id: 'bar-7ft',
    name: 'Quán 7ft',
    desc: 'Vải chậm, băng nảy yếu, lỗ rộng',
    size: '7ft',
    muSlide: 0.24,
    muRoll: 0.028,
    sideSpinDecay: 0.4,
    cushionRestitution: 0.7,
    cushionSpinTransfer: 0.28,
    cornerMouth: 140,
    sideMouth: 155,
    pocketCaptureScale: 0.85,
    ballFriction: 1,
    ballFrictionA: 0.01,
    ballFrictionB: 0.108,
    ballFrictionC: 1.088,
  },
  {
    id: 'custom',
    name: 'Tuỳ chỉnh',
    desc: 'Tự chỉnh mọi thông số (mặc định theo Club 9ft)',
    size: '9ft',
    muSlide: 0.2,
    muRoll: 0.02,
    sideSpinDecay: 0.3,
    cushionRestitution: 0.75,
    cushionSpinTransfer: 0.25,
    cornerMouth: 127,
    sideMouth: 140,
    pocketCaptureScale: 0.85,
    ballFriction: 1,
    ballFrictionA: 0.01,
    ballFrictionB: 0.108,
    ballFrictionC: 1.088,
  },
];

/* ------------------------------------------------------------------ cue presets */

export const CUE_PRESETS = [
  {
    id: 'standard',
    name: 'Gậy thường',
    desc: 'Ngọn thường',
    massG: 539,
    tipDiameterMm: 13.0,
    tipHardness: 'medium',
    shaft: 'standard',
    squirtDegPerFullSide: 3.0,
    miscueLimit: 0.55,
    spinEfficiency: 0.9,
    tipRestitution: 0.75,
  },
  {
    id: 'low-deflection',
    name: 'Ngọn LD (ít squirt)',
    desc: 'Low-deflection, squirt thấp hơn gậy thường',
    massG: 539,
    tipDiameterMm: 12.5,
    tipHardness: 'medium',
    shaft: 'low-deflection',
    squirtDegPerFullSide: 1.8,
    miscueLimit: 0.55,
    spinEfficiency: 0.92,
    tipRestitution: 0.75,
  },
  {
    id: 'carbon',
    name: 'Ngọn carbon',
    desc: 'Squirt thấp nhất, truyền xoáy tốt',
    massG: 539,
    tipDiameterMm: 12.5,
    tipHardness: 'medium',
    shaft: 'carbon',
    squirtDegPerFullSide: 1.2,
    miscueLimit: 0.55,
    spinEfficiency: 0.95,
    tipRestitution: 0.77,
  },
  {
    id: 'break',
    name: 'Gậy phá bi',
    desc: 'Nặng, đầu phenolic, truyền xoáy kém, dễ trượt cơ',
    massG: 595,
    tipDiameterMm: 13.0,
    tipHardness: 'phenolic',
    shaft: 'standard',
    squirtDegPerFullSide: 3.5,
    miscueLimit: 0.45,
    spinEfficiency: 0.6,
    tipRestitution: 0.85,
  },
  {
    id: 'user-cue',
    name: USER_CUE_DEFAULT_NAME,
    desc: 'Gậy của tôi (sửa được)',
    note: USER_CUE_NOTE,
    massG: 539,
    tipDiameterMm: 12.5,
    tipHardness: 'medium',
    shaft: 'low-deflection',
    squirtDegPerFullSide: 1.8,
    miscueLimit: 0.55,
    spinEfficiency: 0.92,
    tipRestitution: 0.75,
  },
];

export const TIP_HARDNESS = ['soft', 'medium', 'hard', 'phenolic'];
export const TIP_HARDNESS_LABEL = { soft: 'Mềm', medium: 'Vừa', hard: 'Cứng', phenolic: 'Phenolic' };
export const SHAFTS = ['standard', 'low-deflection', 'carbon'];
export const SHAFT_LABEL = { standard: 'Thường', 'low-deflection': 'Low-deflection', carbon: 'Carbon' };

/* ------------------------------------------------------------------ field metadata (for sliders + clamping) */

export const TABLE_FIELDS = [
  { key: 'muSlide', label: 'Ma sát trượt (bi–vải)', min: 0.1, max: 0.35, step: 0.005, digits: 3 },
  { key: 'muRoll', label: 'Ma sát lăn', min: 0.004, max: 0.03, step: 0.001, digits: 3 },
  { key: 'sideSpinDecay', label: 'Tắt effet (1/s)', min: 0.05, max: 1, step: 0.05, digits: 2 },
  { key: 'cushionRestitution', label: 'Độ nảy băng', min: 0.6, max: 0.9, step: 0.01, digits: 2 },
  { key: 'cushionSpinTransfer', label: 'Ma sát băng (effet đổi góc, ăn tốc độ dọc băng)', min: 0, max: 0.4, step: 0.01, digits: 2 },
  { key: 'cornerMouth', label: 'Miệng lỗ góc (mm)', min: 100, max: 160, step: 1, digits: 0 },
  { key: 'sideMouth', label: 'Miệng lỗ giữa (mm)', min: 110, max: 180, step: 1, digits: 0 },
  { key: 'pocketCaptureScale', label: 'Hệ số hút lỗ', min: 0.6, max: 1, step: 0.05, digits: 2 },
  { key: 'ballFriction', label: 'Ma sát bi–bi (throw, hệ số nhân)', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'ballFrictionA', label: 'Ma sát bi–bi: a (tốc độ lớn)', min: 0, max: 0.05, step: 0.005, digits: 3 },
  { key: 'ballFrictionB', label: 'Ma sát bi–bi: b (thêm khi chậm)', min: 0, max: 0.3, step: 0.005, digits: 3 },
  { key: 'ballFrictionC', label: 'Ma sát bi–bi: c (s/m)', min: 0.2, max: 3, step: 0.05, digits: 2 },
];

export const CUE_FIELDS = [
  { key: 'massG', label: 'Khối lượng (g)', min: 450, max: 700, step: 1, digits: 0 },
  { key: 'tipDiameterMm', label: 'Đường kính đầu cơ (mm)', min: 9, max: 14.5, step: 0.5, digits: 1 },
  { key: 'squirtDegPerFullSide', label: 'Squirt (°/effet tối đa)', min: 0, max: 5, step: 0.1, digits: 1 },
  { key: 'miscueLimit', label: 'Giới hạn trượt cơ', min: 0.3, max: 0.8, step: 0.01, digits: 2 },
  { key: 'spinEfficiency', label: 'Hiệu suất truyền xoáy', min: 0.5, max: 1, step: 0.01, digits: 2 },
  { key: 'tipRestitution', label: 'Độ nảy đầu cơ', min: 0.5, max: 0.95, step: 0.01, digits: 2 },
];

/* ------------------------------------------------------------------ helpers */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const copy = (o) => ({ ...o });
const find = (list, id) => list.find((p) => p.id === id);

export const tablePreset = (id) => copy(find(TABLE_PRESETS, id) || find(TABLE_PRESETS, DEFAULT_TABLE_ID));
export const cuePreset = (id) => copy(find(CUE_PRESETS, id) || find(CUE_PRESETS, DEFAULT_CUE_ID));
export const defaultTable = () => tablePreset(DEFAULT_TABLE_ID);
export const defaultCue = () => cuePreset(DEFAULT_CUE_ID);
export const isTableId = (id) => !!find(TABLE_PRESETS, id);
export const isCueId = (id) => !!find(CUE_PRESETS, id);

export function tableDims(profile) {
  return SIZES[profile && profile.size] || SIZES['9ft'];
}

function sanitize(p, base, fields) {
  const out = { ...base };
  if (p && typeof p === 'object') {
    if (typeof p.id === 'string' && p.id) out.id = p.id.slice(0, 32);
    if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 40);
    if (typeof p.note === 'string') out.note = p.note.slice(0, 120);
    for (const f of fields) {
      const n = Number(p[f.key]);
      if (Number.isFinite(n)) out[f.key] = clamp(n, f.min, f.max);
    }
  }
  return out;
}

export function sanitizeTable(p) {
  const out = sanitize(p, tablePreset('custom'), TABLE_FIELDS);
  out.size = p && SIZES[p.size] ? p.size : '9ft';
  return out;
}

export function sanitizeCue(p) {
  const out = sanitize(p, cuePreset('user-cue'), CUE_FIELDS);
  out.tipHardness = p && TIP_HARDNESS.includes(p.tipHardness) ? p.tipHardness : 'medium';
  out.shaft = p && SHAFTS.includes(p.shaft) ? p.shaft : 'standard';
  return out;
}

/** Cache key covering only fields that affect physics simulation or 3D table/tip geometry. */
export function physicsEquipmentKey(eq) {
  const t = eq && eq.table ? eq.table : {};
  const c = eq && eq.cue ? eq.cue : {};
  return JSON.stringify([
    t.size,
    ...TABLE_FIELDS.map((f) => t[f.key]),
    ...CUE_FIELDS.map((f) => c[f.key]),
  ]);
}

export function cueVisualStyle(cue) {
  const c = cue || {};
  const id = c.id || 'user-cue';
  const shaft = SHAFTS.includes(c.shaft) ? c.shaft : 'standard';
  const hardness = TIP_HARDNESS.includes(c.tipHardness) ? c.tipHardness : 'medium';
  const tipDiameterMm = clamp(Number(c.tipDiameterMm) || 12.5, 9, 14.5);
  const heavyBreak = id === 'break' || (Number(c.massG) || 539) >= 575;

  const butts = {
    standard: {
      collar: '#d4af37',
      forearm: '#5e2e14',
      wrap: '#261811',
      butt: '#4b230f',
      cap: '#ece6d6',
    },
    'low-deflection': {
      collar: '#c2cbd4',
      forearm: '#15443a',
      wrap: '#161b1e',
      butt: '#0e2d26',
      cap: '#dce2e8',
    },
    carbon: {
      collar: '#7d8590',
      forearm: '#23272e',
      wrap: '#101215',
      butt: '#d62828',
      cap: '#1b1e23',
    },
    break: {
      collar: '#f59e0b',
      forearm: '#8b1e1a',
      wrap: '#141416',
      butt: '#231919',
      cap: '#f59e0b',
    },
    'user-cue': {
      collar: '#d9b44a',
      forearm: '#191c20',
      wrap: '#111214',
      butt: '#20262e',
      cap: '#d9b44a',
    },
  };
  const b = butts[id] || butts['user-cue'];

  const tipColors = {
    soft: { c2d: '#38bdf8', c3d: '#2884d6', rough: 0.92 },
    medium: { c2d: '#4fc3f7', c3d: '#2f6fb8', rough: 0.88 },
    hard: { c2d: '#1d70b8', c3d: '#1c4d82', rough: 0.78 },
    phenolic: { c2d: '#e66424', c3d: '#c44d19', rough: 0.28 },
  };
  const tip = tipColors[hardness];

  const shaftColors = {
    standard: { color: heavyBreak ? '#c98c4e' : '#e5c17b', rough: 0.48 },
    'low-deflection': { color: id === 'user-cue' ? '#ebd69e' : '#f1e1b8', rough: 0.44 },
    carbon: { color: '#22262c', rough: 0.34 },
  };
  const sh = shaftColors[shaft];

  const ferruleColor = hardness === 'phenolic' || id === 'break'
    ? '#17181b'
    : shaft === 'carbon'
      ? '#f7f8fa'
      : '#f3efe2';
  const ferruleLenMm = shaft === 'low-deflection' || shaft === 'carbon' ? 16 : 24;
  const profileScale = heavyBreak ? 1.13 : shaft === 'carbon' ? 0.96 : 1;

  const key = [id, shaft, hardness, tipDiameterMm.toFixed(1), profileScale.toFixed(2)].join('|');
  return {
    key,
    id,
    shaft,
    hardness,
    tipDiameterMm,
    tipLenMm: 8,
    ferruleLenMm,
    profileScale,
    tipColor2d: tip.c2d,
    tipColor3d: tip.c3d,
    tipRough: tip.rough,
    ferruleColor,
    shaftColor: sh.color,
    shaftRough: sh.rough,
    collarColor: b.collar,
    forearmColor: b.forearm,
    wrapColor: b.wrap,
    buttColor: b.butt,
    capColor: b.cap,
  };
}

/**
 * Cue stick speed (mm/s) for a power slider value 0..1.
 * Non-linear (power^POWER_CURVE) so most of the slider covers ordinary shot speeds (~0.5-4 m/s ball speed)
 * and only the top end reaches break speed. [Unverified] typical speeds: soft <1, medium 1.5-3, firm 4-6, break 8-12 m/s.
 */
export const POWER_CURVE = 1.7;
export const stickSpeed = (power) => STICK_MIN + Math.pow(clamp(power, 0, 1), POWER_CURVE) * (STICK_MAX - STICK_MIN);

/** Cue-ball speed after the tip hit: v = (1 + e_tip) * m_cue / (m_cue + m_ball) * v_stick. */
export function ballSpeed(cue, vStick) {
  return ((1 + cue.tipRestitution) * cue.massG) / (cue.massG + BALL_MASS_G) * vStick;
}

/** Signed squirt rotation (deg) applied to the launch direction for a tip offset x. Right english -> negative. */
export const squirtDeg = (cue, tipX) => -cue.squirtDegPerFullSide * clamp(tipX, -1, 1);

/** Inverse of stickSpeed: power slider value (0..1) that gives stick speed `v` (mm/s). */
export const powerForStick = (v) => Math.pow(clamp((v - STICK_MIN) / (STICK_MAX - STICK_MIN), 0, 1), 1 / POWER_CURVE);
