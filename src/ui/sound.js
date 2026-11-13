// Procedural Web Audio sound effects for billiard physics (no external assets required).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createSoundEngine({ initialEnabled = true, onChange = null } = {}) {
  let enabled = !!initialEnabled;
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let recentBallHits = [];

  function ensure() {
    if (!enabled || typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 18;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      master = ctx.createGain();
      master.gain.value = 0.72;
      master.connect(comp);
      comp.connect(ctx.destination);

      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    if (enabled) ensure();
  }

  function setEnabled(next) {
    enabled = !!next;
    if (master && ctx) master.gain.setValueAtTime(enabled ? 0.72 : 0, ctx.currentTime);
    if (enabled) ensure();
    if (onChange) onChange(enabled);
  }

  function tone({ f0, f1 = f0, dur = 0.04, gain = 0.2, type = 'sine', delay = 0 }) {
    const c = ensure();
    if (!c || !master) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.005);
  }

  function burst({ filter = 'bandpass', freq = 1800, q = 2, dur = 0.025, gain = 0.2, delay = 0 }) {
    const c = ensure();
    if (!c || !master || !noiseBuf) return;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(freq, t0);
    flt.Q.setValueAtTime(q, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.5, dur + 0.01);
  }

  /** Cue tip striking the cue ball. */
  function cueHit(power = 0.5, miscue = false) {
    if (!enabled) return;
    const p = clamp(power, 0.05, 1);
    const amp = 0.16 + 0.34 * Math.pow(p, 0.78);
    if (miscue) {
      burst({ filter: 'bandpass', freq: 2400, q: 4.5, dur: 0.022, gain: amp * 0.9 });
      tone({ f0: 620, f1: 280, dur: 0.032, gain: amp * 0.45, type: 'triangle' });
      return;
    }
    tone({ f0: 360 + p * 180, f1: 120, dur: 0.038, gain: amp * 0.55, type: 'triangle' });
    burst({ filter: 'bandpass', freq: 1150 + p * 750, q: 2.2, dur: 0.018, gain: amp * 0.65 });
  }

  /** Phenolic ball-to-ball collision clack, scaled by normal impact speed (mm/s). */
  function ballHit(speed = 1200) {
    if (!enabled || speed < 25) return;
    const now = performance.now();
    recentBallHits = recentBallHits.filter((t) => now - t < 28);
    if (recentBallHits.length >= 6) return;
    if (recentBallHits.length && now - recentBallHits[recentBallHits.length - 1] < 6) return;
    recentBallHits.push(now);

    const k = clamp((speed - 25) / 4800, 0.04, 1);
    const amp = 0.07 + 0.46 * Math.pow(k, 0.75);
    const jitter = 0.96 + Math.random() * 0.08;
    tone({ f0: 2580 * jitter, f1: 2380 * jitter, dur: 0.032, gain: amp * 0.62, type: 'sine' });
    tone({ f0: 4480 * jitter, f1: 4120 * jitter, dur: 0.02, gain: amp * 0.38, type: 'sine' });
    burst({ filter: 'bandpass', freq: 3400 * jitter, q: 3.2, dur: 0.008, gain: amp * 0.75 });
  }

  /** Rail cushion thump or sharper pocket-jaw knock. */
  function cushionHit(speed = 1000, isJaw = false) {
    if (!enabled || speed < 25) return;
    const k = clamp((speed - 25) / 4500, 0.04, 1);
    const amp = 0.06 + 0.34 * Math.pow(k, 0.8);
    if (isJaw) {
      tone({ f0: 290, f1: 135, dur: 0.04, gain: amp * 0.65, type: 'triangle' });
      burst({ filter: 'bandpass', freq: 720, q: 2.0, dur: 0.022, gain: amp * 0.5 });
    } else {
      tone({ f0: 145, f1: 78, dur: 0.055, gain: amp * 0.78, type: 'sine' });
      burst({ filter: 'lowpass', freq: 440, q: 1.0, dur: 0.036, gain: amp * 0.42 });
    }
  }

  /** Soft leather pocket drop + bounce sound. */
  function pocketDrop(speed = 800) {
    if (!enabled) return;
    const k = clamp(speed / 3000, 0.25, 1);
    const amp = 0.16 + 0.22 * k;
    tone({ f0: 168, f1: 74, dur: 0.085, gain: amp, type: 'sine' });
    burst({ filter: 'lowpass', freq: 340, q: 1.1, dur: 0.045, gain: amp * 0.55, delay: 0.035 });
    tone({ f0: 112, f1: 62, dur: 0.06, gain: amp * 0.55, type: 'sine', delay: 0.055 });
  }

  return {
    isEnabled: () => enabled,
    setEnabled,
    toggle: () => {
      setEnabled(!enabled);
      return enabled;
    },
    unlock,
    cueHit,
    ballHit,
    cushionHit,
    pocketDrop,
  };
}
