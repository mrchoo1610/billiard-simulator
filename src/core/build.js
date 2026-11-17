// Develop vs release build, decided at runtime (there is no build step).
// Develop: served from a local development host, or switched on with ?dev=1 (remembered; ?dev=0 switches it off).
// Everything else is a release build, where develop-only features (Bot vs Bot) are hidden.
export const DEV_STORAGE_KEY = 'bida9-dev';

export function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
}

/** loc: { hostname, search }; storage: localStorage-like or null. Pure apart from the optional storage write. */
export function isDevBuild(loc = {}, storage = null) {
  let flag = null;
  try {
    flag = new URLSearchParams(loc.search || '').get('dev');
  } catch (e) {
    flag = null;
  }
  try {
    if (flag === '1') storage?.setItem(DEV_STORAGE_KEY, '1');
    else if (flag === '0') storage?.removeItem(DEV_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
  if (flag === '1') return true;
  if (flag === '0') return false;
  let stored = null;
  try {
    stored = storage ? storage.getItem(DEV_STORAGE_KEY) : null;
  } catch (e) {
    stored = null;
  }
  return stored === '1' || isLocalHost(loc.hostname);
}
