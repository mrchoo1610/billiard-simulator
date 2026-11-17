// Arcade-style in-game controls: Cue Puller (8 Ball Pool style), Aim Wheel, Floating Spin Popover, and Lab Drawer.
import { createSpinPad } from './input.js';
import { tipText } from './panel.js';

/**
 * Creates and binds the arcade in-game controls.
 * opts: {
 *   onPower: (p 0..1) => void,
 *   onShoot: () => void,
 *   onNudge: (deg) => void,
 *   onTip: (tip) => void,
 * }
 */
export function createArcadeControls({ onPower, onShoot, onNudge, onTip, onOpenSettings }) {
  const $ = (id) => document.getElementById(id);

  let currentPower = 0;
  let locked = false;
  let isDraggingPuller = false;
  let pullStartY = 0;
  let pullStartPower = 0;

  // -------------------------------------------------------------
  // 1. Arcade Cue Puller (8 Ball Pool style)
  // -------------------------------------------------------------
  const pullerWrap = $('cuePullerWrap');
  const pullerTrack = $('cuePullerTrack');
  const pullerStick = $('cuePullerStick');
  const pullerFill = $('cuePullerFill');
  const pullerPct = $('cuePullerPct');

  function updatePullerVisuals(p) {
    const pct = Math.round(p * 100);
    if (pullerPct) pullerPct.textContent = `${pct}%`;
    if (pullerFill) pullerFill.style.height = `${pct}%`;
    if (pullerStick) {
      // Displace stick downward up to 180px
      const dispY = Math.round(p * 160);
      pullerStick.style.transform = `translateY(${dispY}px)`;
    }
  }

  function handlePullerDown(e) {
    if (locked) return;
    isDraggingPuller = true;
    pullStartY = e.clientY;
    pullStartPower = currentPower;
    try {
      pullerTrack.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  }

  function handlePullerMove(e) {
    if (!isDraggingPuller) return;
    const deltaY = e.clientY - pullStartY;
    const maxDragPx = 160;
    let newPower = pullStartPower + deltaY / maxDragPx;
    newPower = Math.max(0, Math.min(1, newPower));
    currentPower = newPower;
    updatePullerVisuals(currentPower);
    onPower(currentPower);
  }

  function handlePullerUp(e) {
    if (!isDraggingPuller) return;
    isDraggingPuller = false;
    try {
      pullerTrack.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }

    if (currentPower > 0.03) {
      // Snap forward animation & shoot!
      if (pullerStick) {
        pullerStick.classList.add('snapping');
        pullerStick.style.transform = 'translateY(-12px)';
        setTimeout(() => {
          pullerStick.classList.remove('snapping');
          pullerStick.style.transform = 'translateY(0px)';
        }, 140);
      }
      onShoot();
    } else {
      // Canceled: smoothly return to 0
      currentPower = 0;
      updatePullerVisuals(0);
      onPower(0);
    }
  }

  if (pullerTrack) {
    pullerTrack.addEventListener('pointerdown', handlePullerDown);
    pullerTrack.addEventListener('pointermove', handlePullerMove);
    pullerTrack.addEventListener('pointerup', handlePullerUp);
    pullerTrack.addEventListener('pointercancel', handlePullerUp);
  }

  // Quick Shoot button
  $('btnQuickShoot')?.addEventListener('click', () => {
    if (!locked) onShoot();
  });

  // -------------------------------------------------------------
  // 2. Fine-tune Aim Wheel (Bánh xe vi chỉnh)
  // -------------------------------------------------------------
  const aimWheelDial = $('aimWheelDial');
  let isDraggingWheel = false;
  let wheelLastX = 0;

  if (aimWheelDial) {
    aimWheelDial.addEventListener('pointerdown', (e) => {
      if (locked) return;
      isDraggingWheel = true;
      wheelLastX = e.clientX;
      try {
        aimWheelDial.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      e.preventDefault();
    });

    aimWheelDial.addEventListener('pointermove', (e) => {
      if (!isDraggingWheel) return;
      const dx = e.clientX - wheelLastX;
      wheelLastX = e.clientX;
      // 0.08 degree per pixel of horizontal drag
      const deltaDeg = dx * 0.08;
      if (Math.abs(deltaDeg) > 0.01) {
        onNudge(deltaDeg);
      }
    });

    const endWheel = (e) => {
      if (!isDraggingWheel) return;
      isDraggingWheel = false;
      try {
        aimWheelDial.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };
    aimWheelDial.addEventListener('pointerup', endWheel);
    aimWheelDial.addEventListener('pointercancel', endWheel);

    // Mouse wheel support for jog dial
    aimWheelDial.addEventListener('wheel', (e) => {
      if (locked) return;
      e.preventDefault();
      const step = (e.deltaY || e.deltaX) > 0 ? 0.1 : -0.1;
      onNudge(step);
    }, { passive: false });
  }

  // Aim step buttons (-0.1° and +0.1°)
  $('btnAimStepLeft')?.addEventListener('click', () => onNudge(-0.1));
  $('btnAimStepRight')?.addEventListener('click', () => onNudge(0.1));

  // -------------------------------------------------------------
  // 3. Floating Spin Button & Popover
  // -------------------------------------------------------------
  const floatingSpinBtn = $('floatingSpinBtn');
  const spinPopover = $('spinPopover');
  const floatingSpinCanvas = $('floatingSpinCanvas');
  const popoverSpinCanvas = $('popoverSpinCanvas');
  const floatingSpinLabel = $('floatingSpinLabel');
  const popoverSpinLabel = $('popoverSpinLabel');

  let popoverSpinPad = null;
  if (popoverSpinCanvas) {
    popoverSpinPad = createSpinPad(popoverSpinCanvas, (tip) => {
      drawFloatingSpin(tip);
      if (popoverSpinLabel) popoverSpinLabel.textContent = tipText(tip);
      if (floatingSpinLabel) floatingSpinLabel.textContent = tipText(tip).split(' · ')[0];
      onTip(tip);
    });
  }

  function drawFloatingSpin(tip) {
    if (!floatingSpinCanvas) return;
    const ctx = floatingSpinCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 46;
    if (floatingSpinCanvas.width !== Math.round(size * dpr)) {
      floatingSpinCanvas.width = Math.round(size * dpr);
      floatingSpinCanvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const c = size / 2;
    const r = c - 3;
    const MAXR = 0.8;

    // Gradient cue ball sphere
    const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#f0eee4');
    g.addColorStop(1, '#c2c1b4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    // Crosshairs
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - r, c);
    ctx.lineTo(c + r, c);
    ctx.moveTo(c, c - r);
    ctx.lineTo(c, c + r);
    ctx.stroke();

    // Miscue dashed ring
    ctx.strokeStyle = 'rgba(211, 47, 47, 0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(c, c, r * MAXR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Red chalk contact point
    const tx = c + (tip.x || 0) * r * MAXR;
    const ty = c - (tip.y || 0) * r * MAXR;
    ctx.fillStyle = '#e53935';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(tx, ty, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function toggleSpinPopover(open) {
    if (!spinPopover) return;
    const shouldOpen = open !== undefined ? open : spinPopover.hidden;
    spinPopover.hidden = !shouldOpen;
    if (shouldOpen && popoverSpinPad) {
      popoverSpinPad.resize();
      popoverSpinPad.draw();
    }
  }

  floatingSpinBtn?.addEventListener('click', () => toggleSpinPopover());
  $('btnCloseSpin')?.addEventListener('click', () => toggleSpinPopover(false));
  $('btnDoneSpin')?.addEventListener('click', () => toggleSpinPopover(false));
  $('btnResetSpin')?.addEventListener('click', () => {
    if (popoverSpinPad) popoverSpinPad.set({ x: 0, y: 0 });
  });

  // -------------------------------------------------------------
  // 4. Lab Drawer Toggle (Chế độ Bắn tập)
  // -------------------------------------------------------------
  const sideEl = document.querySelector('.side');
  const sideBackdrop = $('sideDrawerBackdrop');

  function toggleLabDrawer(open) {
    if (!sideEl) return;
    const isOpen = open !== undefined ? open : !sideEl.classList.contains('is-open');
    sideEl.classList.toggle('is-open', isOpen);
    if (sideBackdrop) sideBackdrop.classList.toggle('is-open', isOpen);
  }

  $('btnBottomSettings')?.addEventListener('click', () => onOpenSettings?.());
  $('btnOpenLab')?.addEventListener('click', () => toggleLabDrawer(true));
  $('btnCloseSideDrawer')?.addEventListener('click', () => toggleLabDrawer(false));
  sideBackdrop?.addEventListener('click', () => toggleLabDrawer(false));

  // Initial draw
  drawFloatingSpin({ x: 0, y: 0 });

  return {
    setPower(p) {
      currentPower = Math.max(0, Math.min(1, p));
      updatePullerVisuals(currentPower);
    },
    setTip(tip) {
      drawFloatingSpin(tip);
      if (popoverSpinPad) popoverSpinPad.set(tip, true);
      if (floatingSpinLabel) floatingSpinLabel.textContent = tipText(tip).split(' · ')[0];
      if (popoverSpinLabel) popoverSpinLabel.textContent = tipText(tip);
    },
    setLocked(on) {
      locked = !!on;
      if (pullerWrap) pullerWrap.classList.toggle('locked', locked);
      const btnShoot = $('btnQuickShoot');
      if (btnShoot) {
        btnShoot.disabled = locked;
        btnShoot.classList.toggle('ready', !locked);
      }
    },
    setAppMode(appMode) {
      const isPractice = appMode === 'practice';
      const isBvb = appMode === 'bvb';
      if (pullerWrap) pullerWrap.hidden = isBvb;
      const btnShoot = $('btnQuickShoot');
      if (btnShoot) btnShoot.hidden = isBvb;
      const btnLab = $('btnOpenLab');
      if (btnLab) {
        btnLab.hidden = false;
        btnLab.textContent = isPractice ? '🧪 Thông số & Lab' : '⚙️ Tùy chọn';
        btnLab.title = isPractice
          ? 'Mở bảng phân tích kỹ thuật & thông số vật lý'
          : 'Mở tùy chọn thể thức, độ khó và ván đấu';
      }
      // Close drawer when switching modes
      if (sideEl) {
        sideEl.classList.remove('is-open');
        if (sideBackdrop) sideBackdrop.classList.remove('is-open');
      }
    },
    resize() {
      if (popoverSpinPad) popoverSpinPad.resize();
      drawFloatingSpin({ x: 0, y: 0 });
    },
  };
}
