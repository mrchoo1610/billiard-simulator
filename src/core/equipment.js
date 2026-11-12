// Equipment profiles: table + cue. Pure module (no DOM).
// All preset numbers are APPROXIMATIONS for training feel, not measured data ("(ước lượng)" in the UI).

/** Playing-surface sizes in mm. */
export const SIZES = {
  '7ft': { W: 1980, H: 990 },
  '8ft': { W: 2240, H: 1120 },
  '9ft': { W: 2540, H: 1270 },
};

export const BALL_MASS_G = 170;
export const STICK_MIN = 500; // mm/s at power 0
export const STICK_MAX = 9000; // mm/s at power 1
export const DEFAULT_TABLE_ID = 'club-9ft';
export const DEFAULT_CUE_ID = 'user-cue';
export const USER_CUE_DEFAULT_NAME = 'Fury TK-03';
export const USER_CUE_NOTE = 'Thông số lấy từ cửa hàng bán lẻ, chưa xác minh với hãng';

/* ------------------------------------------------------------------ table presets */

export const TABLE_PRESETS = [
  {
    id: 'pro-9ft',
    name: 'Pro 9ft',
    desc: 'Vải nhanh, băng nảy mạnh, lỗ hẹp',
    size: '9ft',
    muSlide: 0.18,
    muRoll: 0.008,
    sideSpinDecay: 0.25,
    cushionRestitution: 0.82,
    cushionSpinTransfer: 0.3,
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
    muRoll: 0.01,
    sideSpinDecay: 0.3,
    cushionRestitution: 0.75,
    cushionSpinTransfer: 0.3,
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
    muSlide: 0.22,
    muRoll: 0.015,
    sideSpinDecay: 0.4,
    cushionRestitution: 0.7,
    cushionSpinTransfer: 0.3,
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
    muRoll: 0.01,
    sideSpinDecay: 0.3,
    cushionRestitution: 0.75,
    cushionSpinTransfer: 0.3,
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
  { key: 'cushionSpinTransfer', label: 'Effet đổi góc nảy', min: 0, max: 0.6, step: 0.05, digits: 2 },
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

/** Cue stick speed (mm/s) for a power slider value 0..1. */
export const stickSpeed = (power) => STICK_MIN + clamp(power, 0, 1) * (STICK_MAX - STICK_MIN);

/** Cue-ball speed after the tip hit: v = (1 + e_tip) * m_cue / (m_cue + m_ball) * v_stick. */
export function ballSpeed(cue, vStick) {
  return ((1 + cue.tipRestitution) * cue.massG) / (cue.massG + BALL_MASS_G) * vStick;
}

/** Signed squirt rotation (deg) applied to the launch direction for a tip offset x. Right english -> negative. */
export const squirtDeg = (cue, tipX) => -cue.squirtDegPerFullSide * clamp(tipX, -1, 1);
