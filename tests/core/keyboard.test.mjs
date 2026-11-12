import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyAction, aimStep, powerStep, tipStep, holdMultiplier, repeatSpec, isTypingTarget, moveTip, stepPower,
  stepElevation, cycleTarget, nextPocket, tipBadge, wheelPixels, KEY_HELP, ACTIVE_DURING_SHOT,
} from '../../src/ui/keyboard.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const ev = (key, mods = {}) => ({ key, ...mods });

test('steps: aim 0.1 / Shift 1 / Alt 0.02, power 1% / 5%, tip 0.05 / 0.1', () => {
  near(aimStep({}), 0.1);
  near(aimStep({ shiftKey: true }), 1);
  near(aimStep({ altKey: true }), 0.02);
  near(powerStep({}), 0.01);
  near(powerStep({ shiftKey: true }), 0.05);
  near(tipStep({}), 0.05);
  near(tipStep({ shiftKey: true }), 0.1);
});

test('keyAction: arrows -> aim / power, Ctrl+arrows -> tip', () => {
  assert.deepEqual(keyAction(ev('ArrowLeft')), { type: 'aim', dir: -1, step: 0.1 });
  assert.deepEqual(keyAction(ev('ArrowRight', { shiftKey: true })), { type: 'aim', dir: 1, step: 1 });
  assert.deepEqual(keyAction(ev('ArrowRight', { altKey: true })), { type: 'aim', dir: 1, step: 0.02 });
  assert.deepEqual(keyAction(ev('ArrowUp')), { type: 'power', dir: 1, step: 0.01 });
  assert.deepEqual(keyAction(ev('ArrowDown', { shiftKey: true })), { type: 'power', dir: -1, step: 0.05 });
  assert.deepEqual(keyAction(ev('ArrowLeft', { ctrlKey: true })), { type: 'tip', dx: -1, dy: 0, step: 0.05 });
  assert.deepEqual(keyAction(ev('ArrowUp', { ctrlKey: true, shiftKey: true })), { type: 'tip', dx: 0, dy: 1, step: 0.1 });
  assert.deepEqual(keyAction(ev('ArrowDown', { ctrlKey: true })), { type: 'tip', dx: 0, dy: -1, step: 0.05 });
});

test('keyAction: WASD / letters / digits / specials', () => {
  assert.deepEqual(keyAction(ev('a')), { type: 'tip', dx: -1, dy: 0, step: 0.05 });
  assert.deepEqual(keyAction(ev('W', { shiftKey: true })), { type: 'tip', dx: 0, dy: 1, step: 0.1 });
  assert.equal(keyAction(ev('s')).dy, -1);
  assert.equal(keyAction(ev('d')).dx, 1);
  assert.equal(keyAction(ev('c')).type, 'tipCentre');
  assert.equal(keyAction(ev(' ')).type, 'shoot');
  assert.deepEqual(keyAction(ev('PageUp')), { type: 'elevation', dir: 1 });
  assert.deepEqual(keyAction(ev('PageDown')), { type: 'elevation', dir: -1 });
  assert.deepEqual(keyAction(ev('Tab')), { type: 'target', dir: 1 });
  assert.deepEqual(keyAction(ev('Tab', { shiftKey: true })), { type: 'target', dir: -1 });
  assert.deepEqual(keyAction(ev('p')), { type: 'pocket', auto: false });
  assert.deepEqual(keyAction(ev('P', { shiftKey: true })), { type: 'pocket', auto: true });
  assert.deepEqual(keyAction(ev('7')), { type: 'targetBall', id: 7 });
  assert.equal(keyAction(ev('0')), null);
  for (const [k, t] of [['m', 'aimMode'], ['r', 'reset'], ['n', 'random'], ['f', 'predict'], ['h', 'help'], ['?', 'help'], ['Escape', 'close']]) {
    assert.equal(keyAction(ev(k)).type, t, k);
  }
  assert.equal(keyAction(ev('x')), null);
  assert.equal(keyAction(ev('Enter')), null);
});

test('keyAction never claims Ctrl/Cmd/Alt + letter (browser shortcuts)', () => {
  for (const k of ['r', 'c', 'a', 's', 'w', 'f', 'p', 'n', 'h', 'm', 'z', 'x', 'v', '1', 'Tab', 'PageUp']) {
    assert.equal(keyAction(ev(k, { ctrlKey: true })), null, `ctrl+${k}`);
    assert.equal(keyAction(ev(k, { metaKey: true })), null, `meta+${k}`);
  }
  assert.equal(keyAction(ev('r', { altKey: true })), null);
  assert.equal(keyAction(ev('ArrowLeft', { metaKey: true })), null);
});

test('holdMultiplier: x5 aim / x3 power after 1 s, none before; non-repeating actions stay x1', () => {
  assert.equal(holdMultiplier('aim', 999), 1);
  assert.equal(holdMultiplier('aim', 1000), 5);
  assert.equal(holdMultiplier('power', 500), 1);
  assert.equal(holdMultiplier('power', 2500), 3);
  assert.equal(holdMultiplier('shoot', 5000), 1);
  assert.equal(repeatSpec('shoot'), null);
  assert.equal(repeatSpec('aim').interval, 40);
});

test('isTypingTarget', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false);
  assert.equal(isTypingTarget(null), false);
});

test('stepPower clamps to 0..1 and rounds to 1%', () => {
  near(stepPower(0.3, 0.01), 0.31);
  near(stepPower(0.99, 0.05), 1);
  near(stepPower(0.02, -0.05), 0);
  near(stepPower(0.1 + 0.2, 0.01), 0.31); // float noise
});

test('stepElevation clamps to 0..30', () => {
  assert.equal(stepElevation(5, 1), 6);
  assert.equal(stepElevation(30, 1), 30);
  assert.equal(stepElevation(0, -1), 0);
});

test('moveTip: free movement inside the miscue ring', () => {
  const r = moveTip({ x: 0, y: 0 }, 0.05, 0, 0.55);
  assert.deepEqual(r.tip, { x: 0.05, y: 0 });
  assert.equal(r.stopped, false);
  assert.equal(r.changed, true);
});

test('moveTip: a step across the miscue ring stops exactly on it', () => {
  const r = moveTip({ x: 0.5, y: 0 }, 0.1, 0, 0.55);
  near(r.tip.x, 0.55, 1e-3);
  assert.equal(r.tip.y, 0);
  assert.equal(r.stopped, true);
});

test('moveTip: on the ring, a repeat does not cross but a fresh press does', () => {
  const onRing = { x: 0.55, y: 0 };
  const rep = moveTip(onRing, 0.05, 0, 0.55, false);
  assert.equal(rep.changed, false);
  assert.equal(rep.stopped, true);
  const press = moveTip(onRing, 0.05, 0, 0.55, true);
  near(press.tip.x, 0.6, 1e-9);
  assert.equal(press.stopped, false);
});

test('moveTip: sliding along the ring is allowed without crossing', () => {
  const r = moveTip({ x: 0.55, y: 0 }, 0, 0.05, 0.55, false);
  assert.equal(r.changed, true);
  near(Math.hypot(r.tip.x, r.tip.y), 0.55, 2e-3);
});

test('moveTip: beyond the ring moves freely until the unit circle; moving back inward is free', () => {
  const out = moveTip({ x: 0.9, y: 0 }, 0.5, 0, 0.55, false);
  near(Math.hypot(out.tip.x, out.tip.y), 1, 1e-3);
  const back = moveTip({ x: 0.7, y: 0 }, -0.2, 0, 0.55, false);
  near(back.tip.x, 0.5, 1e-9);
  assert.equal(back.stopped, false);
});

test('moveTip: diagonal clamp keeps the tip inside the unit circle; limit >= 1 means no ring', () => {
  const r = moveTip({ x: 0.9, y: 0.4 }, 0.1, 0.1, 1.2);
  assert.ok(Math.hypot(r.tip.x, r.tip.y) <= 1 + 1e-9);
  assert.equal(r.stopped, false);
});

test('moveTip never returns -0', () => {
  const r = moveTip({ x: 0.05, y: 0 }, -0.05, 0, 0.55);
  assert.ok(Object.is(r.tip.x, 0) && Object.is(r.tip.y, 0));
});

test('cycleTarget wraps both ways and recovers from an unknown current id', () => {
  assert.equal(cycleTarget([3, 1, 9], 1, 1), 3);
  assert.equal(cycleTarget([3, 1, 9], 9, 1), 1);
  assert.equal(cycleTarget([3, 1, 9], 1, -1), 9);
  assert.equal(cycleTarget([3, 1, 9], 5, 1), 1);
  assert.equal(cycleTarget([3, 1, 9], 5, -1), 9);
  assert.equal(cycleTarget([], 1, 1), null);
  assert.equal(cycleTarget([4], 4, 1), 4);
});

test('nextPocket cycles from the explicit pocket, else from the automatic one', () => {
  assert.equal(nextPocket(null, 2, 6), 3);
  assert.equal(nextPocket(5, 2, 6), 0);
  assert.equal(nextPocket(null, null, 6), 0);
  assert.equal(nextPocket(0, null, 6), 1);
});

test('tipBadge describes the tip in Vietnamese', () => {
  assert.equal(tipBadge({ x: 0, y: 0 }), 'Điểm chạm: giữa');
  assert.equal(tipBadge({ x: 0.3, y: 0 }), 'Phê phải 30 %');
  assert.equal(tipBadge({ x: -0.2, y: 0 }), 'Phê trái 20 %');
  assert.equal(tipBadge({ x: 0.1, y: -0.35 }), 'Thấp 35 % · Phê phải 10 %');
  assert.equal(tipBadge({ x: 0, y: 0.4 }), 'Cao 40 %');
});

test('wheelPixels normalises delta modes and Shift-horizontal wheels', () => {
  assert.equal(wheelPixels({ deltaY: 100, deltaMode: 0 }), 100);
  assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }), 99);
  assert.equal(wheelPixels({ deltaY: 0, deltaX: -100, deltaMode: 0 }), -100);
});

test('help table is complete and shot-time actions are limited', () => {
  assert.ok(KEY_HELP.length >= 14);
  assert.ok(KEY_HELP.every((r) => r.keys && r.desc));
  assert.deepEqual([...ACTIVE_DURING_SHOT].sort(), ['close', 'help', 'shoot']);
});
