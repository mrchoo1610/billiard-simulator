import test from 'node:test';
import assert from 'node:assert/strict';
import { R, buildTable } from '../../src/core/table.js';
import { computeShot } from '../../src/core/geometry.js';
import { encodeState, decodeState } from '../../src/features/share.js';
import { createBall, simulate } from '../../src/core/physics.js';
import { tablePreset, cuePreset, CUE_PRESETS, physicsEquipmentKey, cueVisualStyle } from '../../src/core/equipment.js';
import { createSoundEngine } from '../../src/ui/sound.js';
import * as drills from '../../src/features/drills.js';

const POCKETS = buildTable(tablePreset('club-9ft')).POCKETS;

test('share: round trip and validation', () => {
  const balls = [createBall(0, 1270, 635), createBall(1, 1905, 635), createBall(9, 2000, 700)];
  const hash = encodeState({ balls, targetId: 1, pocket: 2 });
  assert.equal(hash, 'c=1270,635;1=1905,635;9=2000,700;t=1;p=2');
  const d = decodeState('#' + hash);
  assert.deepEqual(d.balls, [
    { id: 0, x: 1270, y: 635 },
    { id: 1, x: 1905, y: 635 },
    { id: 9, x: 2000, y: 700 },
  ]);
  assert.equal(d.targetId, 1);
  assert.equal(d.pocket, 2);
  assert.equal(decodeState(''), null);
  assert.equal(decodeState('#garbage'), null);
  assert.equal(decodeState('#c=abc,1;p=99'), null);
});

test('drill: thickness scenarios are valid', () => {
  for (let i = 0; i < 30; i++) {
    const sc = drills.genThicknessDrill();
    assert.ok(sc.cutAngleDeg >= 5 && sc.cutAngleDeg <= 75);
    const s = computeShot(sc.cue, sc.obj, POCKETS[sc.pocket].aim, R);
    assert.equal(s.fullnessLabel, sc.label);
    assert.ok(drills.FULLNESS_LABELS.includes(sc.label));
    assert.equal(drills.answerThickness(sc, sc.label).correct, true);
  }
});

test('drill: position scenarios are solvable and scored', () => {
  for (let i = 0; i < 5; i++) {
    const sc = drills.genPositionDrill();
    assert.equal(sc.zone.r, 150);
    assert.ok(sc.solution.power > 0);
  }
  const stats = drills.defaultStats();
  drills.recordPosition(stats, true);
  drills.recordPosition(stats, true);
  drills.recordPosition(stats, false);
  assert.deepEqual(stats.position, { attempts: 3, success: 2, streak: 0, best: 2 });
});

test('share: table/cue ids in the hash', () => {
  const balls = [createBall(0, 1270, 635), createBall(1, 1905, 635)];
  const hash = encodeState({ balls, targetId: 1, pocket: null, tableId: 'bar-7ft', cueId: 'user-cue' });
  assert.equal(hash, 'c=1270,635;1=1905,635;t=1;tb=bar-7ft;cu=user-cue');
  const d = decodeState('#' + hash);
  assert.equal(d.tableId, 'bar-7ft');
  assert.equal(d.cueId, 'user-cue');
  const old = decodeState('#c=1270,635;1=1905,635');
  assert.equal(old.tableId, null);
  assert.equal(old.cueId, null);
  assert.equal(decodeState('#c=1,1;tb=BAD ID!').tableId, null);
});

test('drill: thickness scenarios stay on a 7ft table', () => {
  const t = tablePreset('bar-7ft');
  const geo = buildTable(t);
  for (let i = 0; i < 20; i++) {
    const sc = drills.genThicknessDrill(Math.random, t);
    for (const p of [sc.cue, sc.obj]) assert.ok(p.x <= geo.W && p.y <= geo.H);
  }
});

test('drill: squirt scenarios carry the compensating offset', () => {
  const eq = { table: tablePreset('club-9ft'), cue: cuePreset('standard') };
  for (let i = 0; i < 4; i++) {
    const sc = drills.genSquirtDrill(Math.random, eq);
    assert.ok(Math.abs(sc.tipX) > 0.1 && Math.abs(sc.tipX) <= 0.5);
    assert.ok(Math.abs(sc.offsetDeg - eq.cue.squirtDegPerFullSide * sc.tipX) < 1e-9);
  }
  const stats = drills.defaultStats();
  drills.recordSquirt(stats, true);
  drills.recordSquirt(stats, false);
  assert.deepEqual(stats.squirt, { attempts: 2, success: 1, streak: 0, best: 1 });
});

test('share: manual aim angle a= (1 decimal) round trips', () => {
  const balls = [createBall(0, 1270, 635), createBall(1, 1905, 635)];
  const hash = encodeState({ balls, targetId: 1, pocket: null, aimDeg: -23.456 });
  assert.equal(hash, 'c=1270,635;1=1905,635;t=1;a=-23.5');
  assert.equal(decodeState('#' + hash).aimDeg, -23.5);
  assert.equal(decodeState('#c=1,1;a=190').aimDeg, -170);
  assert.equal(decodeState('#c=1,1;a=x').aimDeg, null);
  assert.equal(decodeState('#c=1,1').aimDeg, null);
  assert.equal(encodeState({ balls, targetId: 1, pocket: null }), 'c=1270,635;1=1905,635;t=1');
});

test('equipment: physicsEquipmentKey ignores metadata and reacts to physics changes', () => {
  const table = tablePreset('club-9ft');
  const cue = cuePreset('user-cue');
  const baseKey = physicsEquipmentKey({ table, cue });
  const renamedCue = { ...cue, name: 'Custom Name', note: 'edited', tipHardness: 'hard', shaft: 'carbon' };
  assert.equal(physicsEquipmentKey({ table, cue: renamedCue }), baseKey);
  assert.notEqual(physicsEquipmentKey({ table, cue: { ...cue, squirtDegPerFullSide: cue.squirtDegPerFullSide + 0.1 } }), baseKey);
  assert.notEqual(physicsEquipmentKey({ table: { ...table, size: '7ft' }, cue }), baseKey);
});

test('sound engine is safe headless and physics events expose collision impact speed', () => {
  const states = [];
  const snd = createSoundEngine({ initialEnabled: true, onChange: (v) => states.push(v) });
  assert.equal(snd.isEnabled(), true);
  assert.equal(snd.toggle(), false);
  assert.deepEqual(states, [false]);
  snd.cueHit(0.7, false);
  snd.ballHit(1500);
  snd.cushionHit(900, false);
  snd.pocketDrop(600);

  const res = simulate(
    [createBall(0, 600, 635), createBall(1, 1000, 635)],
    { aimDir: { x: 1, y: 0 }, power: 0.6, tip: { x: 0, y: 0 } },
    { recordPaths: false },
  );
  assert.ok(res.events.contacts.length >= 1 && res.events.contacts[0].speed > 1000);
  assert.ok(res.events.cushionHits.length >= 1 && res.events.cushionHits[0].speed > 100);
});

test('cueVisualStyle gives distinct visual profiles for all cue presets and shaft/tip edits', () => {
  const keys = new Set(CUE_PRESETS.map((c) => cueVisualStyle(c).key));
  assert.equal(keys.size, CUE_PRESETS.length);

  const carbon = cueVisualStyle(cuePreset('carbon'));
  const brk = cueVisualStyle(cuePreset('break'));
  const std = cueVisualStyle(cuePreset('standard'));
  assert.notEqual(carbon.shaftColor, std.shaftColor);
  assert.ok(brk.profileScale > std.profileScale);
  assert.ok(carbon.ferruleLenMm < std.ferruleLenMm);
  assert.notEqual(brk.tipColor3d, std.tipColor3d);

  const customCarbon = cueVisualStyle({ ...cuePreset('user-cue'), shaft: 'carbon', tipHardness: 'phenolic' });
  assert.equal(customCarbon.shaftColor, carbon.shaftColor);
  assert.equal(customCarbon.tipColor3d, brk.tipColor3d);
});
