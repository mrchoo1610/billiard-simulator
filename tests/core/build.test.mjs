import test from 'node:test';
import assert from 'node:assert/strict';
import { isDevBuild, isLocalHost, DEV_STORAGE_KEY } from '../../src/core/build.js';

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('local development hosts are develop builds', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) assert.equal(isLocalHost(h), true, h);
  assert.equal(isDevBuild({ hostname: 'localhost', search: '' }), true);
});

test('public and LAN hosts are release builds', () => {
  for (const h of ['example.com', '192.168.1.20', 'localhost.example.com', '']) {
    assert.equal(isDevBuild({ hostname: h, search: '' }, mem()), false, h);
  }
});

test('?dev=1 switches develop on and is remembered; ?dev=0 switches it off', () => {
  const s = mem();
  assert.equal(isDevBuild({ hostname: 'example.com', search: '?dev=1' }, s), true);
  assert.equal(s.getItem(DEV_STORAGE_KEY), '1');
  assert.equal(isDevBuild({ hostname: 'example.com', search: '' }, s), true);
  assert.equal(isDevBuild({ hostname: 'example.com', search: '?dev=0' }, s), false);
  assert.equal(isDevBuild({ hostname: 'example.com', search: '' }, s), false);
});

test('?dev=0 forces release even on localhost', () => {
  assert.equal(isDevBuild({ hostname: 'localhost', search: '?dev=0' }, mem()), false);
});
