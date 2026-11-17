import test from 'node:test';
import assert from 'node:assert/strict';

test('arcade controls: power drag displacement math', () => {
  const maxDragPx = 160;
  function calcPower(startPower, deltaY) {
    let p = startPower + deltaY / maxDragPx;
    return Math.max(0, Math.min(1, p));
  }

  assert.equal(calcPower(0, 0), 0);
  assert.equal(calcPower(0, 80), 0.5);
  assert.equal(calcPower(0, 160), 1);
  assert.equal(calcPower(0, 200), 1); // clamped max
  assert.equal(calcPower(0.5, -40), 0.25);
  assert.equal(calcPower(0.5, -100), 0); // clamped min
});

test('arcade controls: aim jog dial nudge conversion', () => {
  function calcNudge(dx) {
    return Math.round(dx * 0.08 * 100) / 100;
  }

  assert.equal(calcNudge(10), 0.8);
  assert.equal(calcNudge(-10), -0.8);
  assert.equal(calcNudge(1.25), 0.1);
});

test('arcade controls: strike threshold triggers shot if power > 0.03', () => {
  function shouldShoot(power) {
    return power > 0.03;
  }

  assert.equal(shouldShoot(0.01), false);
  assert.equal(shouldShoot(0.03), false);
  assert.equal(shouldShoot(0.031), true);
  assert.equal(shouldShoot(0.85), true);
});
