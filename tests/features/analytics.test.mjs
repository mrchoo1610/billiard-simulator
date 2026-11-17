import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, cleanParams, readMeasurementId, GA_ID_RE, GTM_ID_RE } from '../../src/features/analytics.js';

const fakeDoc = (metaContent = null) => {
  const appended = [];
  return {
    appended,
    head: { appendChild: (el) => appended.push(el) },
    createElement: () => ({}),
    querySelector: (sel) => (sel === 'meta[name="ga-measurement-id"]' && metaContent !== null ? { getAttribute: () => metaContent } : null),
  };
};

test('measurement id is read from the meta tag and validated', () => {
  assert.equal(readMeasurementId(fakeDoc('G-ABC123XYZ9')), 'G-ABC123XYZ9');
  assert.equal(readMeasurementId(fakeDoc('  G-ABC123XYZ9 ')), 'G-ABC123XYZ9');
  assert.equal(readMeasurementId(fakeDoc('')), '');
  assert.equal(readMeasurementId(fakeDoc('UA-1234-5')), '');
  assert.equal(readMeasurementId(fakeDoc('G-abc"><script>')), '');
  assert.equal(readMeasurementId(fakeDoc(null)), '');
  assert.equal(GA_ID_RE.test('G-ABC123XYZ9'), true);
});

test('disabled without an id or on a develop build: nothing is loaded', () => {
  for (const opts of [{ id: '' }, { id: 'G-ABC123XYZ9', enabled: false }, { id: 'nope' }]) {
    const win = {};
    const doc = fakeDoc();
    const a = createAnalytics({ ...opts, win, doc });
    assert.equal(a.enabled, false);
    a.track('match_end', { result: 'win' });
    assert.equal(win.dataLayer, undefined);
    assert.equal(doc.appended.length, 0);
  }
});

test('enabled: loads gtag.js once and queues config + events', () => {
  const win = {};
  const doc = fakeDoc();
  const a = createAnalytics({ id: 'G-ABC123XYZ9', win, doc });
  assert.equal(a.enabled, true);
  assert.equal(doc.appended.length, 1);
  assert.equal(doc.appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9');
  assert.deepEqual(Array.from(win.dataLayer[1]), ['config', 'G-ABC123XYZ9']);
  a.track('match_end', { mode: 'pvp', result: 'win', score_me: 5 });
  assert.deepEqual(Array.from(win.dataLayer[2]), ['event', 'match_end', { mode: 'pvp', result: 'win', score_me: 5 }]);
  a.track('Bad Name', {});
  assert.equal(win.dataLayer.length, 3);
});

test('cleanParams drops objects, bad keys, non-finite numbers and truncates strings', () => {
  const out = cleanParams({ mode: 'bot', n: 3, ok: true, bad: NaN, obj: { a: 1 }, 'Bad-Key': 'x', empty: '', long: 'x'.repeat(300) });
  assert.deepEqual(Object.keys(out).sort(), ['long', 'mode', 'n', 'ok']);
  assert.equal(out.long.length, 100);
});

test('a Tag Manager container id loads gtm.js and pushes events as dataLayer objects', () => {
  assert.equal(GTM_ID_RE.test('GTM-TEST1234'), true);
  assert.equal(readMeasurementId(fakeDoc('GTM-TEST1234')), 'GTM-TEST1234');
  const win = {};
  const doc = fakeDoc();
  const a = createAnalytics({ id: 'GTM-TEST1234', win, doc });
  assert.equal(a.enabled, true);
  assert.equal(a.kind, 'gtm');
  assert.equal(doc.appended[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST1234');
  assert.equal(win.dataLayer[0].event, 'gtm.js');
  assert.equal(typeof win.dataLayer[0]['gtm.start'], 'number');
  a.track('match_end', { mode: 'pvp', result: 'win', event: 'spoof', nested: { a: 1 } });
  assert.deepEqual(win.dataLayer[1], { event: 'match_end', mode: 'pvp', result: 'win' });
});
