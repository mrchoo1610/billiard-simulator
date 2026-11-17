/**
 * Esports Match Effects: Callout Banners (NICE SHOT, FOUL, etc.) & Shot Clock 30s.
 */

export function createMatchFx({ sound = null, onTimeout = null } = {}) {
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

  const bannerEl = $('gameCalloutBanner');
  const boxEl = $('calloutBox');
  const iconEl = $('calloutIcon');
  const titleEl = $('calloutTitle');
  const subtitleEl = $('calloutSubtitle');

  const clockWrap1 = $('tvClockWrap1');
  const clockWrap2 = $('tvClockWrap2');
  const clockBar1 = $('shotClockBar1');
  const clockBar2 = $('shotClockBar2');
  const clockSec = $('tvShotClockSec');
  const avatar1 = $('tvAvatar1');
  const avatar2 = $('tvAvatar2');

  const CIRCLE_LEN = 69.12; // 2 * Math.PI * 11

  let bannerTimer = null;
  let clockTimer = null;
  let remainingSeconds = 30;
  let totalSeconds = 30;
  let currentShooter = null; // 'player' | 'bot' | 'bot1' | 'bot2'
  let isClockPaused = false;

  // -------------------------------------------------------------
  // 1. Callout Banners
  // -------------------------------------------------------------
  const PRESET_CALLOUTS = {
    pot: {
      icon: '🔥',
      title: 'NICE SHOT!',
      subtitle: 'Ăn bi mục tiêu chính xác',
      type: 'good',
    },
    combo: {
      icon: '⚡',
      title: 'COMBO POT!',
      subtitle: 'Cú đánh kết hợp tuyệt đỉnh',
      type: 'good',
    },
    golden_break: {
      icon: '👑',
      title: 'GOLDEN BREAK!',
      subtitle: 'Ăn bi số 9 ngay từ cú phá',
      type: 'gold',
    },
    foul: {
      icon: '⚠️',
      title: 'FOUL!',
      subtitle: 'Phạm quy - Đối thủ đặt bi tự do',
      type: 'bad',
    },
    scratch: {
      icon: '⚪',
      title: 'SCRATCH!',
      subtitle: 'Bi cái rơi vào lỗ',
      type: 'bad',
    },
    ball_in_hand: {
      icon: '🎯',
      title: 'BALL IN HAND',
      subtitle: 'Đặt bi cái ở vị trí tùy ý',
      type: 'warn',
    },
    timeout: {
      icon: '⏰',
      title: 'HẾT GIỜ!',
      subtitle: 'Quá thời gian lượt đánh 30s',
      type: 'bad',
    },
    rack_win: {
      icon: '🎉',
      title: 'THẮNG VÁN!',
      subtitle: 'Chiến thắng ván đấu',
      type: 'gold',
    },
    victory: {
      icon: '🏆',
      title: 'VICTORY!',
      subtitle: 'Vô địch trận đấu!',
      type: 'gold',
    },
  };

  function showCallout(opts = {}) {
    if (!bannerEl || !boxEl) return;
    const preset = PRESET_CALLOUTS[opts.kind] || {};
    const title = opts.title || preset.title || 'THÔNG BÁO';
    const subtitle = opts.subtitle || preset.subtitle || '';
    const icon = opts.icon || preset.icon || '🎱';
    const styleKind = opts.type || preset.type || 'good';
    const duration = opts.duration || 1700;

    // Play procedural audio
    if (sound) {
      if (styleKind === 'bad') sound.foulTone?.();
      else if (opts.kind === 'victory') sound.cheer?.();
      else if (opts.kind === 'combo' || opts.kind === 'golden_break') sound.potTone?.(true);
      else if (styleKind === 'good') sound.potTone?.(false);
    }

    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    boxEl.className = `callout-box kind-${styleKind}`;
    bannerEl.hidden = false;
    bannerEl.classList.remove('is-active');
    // Force reflow for CSS animation restart
    void bannerEl.offsetWidth;
    bannerEl.classList.add('is-active');

    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      bannerEl.classList.remove('is-active');
      setTimeout(() => {
        bannerEl.hidden = true;
      }, 250);
    }, duration);
  }

  // -------------------------------------------------------------
  // 2. Shot Clock 30s
  // -------------------------------------------------------------
  function updateClockVisuals() {
    const isPlayer1 = currentShooter === 'player' || currentShooter === 'bot1';
    const isUrgent = remainingSeconds <= 5 && remainingSeconds > 0;

    if (clockWrap1) {
      clockWrap1.classList.toggle('active', isPlayer1);
      clockWrap1.classList.toggle('urgent', isPlayer1 && isUrgent);
    }
    if (clockWrap2) {
      clockWrap2.classList.toggle('active', !isPlayer1);
      clockWrap2.classList.toggle('urgent', !isPlayer1 && isUrgent);
    }

    const ratio = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
    const offset = CIRCLE_LEN * (1 - ratio);

    if (clockBar1) {
      clockBar1.style.strokeDashoffset = isPlayer1 ? offset : CIRCLE_LEN;
    }
    if (clockBar2) {
      clockBar2.style.strokeDashoffset = !isPlayer1 ? offset : CIRCLE_LEN;
    }

    if (clockSec) {
      clockSec.textContent = `${Math.ceil(remainingSeconds)}s`;
      clockSec.classList.toggle('urgent', isUrgent);
    }
  }

  function startShotClock(seconds = 30, shooter = 'player') {
    stopShotClock();
    remainingSeconds = seconds;
    totalSeconds = seconds;
    currentShooter = shooter;
    isClockPaused = false;
    updateClockVisuals();

    clockTimer = setInterval(() => {
      if (isClockPaused) return;
      remainingSeconds -= 0.25;

      // Audio tick during last 5 seconds (every whole second)
      if (remainingSeconds <= 5 && remainingSeconds > 0) {
        if (Math.abs(remainingSeconds - Math.round(remainingSeconds)) < 0.05) {
          sound?.timerTick?.(true);
        }
      }

      if (remainingSeconds <= 0) {
        remainingSeconds = 0;
        updateClockVisuals();
        stopShotClock();
        showCallout({ kind: 'timeout' });
        if (onTimeout) onTimeout(currentShooter);
      } else {
        updateClockVisuals();
      }
    }, 250);
  }

  function stopShotClock() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (clockWrap1) {
      clockWrap1.classList.remove('active', 'urgent');
    }
    if (clockWrap2) {
      clockWrap2.classList.remove('active', 'urgent');
    }
    if (clockBar1) clockBar1.style.strokeDashoffset = '0';
    if (clockBar2) clockBar2.style.strokeDashoffset = '0';
    if (clockSec) {
      clockSec.textContent = '30s';
      clockSec.classList.remove('urgent');
    }
  }

  function pauseShotClock() {
    isClockPaused = true;
  }

  function resumeShotClock() {
    isClockPaused = false;
  }

  function setAvatars(p1Icon = '👤', p2Icon = '🤖') {
    if (avatar1) avatar1.textContent = p1Icon;
    if (avatar2) avatar2.textContent = p2Icon;
  }

  return {
    showCallout,
    startShotClock,
    stopShotClock,
    pauseShotClock,
    resumeShotClock,
    setAvatars,
    getRemainingSeconds: () => remainingSeconds,
  };
}
