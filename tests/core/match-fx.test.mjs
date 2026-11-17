import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchFx } from '../../src/ui/match-fx.js';

test('match-fx: headless safe initialization', () => {
  let timeoutTriggered = false;
  const fx = createMatchFx({
    sound: null,
    onTimeout: () => {
      timeoutTriggered = true;
    },
  });

  assert.equal(typeof fx.showCallout, 'function');
  assert.equal(typeof fx.startShotClock, 'function');
  assert.equal(typeof fx.stopShotClock, 'function');
  assert.equal(typeof fx.pauseShotClock, 'function');
  assert.equal(typeof fx.resumeShotClock, 'function');
  assert.equal(typeof fx.setAvatars, 'function');

  // Calling methods without DOM must not crash
  fx.showCallout({ kind: 'pot' });
  fx.showCallout({ kind: 'combo' });
  fx.showCallout({ kind: 'foul' });
  fx.showCallout({ kind: 'victory' });
  fx.setAvatars('👤', '🤖');
  fx.stopShotClock();
});

test('match-fx: shot clock timer countdown and control', async () => {
  let expiredWho = null;
  const fx = createMatchFx({
    sound: null,
    onTimeout: (who) => {
      expiredWho = who;
    },
  });

  fx.startShotClock(1, 'player');
  assert.equal(fx.getRemainingSeconds(), 1);

  fx.pauseShotClock();
  fx.resumeShotClock();

  // Wait for 1.3s to allow 1s timer to expire
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(expiredWho, 'player');
  assert.equal(fx.getRemainingSeconds(), 0);

  fx.stopShotClock();
});
