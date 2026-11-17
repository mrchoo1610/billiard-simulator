// Where the relay server lives. Priority: ?server= on the page URL, localStorage['bida9-server'], same origin (/ws).
export const SERVER_STORAGE_KEY = 'bida9-server';
export const DEFAULT_LOCAL_URL = 'ws://localhost:28787/ws';

/** Accepts only ws:/wss: URLs; returns the normalised string or null. */
export function cleanServerUrl(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  try {
    const u = new URL(s.trim());
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    return u.toString();
  } catch (e) {
    return null;
  }
}

/** Pure: { search, stored, protocol, host } -> URL. */
export function resolveServerUrl({ search = '', stored = null, protocol = 'http:', host = '' } = {}) {
  let fromQuery = null;
  try {
    fromQuery = new URLSearchParams(search).get('server');
  } catch (e) {
    fromQuery = null;
  }
  const q = cleanServerUrl(fromQuery);
  if (q) return q;
  const s = cleanServerUrl(stored);
  if (s) return s;
  if ((protocol === 'http:' || protocol === 'https:') && host) return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
  return DEFAULT_LOCAL_URL;
}

export function serverUrl() {
  let stored = null;
  try {
    stored = localStorage.getItem(SERVER_STORAGE_KEY);
  } catch (e) {
    stored = null;
  }
  const loc = typeof location !== 'undefined' ? location : {};
  return resolveServerUrl({ search: loc.search || '', stored, protocol: loc.protocol || 'http:', host: loc.host || '' });
}
