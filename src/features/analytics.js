// Usage analytics through Google, loaded only when an id is configured and this is a release build.
// The id comes from <meta name="ga-measurement-id" content="..."> in index.html and may be either:
//   GTM-XXXXXXX   a Google Tag Manager container: events are pushed to the dataLayer as { event, ...params }
//                 and the tags/triggers inside the container decide what is forwarded (e.g. to GA4)
//   G-XXXXXXXXXX  a GA4 measurement id: events go straight to GA4 through gtag.js
// Only gameplay events are sent: never player names, room codes or anything typed by the user.
export const GA_ID_RE = /^G-[A-Z0-9]{4,20}$/;
export const GTM_ID_RE = /^GTM-[A-Z0-9]{4,20}$/;
export const isAnalyticsId = (id) => GA_ID_RE.test(id) || GTM_ID_RE.test(id);

export const readMeasurementId = (doc) => {
  const el = doc && doc.querySelector ? doc.querySelector('meta[name="ga-measurement-id"]') : null;
  const id = el ? String(el.getAttribute('content') || '').trim() : '';
  return isAnalyticsId(id) ? id : '';
};

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Keep only short, flat, non-personal values: event params are strings / numbers / booleans. */
export function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (!NAME_RE.test(k) || k === 'event') continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v) out[k] = v.slice(0, 100);
  }
  return out;
}

/**
 * opts: { id, enabled, win, doc }. Returns { enabled, kind: 'gtm' | 'ga4' | null, track(name, params) }.
 * When disabled (no id, or a develop build) nothing is loaded and track() is a no-op.
 */
export function createAnalytics({ id = '', enabled = true, win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  const on = !!(enabled && win && doc && isAnalyticsId(id));
  if (!on) return { enabled: false, kind: null, track() {} };

  win.dataLayer = win.dataLayer || [];
  const load = (src) => {
    const s = doc.createElement('script');
    s.async = true;
    s.src = src;
    (doc.head || doc.documentElement).appendChild(s);
  };

  if (GTM_ID_RE.test(id)) {
    // standard Tag Manager bootstrap
    win.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    load(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
    return {
      enabled: true,
      kind: 'gtm',
      track(name, params) {
        if (!NAME_RE.test(name)) return;
        win.dataLayer.push({ event: name, ...cleanParams(params) });
      },
    };
  }

  // gtag must push the `arguments` object itself (not an array), that is what gtag.js expects
  function gtag() {
    win.dataLayer.push(arguments); // eslint-disable-line prefer-rest-params
  }
  gtag('js', new Date());
  gtag('config', id);
  load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
  return {
    enabled: true,
    kind: 'ga4',
    track(name, params) {
      if (!NAME_RE.test(name)) return;
      gtag('event', name, cleanParams(params));
    },
  };
}
