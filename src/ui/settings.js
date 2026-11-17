// Equipment settings ("Thiết bị"): header chip, bottom sheet with Bàn / Gậy tabs, presets, advanced sliders,
// "Gậy của tôi" save/rename and localStorage persistence. DOM code lives here; profile maths lives in core/equipment.js.
import {
  TABLE_PRESETS,
  CUE_PRESETS,
  TABLE_FIELDS,
  CUE_FIELDS,
  SIZES,
  TIP_HARDNESS,
  TIP_HARDNESS_LABEL,
  SHAFTS,
  SHAFT_LABEL,
  DEFAULT_TABLE_ID,
  DEFAULT_CUE_ID,
  USER_CUE_DEFAULT_NAME,
  tablePreset,
  cuePreset,
  sanitizeTable,
  sanitizeCue,
  isTableId,
  isCueId,
} from '../core/equipment.js';

const STORE_KEY = 'bida9.equipment.v1';

/* ------------------------------------------------------------------ storage (guarded) */

export function loadEquipment() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveEquipment(data) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    /* storage unavailable (private mode) - ignore */
  }
}

/* ------------------------------------------------------------------ tiny DOM helpers */

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fmt = (v, d = 0) => Number(v).toFixed(d).replace('.', ',');

/* ------------------------------------------------------------------ controller */

/**
 * opts: { canChange(): boolean, blockedMsg(): string (toast when canChange() is false), onChange({table, cue}, prev), toast(msg, kind) }
 * Returns { get, ids, applyIds, open, close, setChipOverride }.
 */
export function createSettings({ canChange = () => true, blockedMsg = () => 'Đợi bi dừng rồi hãy đổi thiết bị', onChange = () => {}, toast = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const saved = loadEquipment() || {};

  let userCue = sanitizeCue({ ...cuePreset('user-cue'), ...(saved.userCue || {}), id: 'user-cue' });
  if (userCue.name === 'Fury TK-03' || (!userCue.note && userCue.name === USER_CUE_DEFAULT_NAME)) {
    if (userCue.name === 'Fury TK-03') userCue.name = USER_CUE_DEFAULT_NAME;
    userCue.note = cuePreset('user-cue').note;
  }
  // Phase 4: `ballFriction` changed from an absolute coefficient (~0.06) to a multiplier; drop legacy saved values.
  if (saved.customTable && !('ballFrictionA' in saved.customTable)) delete saved.customTable.ballFriction;
  let customTable = sanitizeTable({ ...tablePreset('custom'), ...(saved.customTable || {}), id: 'custom' });
  let tableId = isTableId(saved.tb) ? saved.tb : DEFAULT_TABLE_ID;
  let cueId = isCueId(saved.cu) ? saved.cu : DEFAULT_CUE_ID;
  if (cueId === 'user-cue' && (!saved.cu || saved.userCue?.name === 'Fury TK-03' || !saved.userCue)) {
    cueId = DEFAULT_CUE_ID;
  }
  let draft = null; // unsaved edited copy of a preset cue: { profile, baseId }
  let tab = 'table';
  let advOpen = { table: false, cue: false };
  let nameDraft = null; // text typed in the "Tên gậy" field

  const getTable = () => (tableId === 'custom' ? { ...customTable } : tablePreset(tableId));
  const getCue = () => (draft ? { ...draft.profile } : cueId === 'user-cue' ? { ...userCue } : cuePreset(cueId));
  let last = { table: getTable(), cue: getCue() };

  const chipEl = $('equipChip');
  const chipText = $('equipChipText');
  const sheet = $('sheet');
  const body = $('sheetBody');
  const hasDom = !!(chipEl && sheet && body);

  function persist() {
    saveEquipment({ tb: tableId, cu: draft ? draft.baseId : cueId, userCue, customTable });
  }

  function refreshChip() {
    if (!chipText) return;
    const t = getTable();
    const c = getCue();
    chipText.textContent = `Bàn: ${t.name} · Gậy: ${c.name}`;
    chipEl.setAttribute('aria-label', `Thiết bị. Bàn ${t.name}, gậy ${c.name}. Chạm để đổi.`);
  }

  function commit() {
    persist();
    refreshChip();
    const cur = { table: getTable(), cue: getCue() };
    const prev = last;
    last = cur;
    onChange(cur, prev);
  }

  /** Returns false (and tells the user) when equipment cannot change right now. */
  function guard() {
    if (canChange()) return true;
    toast(blockedMsg(), 'warn');
    return false;
  }

  /* -------------------------------------------------------------- mutations */

  function selectTable(id) {
    if (!guard() || !isTableId(id)) return;
    tableId = id;
    commit();
    renderCards();
    renderAdvanced();
  }

  function selectCue(id) {
    if (!guard() || !isCueId(id)) return;
    cueId = id;
    draft = null;
    nameDraft = null;
    commit();
    renderCards();
    renderAdvanced();
  }

  function editTable(key, value) {
    if (!guard()) return false;
    if (tableId !== 'custom') {
      customTable = { ...getTable(), id: 'custom', name: tablePreset('custom').name, desc: tablePreset('custom').desc };
      tableId = 'custom';
    }
    customTable = sanitizeTable({ ...customTable, [key]: value, id: 'custom' });
    commit();
    renderCards();
    return true;
  }

  /** Returns true when a draft was just created (so the action buttons must be redrawn). */
  function editCue(key, value) {
    if (!guard()) return false;
    let created = false;
    if (draft) {
      draft.profile = sanitizeCue({ ...draft.profile, [key]: value, id: 'draft' });
    } else if (cueId === 'user-cue') {
      userCue = sanitizeCue({ ...userCue, [key]: value, id: 'user-cue' });
    } else {
      const base = cuePreset(cueId);
      draft = {
        baseId: cueId,
        profile: sanitizeCue({ ...base, [key]: value, id: 'draft', name: `${base.name} (đã chỉnh)` }),
      };
      created = true;
    }
    commit();
    renderCards();
    return created;
  }

  function renameUserCue(name) {
    if (!guard()) return;
    const n = (name || '').trim() || USER_CUE_DEFAULT_NAME;
    userCue = { ...userCue, name: n, note: n === USER_CUE_DEFAULT_NAME ? cuePreset('user-cue').note : '' };
    commit();
    renderCards();
  }

  function saveAsUserCue(name) {
    if (!guard()) return;
    const src = getCue();
    const n = (name || '').trim() || USER_CUE_DEFAULT_NAME;
    userCue = sanitizeCue({
      ...src,
      id: 'user-cue',
      name: n,
      desc: cuePreset('user-cue').desc,
      note: n === USER_CUE_DEFAULT_NAME && !draft ? cuePreset('user-cue').note : '',
    });
    draft = null;
    cueId = 'user-cue';
    nameDraft = null;
    commit();
    renderCards();
    renderAdvanced();
    toast('Đã lưu thành "Gậy của tôi"', 'ok');
  }

  function resetUserCue() {
    if (!guard()) return;
    userCue = cuePreset('user-cue');
    draft = null;
    cueId = 'user-cue';
    nameDraft = null;
    commit();
    renderCards();
    renderAdvanced();
  }

  /* -------------------------------------------------------------- sheet rendering */

  let cardsEl = null;
  let advEl = null;
  let actionsEl = null;

  function slider(f, value, onInput) {
    const out = h('output', {}, fmt(value, f.digits));
    const input = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value, 'aria-label': f.label });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v, f.digits);
      onInput(v);
    });
    return h('div', { class: 'field' }, h('div', { class: 'f-top' }, h('span', {}, f.label), out), input);
  }

  function tableSpec(p) {
    return `${p.size} · miệng lỗ ${Math.round(p.cornerMouth)}/${Math.round(p.sideMouth)} mm · ma sát lăn ${fmt(p.muRoll, 3)} · băng ${fmt(p.cushionRestitution, 2)} (ước lượng)`;
  }

  function cueSpec(p) {
    return `${Math.round(p.massG)} g · squirt ${fmt(p.squirtDegPerFullSide, 1)}°/effet tối đa · trượt cơ >${fmt(p.miscueLimit, 2)} · xoáy ${fmt(p.spinEfficiency, 2)} (ước lượng)`;
  }

  function renderCards() {
    if (!cardsEl) return;
    cardsEl.replaceChildren();
    if (tab === 'table') {
      for (const base of TABLE_PRESETS) {
        const p = base.id === 'custom' ? { ...customTable, desc: base.desc, name: base.name } : base;
        cardsEl.append(
          h(
            'button',
            { type: 'button', class: 'preset', 'aria-pressed': String(base.id === tableId), onclick: () => selectTable(base.id) },
            h('span', { class: 'p-name' }, p.name),
            h('span', { class: 'p-desc' }, p.desc),
            h('span', { class: 'p-spec' }, tableSpec(p)),
          ),
        );
      }
    } else {
      for (const base of CUE_PRESETS) {
        const isUser = base.id === 'user-cue';
        const p = isUser ? userCue : base;
        const selected = !draft && base.id === cueId;
        cardsEl.append(
          h(
            'button',
            { type: 'button', class: 'preset', 'aria-pressed': String(selected), onclick: () => selectCue(base.id) },
            h('span', { class: 'p-name' }, p.name),
            h('span', { class: 'p-desc' }, isUser ? 'Gậy của tôi (sửa được)' : base.desc),
            h('span', { class: 'p-spec' }, cueSpec(p)),
            isUser && p.note ? h('span', { class: 'p-note' }, p.note) : null,
          ),
        );
      }
      if (draft) {
        cardsEl.append(
          h(
            'button',
            { type: 'button', class: 'preset', 'aria-pressed': 'true', disabled: true },
            h('span', { class: 'p-name' }, draft.profile.name),
            h('span', { class: 'p-desc' }, 'Bản chỉnh chưa lưu – bấm "Lưu thành gậy của tôi" để giữ lại'),
            h('span', { class: 'p-spec' }, cueSpec(draft.profile)),
          ),
        );
      }
    }
  }

  function renderActions() {
    if (!actionsEl) return;
    actionsEl.replaceChildren();
    const isUserSaved = !draft && cueId === 'user-cue';
    const nameVal = () => (nameDraft !== null ? nameDraft : isUserSaved ? userCue.name : '');
    if (!isUserSaved) {
      actionsEl.append(
        h('button', { type: 'button', class: 'btn primary-lite', onclick: () => saveAsUserCue(nameVal() || (draft ? draft.profile.name.replace(/ \(đã chỉnh\)$/, '') : '')) }, 'Lưu thành gậy của tôi'),
      );
    } else {
      actionsEl.append(h('button', { type: 'button', class: 'btn', onclick: resetUserCue }, `Khôi phục mặc định (${USER_CUE_DEFAULT_NAME})`));
    }
  }

  function renderAdvanced() {
    if (!advEl) return;
    advEl.replaceChildren();
    const details = h('details', { class: 'adv' }, h('summary', {}, 'Nâng cao (ước lượng)'));
    details.open = advOpen[tab];
    details.addEventListener('toggle', () => {
      advOpen[tab] = details.open;
    });
    const inner = h('div', { class: 'adv-body' });
    details.append(inner);
    if (tab === 'table') {
      const t = getTable();
      inner.append(
        h(
          'div',
          { class: 'field' },
          h('div', { class: 'f-top' }, h('span', {}, 'Kích thước bàn')),
          h(
            'div',
            { class: 'seg' },
            Object.keys(SIZES).map((s) =>
              h('button', {
                type: 'button',
                'aria-pressed': String(t.size === s),
                onclick: (e) => {
                  if (editTable('size', s)) {
                    for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
                  }
                },
              }, `${s.replace('ft', '')} ft`),
            ),
          ),
        ),
      );
      for (const f of TABLE_FIELDS) inner.append(slider(f, t[f.key], (v) => editTable(f.key, v)));
    } else {
      const c = getCue();
      const isUserSaved = !draft && cueId === 'user-cue';
      const nameInput = h('input', {
        type: 'text',
        maxlength: 40,
        value: nameDraft !== null ? nameDraft : isUserSaved ? c.name : '',
        placeholder: isUserSaved ? USER_CUE_DEFAULT_NAME : 'Tên cho "Gậy của tôi"',
        'aria-label': 'Tên gậy',
      });
      nameInput.addEventListener('input', () => {
        nameDraft = nameInput.value;
        if (!draft && cueId === 'user-cue') renameUserCue(nameInput.value);
      });
      inner.append(h('div', { class: 'field' }, h('div', { class: 'f-top' }, h('span', {}, 'Tên gậy')), nameInput));
      const sel = (key, list, labels, label) => {
        const s = h('select', { 'aria-label': label }, list.map((v) => h('option', { value: v }, labels[v])));
        s.value = c[key];
        s.addEventListener('change', () => {
          if (editCue(key, s.value)) renderActions();
        });
        return h('div', { class: 'field' }, h('div', { class: 'f-top' }, h('span', {}, label)), s);
      };
      inner.append(sel('tipHardness', TIP_HARDNESS, TIP_HARDNESS_LABEL, 'Độ cứng đầu cơ'));
      inner.append(sel('shaft', SHAFTS, SHAFT_LABEL, 'Loại ngọn'));
      for (const f of CUE_FIELDS) inner.append(slider(f, c[f.key], (v) => {
        if (editCue(f.key, v)) renderActions();
      }));
      inner.append(h('p', { class: 'sheet-note' }, 'Đường kính đầu cơ, độ cứng và loại ngọn chỉ để ghi nhớ; mô phỏng dùng khối lượng, độ nảy đầu cơ, squirt, giới hạn trượt cơ và hiệu suất xoáy.'));
      actionsEl = h('div', { class: 'sheet-actions' });
      inner.append(actionsEl);
      renderActions();
    }
    advEl.append(details);
  }

  function renderSheet() {
    if (!hasDom) return;
    $('tabTable').setAttribute('aria-selected', String(tab === 'table'));
    $('tabCue').setAttribute('aria-selected', String(tab === 'cue'));
    body.replaceChildren();
    body.append(
      h('p', { class: 'sheet-note' }, tab === 'table'
        ? 'Thông số bàn là giá trị ước lượng để luyện tập, không phải số đo thực tế.'
        : 'Thông số gậy là giá trị ước lượng để luyện tập, không phải số đo thực tế.'),
    );
    cardsEl = h('div', { class: 'presets' });
    advEl = h('div', {});
    actionsEl = null;
    body.append(cardsEl, advEl);
    renderCards();
    renderAdvanced();
    body.scrollTop = 0;
  }

  /* -------------------------------------------------------------- open / close */

  function open(which) {
    if (!hasDom) return;
    if (!canChange()) {
      toast(blockedMsg(), 'warn');
      return;
    }
    if (which === 'table' || which === 'cue') tab = which;
    sheet.hidden = false;
    renderSheet();
    $('sheetClose').focus();
  }

  function close() {
    if (!hasDom || sheet.hidden) return;
    sheet.hidden = true;
    chipEl.focus();
  }

  if (hasDom) {
    chipEl.addEventListener('click', () => open());
    $('sheetClose').addEventListener('click', close);
    $('sheetBackdrop').addEventListener('click', close);
    $('tabTable').addEventListener('click', () => {
      tab = 'table';
      renderSheet();
    });
    $('tabCue').addEventListener('click', () => {
      tab = 'cue';
      renderSheet();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    refreshChip();
  }

  return {
    /** Current { table, cue } profiles. */
    get: () => ({ table: getTable(), cue: getCue() }),
    /** Ids for the share hash (custom table / unsaved cue edits are not shareable). */
    ids: () => ({ tb: tableId === 'custom' ? null : tableId, cu: draft ? draft.baseId : cueId }),
    /** Apply ids from a share link. Unknown ids are ignored. */
    applyIds({ tb, cu } = {}) {
      let changed = false;
      if (tb && isTableId(tb) && tb !== 'custom' && tb !== tableId) {
        tableId = tb;
        changed = true;
      }
      if (cu && isCueId(cu) && (cu !== cueId || draft)) {
        cueId = cu;
        draft = null;
        changed = true;
      }
      if (changed) {
        commit();
        if (hasDom && !sheet.hidden) renderSheet();
      }
      return changed;
    },
    open,
    close,
    /** Show a fixed label on the equipment chip (online match uses fixed equipment); null restores the saved one. */
    setChipOverride(text) {
      if (!chipText) return;
      if (text) {
        chipText.textContent = text;
        chipEl.setAttribute('aria-label', text);
      } else {
        refreshChip();
      }
    },
  };
}
