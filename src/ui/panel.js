// Control panel DOM: info rows, sliders, spin pad, ball tray, drill panels, toasts.
// No app state lives here; app.js passes state in and receives events through `handlers`.
import { createSpinPad } from './input.js';
import { BALL_COLORS } from './render.js';
import { FULLNESS_LABELS } from '../core/geometry.js';
import { BOT_DIFFICULTIES, BOT_GAMES, loadHeroProfile } from '../features/bot.js';

const $ = (id) => document.getElementById(id);
export const fmtDeg = (d, digits = 1) => `${Number(d).toFixed(digits).replace('.', ',')}°`;

export const fmtSigned = (d, digits = 1) => `${d < 0 ? '−' : '+'}${Math.abs(Number(d)).toFixed(digits).replace('.', ',')}°`;

export function tipText(t) {
  const parts = [];
  if (Math.abs(t.y) > 0.05) parts.push(`${t.y > 0 ? 'Cao' : 'Thấp'} ${Math.round(Math.abs(t.y) * 100)}%`);
  if (Math.abs(t.x) > 0.05) parts.push(`${t.x > 0 ? 'Phải' : 'Trái'} ${Math.round(Math.abs(t.x) * 100)}%`);
  return parts.length ? parts.join(' · ') : 'Giữa (bi dừng)';
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/**
 * handlers: { onPower(p 0..1), onAim(deg), onTip(tip), onNudge(deltaDeg), onAimMode(), onShoot, onReset, onRandom, onRack, onShare,
 *   onOverlay(key, on), onMode(mode), onThickPick(label), onNextThick, onNextPos, onHint,
 *   onNextSquirt, onHintSquirt, onToggleBall(id), onPanelToggle }
 */
export function createPanel(h) {
  const spinPad = createSpinPad($('spin'), (tip) => {
    $('spinLabel').textContent = tipText(tip);
    h.onTip(tip);
  });

  $('power').addEventListener('input', (e) => {
    $('powerVal').textContent = `${e.target.value}%`;
    h.onPower(Number(e.target.value) / 100);
  });
  $('aimOffset').addEventListener('input', (e) => {
    $('aimOffsetVal').textContent = fmtDeg(Number(e.target.value));
    h.onAim(Number(e.target.value));
  });
  $('elevation').addEventListener('input', (e) => {
    $('elevationVal').textContent = `${e.target.value}°`;
    h.onElevation(Number(e.target.value));
  });
  $('chkComp').addEventListener('change', (e) => h.onComp(e.target.checked));
  $('btnShoot').addEventListener('click', () => h.onShoot());
  $('btnReset').addEventListener('click', () => h.onReset());
  $('btnRandom').addEventListener('click', () => h.onRandom());
  $('btnRack').addEventListener('click', () => h.onRack());
  $('btnShare').addEventListener('click', () => h.onShare());
  $('btnNextThick').addEventListener('click', () => h.onNextThick());
  $('btnNextPos').addEventListener('click', () => h.onNextPos());
  $('btnHint').addEventListener('click', () => h.onHint());
  $('btnNextSquirt').addEventListener('click', () => h.onNextSquirt());
  $('btnHintSquirt').addEventListener('click', () => h.onHintSquirt());

  // aim fine-tune buttons: tap = one step, hold = repeat
  for (const btn of document.querySelectorAll('[data-nudge]')) {
    const step = Number(btn.dataset.nudge);
    let delay = 0;
    let rep = 0;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(rep);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      stop();
      h.onNudge(step);
      delay = setTimeout(() => {
        rep = setInterval(() => h.onNudge(step), 70);
      }, 400);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) h.onNudge(step); // keyboard activation
    });
  }
  $('btnAimMode').addEventListener('click', () => h.onAimMode());

  for (const cb of document.querySelectorAll('[data-ov]')) {
    cb.addEventListener('change', () => h.onOverlay(cb.dataset.ov, cb.checked));
  }
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => h.onMode(b.dataset.mode));
  for (const b of document.querySelectorAll('#mainModes button')) {
    b.addEventListener('click', () => h.onAppMode?.(b.dataset.app));
  }

  const syncLobbyDesc = (diff) => {
    if (diff === 'hero') {
      const hero = loadHeroProfile();
      if ($('lobbyDiffDesc')) {
        $('lobbyDiffDesc').textContent = `🌟 Hero Cấp ${hero.level || 13} (${Math.round(hero.xp || 22000).toLocaleString('vi-VN')} XP) · Lệch ngắm: ${(hero.aimJitterDeg || 0.06).toFixed(2)}° · Skills: 🦘 Nhảy bi | 🌀 Massé`;
      }
      return;
    }
    const info = BOT_DIFFICULTIES[diff] || BOT_DIFFICULTIES.medium;
    if ($('lobbyDiffDesc')) $('lobbyDiffDesc').textContent = info.desc;
  };
  let lobbyDiff = $('botDiff') ? $('botDiff').value : 'medium';
  let lobbyGame = $('botGame') ? $('botGame').value : '9ball';
  syncLobbyDesc(lobbyDiff);
  for (const b of document.querySelectorAll('#lobbyGame button')) {
    b.addEventListener('click', () => {
      lobbyGame = b.dataset.game;
      for (const x of document.querySelectorAll('#lobbyGame button')) {
        x.classList.toggle('active', x.dataset.game === lobbyGame);
      }
      if ($('botGame')) $('botGame').value = lobbyGame;
    });
  }
  for (const b of document.querySelectorAll('#lobbyDiff button')) {
    b.addEventListener('click', () => {
      lobbyDiff = b.dataset.diff;
      for (const x of document.querySelectorAll('#lobbyDiff button')) {
        x.classList.toggle('active', x.dataset.diff === lobbyDiff);
      }
      if ($('botDiff')) $('botDiff').value = lobbyDiff;
      syncLobbyDesc(lobbyDiff);
    });
  }
  let lobbyBvbGame = '9ball';
  for (const b of document.querySelectorAll('#lobbyBvbGame button')) {
    b.addEventListener('click', () => {
      lobbyBvbGame = b.dataset.game;
      for (const x of document.querySelectorAll('#lobbyBvbGame button')) {
        x.classList.toggle('active', x.dataset.game === lobbyBvbGame);
      }
    });
  }
  $('btnStartBot')?.addEventListener('click', () => {
    const raceTo = parseInt($('lobbyBotRace')?.value || '5', 10);
    h.onStartBot?.(lobbyDiff, lobbyGame, raceTo);
  });
  $('btnStartBvb')?.addEventListener('click', () => {
    const name1 = $('bvbName1')?.value?.trim() || 'Alpha';
    const name2 = $('bvbName2')?.value?.trim() || 'Beta';
    const diff1 = $('bvbDiff1')?.value || 'hard';
    const diff2 = $('bvbDiff2')?.value || 'pro';
    const raceTo = parseInt($('lobbyBvbRace')?.value || '5', 10);
    h.onStartBvb?.({ name1, name2, diff1, diff2, game: lobbyBvbGame, raceTo });
  });
  $('lobbyBvbAimAid')?.addEventListener('change', () => h.onToggleAimAid?.());
  $('lobbyBotAimAid')?.addEventListener('change', () => h.onToggleAimAid?.());
  $('btnStartPractice')?.addEventListener('click', () => h.onStartPractice?.());
  $('botDiff')?.addEventListener('change', (e) => h.onBotDifficulty?.(e.target.value));
  $('botRace')?.addEventListener('change', (e) => {
    const raceTo = parseInt(e.target.value || '0', 10);
    h.onBotRace?.(raceTo);
  });
  $('botGame')?.addEventListener('change', (e) => h.onBotGame?.(e.target.value));
  $('btnNewMatch')?.addEventListener('click', () => h.onNewMatch?.());

  // Match Win Celebration controls
  $('btnMatchWinRematch')?.addEventListener('click', () => {
    setMatchWin(false);
    h.onNewMatch?.();
  });
  $('btnMatchWinKeepPlaying')?.addEventListener('click', () => {
    setMatchWin(false);
    h.onKeepPlaying?.();
  });
  $('btnMatchWinLobby')?.addEventListener('click', () => {
    setMatchWin(false);
    setLobbyOpen(true);
  });

  // BvB in-game controls
  $('btnBvbPause')?.addEventListener('click', () => h.onBvbPause?.());
  $('btnBvbSpeed')?.addEventListener('click', () => h.onBvbSpeed?.());
  $('btnBvbCam')?.addEventListener('click', () => h.onCycleCam?.());
  $('btnBvbAimAid')?.addEventListener('click', () => h.onToggleAimAid?.());

  const openRename = () => {
    const modal = $('renameModal');
    if (!modal) return;
    if ($('renameInput1')) $('renameInput1').value = currentBot1Name;
    if ($('renameInput2')) $('renameInput2').value = currentBot2Name;
    modal.hidden = false;
    $('renameInput1')?.focus();
  };
  const closeRename = () => {
    const modal = $('renameModal');
    if (modal) modal.hidden = true;
  };
  $('btnBvbRename')?.addEventListener('click', openRename);
  $('botName1')?.addEventListener('click', openRename);
  $('botName2')?.addEventListener('click', openRename);
  $('btnCancelRename')?.addEventListener('click', closeRename);
  $('btnSaveRename')?.addEventListener('click', () => {
    const name1 = $('renameInput1')?.value?.trim() || 'Alpha';
    const name2 = $('renameInput2')?.value?.trim() || 'Beta';
    closeRename();
    h.onBvbRename?.({ name1, name2 });
  });

  // thickness choices
  for (const label of FULLNESS_LABELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.dataset.label = label;
    b.addEventListener('click', () => h.onThickPick(label));
    $('thickChoices').appendChild(b);
  }

  // panel toggle (phones)
  $('panelToggle').addEventListener('click', () => {
    const open = !$('panel').classList.contains('open');
    $('panel').classList.toggle('open', open);
    $('panelToggle').setAttribute('aria-expanded', String(open));
    $('panelToggleText').textContent = open ? 'Đóng bảng điều khiển' : 'Mở bảng điều khiển';
    h.onPanelToggle();
  });

  function refreshTray(has) {
    const tray = $('tray');
    if (!tray.children.length) {
      for (let id = 1; id <= 9; id++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = String(id);
        b.dataset.id = String(id);
        b.style.background = id === 9 ? 'linear-gradient(#f7f6ef 0 25%, #f4c20d 25% 75%, #f7f6ef 75%)' : BALL_COLORS[id];
        if (id === 9) b.style.color = '#222';
        b.setAttribute('aria-label', `Bi ${id}`);
        b.addEventListener('click', () => h.onToggleBall(id));
        tray.appendChild(b);
      }
    }
    for (const b of tray.children) b.setAttribute('aria-pressed', String(!!has(Number(b.dataset.id))));
  }

  const speedText = (mps) => `${mps.toFixed(1).replace('.', ',')} m/s`;

  /**
   * info: aim data or null. opts: { hideAnswer, launch: {speed (mm/s), squirtDeg (signed), miscue}, tip, aimOffset }
   */
  function updateInfo(info, opts = {}) {
    const ids = ['infoCut', 'infoFull', 'infoDistCue', 'infoDistPocket'];
    const warn = $('infoWarn');
    const hideAnswer = !!opts.hideAnswer;
    const launch = opts.launch;
    $('infoSpeed').textContent = launch ? speedText(launch.speed / 1000) : '–';
    const showSquirt = !!launch && !launch.miscue && Math.abs(opts.tipX || 0) > 0.02;
    // Row is always shown (value '–' when not applicable) so the panel height never jumps.
    updateComp(opts.comp);
    if (!showSquirt) $('infoSquirt').textContent = '–';
    if (showSquirt) {
      const deg = Math.abs(launch.squirtDeg);
      // right english pushes the ball left, so compensate by aiming to the right (and vice versa)
      const dir = launch.squirtDeg < 0 ? 'ngắm lệch phải' : 'ngắm lệch trái';
      $('infoSquirt').textContent = opts.hideSquirtValue ? '?' : `${fmtDeg(deg)} (${dir})`;
    }
    if (!info || hideAnswer || (info.manual && !info.hit)) {
      for (const id of ids) $(id).textContent = hideAnswer && info ? '?' : '–';
      if (info && hideAnswer) {
        $('infoDistCue').textContent = `${(info.distCue / 10).toFixed(0)} cm`;
        $('infoDistPocket').textContent = `${(info.distPocket / 10).toFixed(0)} cm`;
      }
      const msgs0 = [];
      if (info && info.manual && !info.hit && !hideAnswer) msgs0.push('Không chạm bi nào');
      if (launch && launch.miscue) msgs0.push('Điểm chạm vượt giới hạn của gậy – sẽ trượt cơ (miscue)');
      setWarn(warn, msgs0);
      return;
    }
    $('infoCut').textContent = fmtDeg(info.cutAngleDeg);
    $('infoFull').textContent = `${info.fullnessLabel} (${Math.round(info.fullness * 100)}%)`;
    $('infoDistCue').textContent = `${(info.distCue / 10).toFixed(0)} cm`;
    $('infoDistPocket').textContent = info.distPocket === null ? '–' : `${(info.distPocket / 10).toFixed(0)} cm`;
    const msgs = [];
    if (info.manual) msgs.push(`Chạm bi ${info.objId} trước`);
    if (info.blockedCue !== null) msgs.push(`Đường ngắm bị bi ${info.blockedCue} chặn`);
    if (info.blockedObj !== null) msgs.push(`Đường vào lỗ bị bi ${info.blockedObj} chặn`);
    if (!info.manual && !info.possible) msgs.push('Góc cắt quá lớn – không thể vào lỗ này');
    if (launch && launch.miscue) msgs.push('Điểm chạm vượt giới hạn của gậy – sẽ trượt cơ (miscue)');
    setWarn(warn, msgs);
  }

  // Rows are always present ('–' when not applicable) so the panel never changes height.
  function updateComp(c) {
    const comp = $('infoComp');
    const parts = $('infoParts');
    const thr = $('infoThrow');
    if (!c || !c.enabled) {
      comp.textContent = '–';
      parts.textContent = '–';
      thr.textContent = '–';
      return;
    }
    if (!c.result || !c.result.ok) {
      comp.textContent = !c.result ? '…' : c.result.reason === 'miscue' ? 'Trượt cơ' : 'Không giải được';
      parts.textContent = '–';
      thr.textContent = '–';
      return;
    }
    const r = c.result;
    comp.textContent = `${fmtDeg(Math.abs(r.correctionDeg), 2)} ${r.correctionDeg >= 0 ? 'phải' : 'trái'}`;
    // cue-ball deviation (squirt · swerve) and object-ball throw are shown apart; the aim correction above is the combined result
    parts.textContent = `${fmtSigned(r.parts.squirt)} · ${fmtSigned(r.parts.swerve)}`;
    thr.textContent = fmtSigned(r.parts.throw);
  }

  // The warning slot keeps a reserved height; toggling content must not shift the layout.
  function setWarn(el, msgs) {
    el.classList.toggle('empty', msgs.length === 0);
    el.textContent = msgs.length ? msgs.join('. ') : ' ';
  }

  function syncControls({ power, aimOffset, tip, elevation, comp, elevationLocked, compLocked, tipLocked }) {
    $('elevation').value = elevation;
    $('elevationVal').textContent = `${Math.round(elevation)}°`;
    $('elevation').disabled = !!elevationLocked;
    $('chkComp').checked = !!comp;
    $('chkComp').disabled = !!compLocked;
    spinPad.setLocked(!!tipLocked);
    $('power').value = Math.round(power * 100);
    $('powerVal').textContent = `${Math.round(power * 100)}%`;
    $('aimOffset').value = aimOffset;
    $('aimOffsetVal').textContent = fmtDeg(aimOffset);
    $('spinLabel').textContent = tipText(tip);
  }

  function updateStats(stats) {
    const t = stats.thickness;
    const pct = t.rounds ? Math.round((100 * t.correct) / t.rounds) : 0;
    $('thickStats').textContent = `Đúng ${t.correct}/${t.rounds} (${pct}%) · Chuỗi ${t.streak} · Tốt nhất ${t.best}`;
    const p = stats.position;
    $('posStats').textContent = `Thành công ${p.success}/${p.attempts} · Chuỗi ${p.streak} · Tốt nhất ${p.best}`;
    const q = stats.squirt;
    $('squirtStats').textContent = `Vào lỗ ${q.success}/${q.attempts} · Chuỗi ${q.streak} · Tốt nhất ${q.best}`;
  }

  function setActiveTab(mode) {
    document.body.dataset.mode = mode;
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.mode === mode);
  }

  function setAppMode(appMode) {
    document.body.dataset.app = appMode === 'hero' ? 'bot' : appMode;
    for (const b of document.querySelectorAll('#mainModes button')) {
      b.classList.toggle('active', b.dataset.app === appMode);
    }
  }

  function setLobbyOpen(open) {
    const el = $('lobby');
    if (el) el.hidden = !open;
  }

  function setMatchWin(show, details = {}) {
    const el = $('matchWinModal');
    if (!el) return;
    el.hidden = !show;
    if (show) {
      if (details.title && $('matchWinTitle')) $('matchWinTitle').textContent = details.title;
      if (details.desc && $('matchWinDesc')) $('matchWinDesc').textContent = details.desc;
      if (details.name1 && $('winName1')) $('winName1').textContent = details.name1;
      if (details.name2 && $('winName2')) $('winName2').textContent = details.name2;
      if (details.score1 !== undefined && $('winScore1')) $('winScore1').textContent = String(details.score1);
      if (details.score2 !== undefined && $('winScore2')) $('winScore2').textContent = String(details.score2);
    }
  }

  let currentBot1Name = 'Alpha';
  let currentBot2Name = 'Beta';
  function setBotHud({
    matchType = 'pve',
    bot1Name = 'Bạn',
    bot2Name = 'Bot',
    bot1Diff,
    bot2Diff,
    paused = false,
    speed = 1,
    scorePlayer,
    scoreBot,
    raceTo = 0,
    turn,
    game = '9ball',
    difficulty,
    targetId,
    targetLabel,
    statusText,
    isFoul,
    thinking,
  }) {
    currentBot1Name = bot1Name;
    currentBot2Name = bot2Name;
    if ($('botScorePlayer')) $('botScorePlayer').textContent = String(scorePlayer);
    if ($('botScoreBot')) $('botScoreBot').textContent = String(scoreBot);
    if ($('botGame') && game) $('botGame').value = game;
    if ($('botDiff') && difficulty) $('botDiff').value = difficulty;
    if ($('botRace') && raceTo !== undefined) $('botRace').value = String(raceTo || 0);
    if ($('botRacePill')) $('botRacePill').textContent = raceTo > 0 ? `Chạm ${raceTo}` : 'Tự do';

    const isBvb = matchType === 'bvb';
    const gameLabel = (BOT_GAMES[game] || BOT_GAMES['9ball']).label;
    const hero = loadHeroProfile();
    const heroLabel = (d, name) => {
      if (d?.id === 'hero' || (name && name.toLowerCase().includes('hero'))) {
        return `Hero Lvl ${hero.level || 13} · ${(hero.aimJitterDeg || 0.06).toFixed(2)}°`;
      }
      return d?.shortLabel || d?.label || '';
    };

    if ($('bvbControls')) $('bvbControls').hidden = !isBvb;
    if ($('botDiffWrap')) $('botDiffWrap').hidden = isBvb;

    if (isBvb) {
      const d1 = BOT_DIFFICULTIES[bot1Diff] || BOT_DIFFICULTIES.hard;
      const d2 = BOT_DIFFICULTIES[bot2Diff] || BOT_DIFFICULTIES.pro;
      if ($('botName1')) {
        $('botName1').textContent = `${bot1Name} (${heroLabel(d1, bot1Name)})`;
        $('botName1').classList.add('editable-name');
      }
      if ($('botName2')) {
        $('botName2').textContent = `${bot2Name} (${heroLabel(d2, bot2Name)})`;
        $('botName2').classList.add('editable-name');
      }
      const isShooter1 = turn === 'bot1' || turn === 'player';
      $('botName1')?.parentElement?.classList.toggle('is-shooting', isShooter1);
      $('botName2')?.parentElement?.classList.toggle('is-shooting', !isShooter1);
      const tp = $('botTurnPill');
      if (tp) {
        const currentShooter = turn === 'bot1' ? bot1Name : bot2Name;
        tp.textContent = thinking ? `🤖 ${currentShooter} đang ngắm...` : `🤖 Lượt ${currentShooter}`;
        tp.className = `pill ${isFoul ? 'is-foul' : 'is-bot-turn'}`.trim();
      }
      if ($('btnBvbPause')) {
        $('btnBvbPause').textContent = paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
      }
      if ($('btnBvbSpeed')) {
        $('btnBvbSpeed').textContent = speed === 4 ? '⚡ 4x' : speed === 2 ? '⚡ 2x' : '⚡ 1x';
      }
    } else {
      const diffInfo = BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium;
      if ($('botName1')) {
        $('botName1').textContent = 'Bạn';
        $('botName1').classList.remove('editable-name');
      }
      if ($('botName2')) {
        $('botName2').textContent = `Bot ${gameLabel} (${heroLabel(diffInfo, 'bot')})`;
        $('botName2').classList.remove('editable-name');
      }
      const isShooter1 = turn === 'player';
      $('botName1')?.parentElement?.classList.toggle('is-shooting', isShooter1);
      $('botName2')?.parentElement?.classList.toggle('is-shooting', !isShooter1);
      const tp = $('botTurnPill');
      if (tp) {
        tp.textContent = turn === 'bot' ? (thinking ? '🤖 Bot đang ngắm...' : '🤖 Lượt Bot') : 'Lượt bạn';
        tp.className = `pill ${turn === 'bot' ? 'is-bot-turn' : isFoul ? 'is-foul' : ''}`.trim();
      }
    }

    if ($('lobbyDiffDesc')) {
      if (difficulty === 'hero') {
        $('lobbyDiffDesc').textContent = `🌟 Hero Cấp ${hero.level || 13} (${Math.round(hero.xp || 22000).toLocaleString('vi-VN')} XP) · Lệch ngắm: ${(hero.aimJitterDeg || 0.06).toFixed(2)}° · Skills: 🦘 Nhảy bi | 🌀 Massé`;
      } else {
        const diffInfo = BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium;
        $('lobbyDiffDesc').textContent = diffInfo.desc;
      }
    }
    if ($('botTargetPill')) {
      $('botTargetPill').textContent = targetLabel || (targetId ? `Bi #${targetId}` : 'Hết bi');
    }
    if ($('botStatusText')) $('botStatusText').textContent = statusText || '';
    for (const b of document.querySelectorAll('#lobbyGame button')) {
      b.classList.toggle('active', b.dataset.game === game);
    }
    for (const b of document.querySelectorAll('#lobbyDiff button')) {
      b.classList.toggle('active', b.dataset.diff === difficulty);
    }
  }

  function resetThickness() {
    $('thickResult').textContent = '';
    $('btnNextThick').disabled = true;
    for (const b of $('thickChoices').children) {
      b.className = 'btn';
      b.disabled = false;
    }
  }

  function showThickAnswer(res, label) {
    const cut = res.cutAngleDeg.toFixed(1).replace('.', ',');
    $('thickResult').textContent = res.correct
      ? `Đúng! Độ dày ${res.truth} (${res.fullnessPct}%), góc cắt ${cut}°`
      : `Sai. Đáp án: ${res.truth} (${res.fullnessPct}%), góc cắt ${cut}°`;
    for (const b of $('thickChoices').children) {
      b.disabled = true;
      if (b.dataset.label === res.truth) b.classList.add('right');
      else if (b.dataset.label === label) b.classList.add('wrong');
    }
  }

  let lastPottedKey = null;
  let lastDeadIds = [];
  function setPottedBalls(data, visible = true) {
    const el = $('pottedTray');
    if (!el) return;
    el.hidden = !visible;
    if (!visible) return;
    const rackIds = Array.isArray(data)
      ? data
      : data && Array.isArray(data.rackIds)
        ? data.rackIds
        : [];
    const deadList = data && Array.isArray(data.deadIds) ? data.deadIds : [];
    const scratch = !!(data && data.scratch);
    const deadSet = new Set(deadList);
    const deadSorted = [...deadSet].sort((a, b) => a - b);
    const key = `${rackIds.join(',')}|${deadSorted.join(',')}|${scratch ? '1' : '0'}`;
    if (key === lastPottedKey) return;
    const prevDead = new Set(lastDeadIds);
    lastPottedKey = key;
    lastDeadIds = deadSorted;

    const is15 = rackIds.length > 10;
    el.classList.toggle('is-15', is15);
    el.replaceChildren();

    const aliveCount = rackIds.filter((id) => !deadSet.has(id)).length;
    const label = document.createElement('span');
    label.className = 'potted-label';
    label.innerHTML = rackIds.length ? `Còn <strong>${aliveCount}</strong>/${rackIds.length}` : 'Trống';
    el.appendChild(label);

    for (const id of rackIds) {
      const dead = deadSet.has(id);
      const justDead = dead && !prevDead.has(id);
      const b = document.createElement('span');
      const sepClass = is15 && id === 8 ? ' is-eight-sep' : '';
      b.className = `potted-ball${dead ? ' is-dead' : ''}${justDead ? ' just-dead' : ''}${id >= 10 ? ' is-two' : ''}${sepClass}`;
      const col = BALL_COLORS[id] || '#888';
      b.style.background = id >= 9
        ? `linear-gradient(180deg, #f7f6ef 0 23%, ${col} 23% 77%, #f7f6ef 77%)`
        : col;
      b.title = dead ? `Bi #${id} (đã rơi lỗ)` : `Bi #${id} (trên bàn)`;
      const num = document.createElement('span');
      num.className = 'p-num';
      num.textContent = String(id);
      b.appendChild(num);
      el.appendChild(b);
    }

    if (scratch) {
      const s = document.createElement('span');
      s.className = 'potted-ball is-scratch-pill';
      s.textContent = 'Scratch';
      s.title = 'Bi cái rơi lỗ';
      el.appendChild(s);
    }
  }

  return {
    spinPad,
    toast,
    refreshTray,
    setPottedBalls,
    updateInfo,
    syncControls,
    updateStats,
    setActiveTab,
    setAppMode,
    setLobbyOpen,
    setMatchWin,
    setBotHud,
    setTurnLocked: (locked) => {
      $('power').disabled = !!locked;
      $('btnAimMode').disabled = !!locked;
      for (const b of document.querySelectorAll('[data-nudge]')) b.disabled = !!locked;
      spinPad.setLocked(!!locked);
    },
    resetThickness,
    showThickAnswer,
    setNextThick: (enabled) => {
      $('btnNextThick').disabled = !enabled;
    },
    setPosResult: (t) => {
      $('posResult').textContent = t;
    },
    setSquirtResult: (t) => {
      $('squirtResult').textContent = t;
    },
    setSquirtTitle: (html) => {
      $('squirtTitle').innerHTML = html;
    },
    /** mode: 'auto' | 'manual'; label = text for the angle readout. */
    setAimMode: (mode, label) => {
      const b = $('btnAimMode');
      b.textContent = mode === 'manual' ? 'Ngắm: Tự do' : 'Ngắm: Tự động';
      b.setAttribute('aria-pressed', String(mode === 'manual'));
      $('aimOffset').disabled = mode === 'manual';
      $('aimAngleVal').textContent = label;
    },
    setButtons: ({ shoot, reset }) => {
      $('btnShoot').disabled = !shoot;
      $('btnReset').disabled = !reset;
    },
    resize: () => spinPad.resize(),
  };
}
