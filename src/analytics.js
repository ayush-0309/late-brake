// Privacy-friendly analytics and error reports, off unless CONFIG.analytics
// is set. No cookies and nothing personal: page views, event names and a
// few plain values (circuit, camera, lap valid or not).

import { CONFIG } from './config.js';

const MAX_ERRORS = 5; // error reports per page load
let send = null;
let errorsSent = 0;

export function initAnalytics() {
  const cfg = CONFIG.analytics;
  if (!cfg || send) return;
  if (cfg.provider === 'plausible' && cfg.domain) {
    window.plausible ||= function () { (window.plausible.q ||= []).push(arguments); };
    script('https://plausible.io/js/script.js', { 'data-domain': cfg.domain });
    send = (name, props) => window.plausible(name, { props });
  } else if (cfg.provider === 'goatcounter' && cfg.code) {
    script('https://gc.zgo.at/count.js', { 'data-goatcounter': `https://${cfg.code}.goatcounter.com/count` });
    // GoatCounter events have no properties, so they go in the event path.
    send = (name, props) => {
      const path = [name, ...Object.values(props || {})].join('/').toLowerCase().replace(/\s+/g, '-');
      window.goatcounter?.count?.({ path, title: name, event: true });
    };
  }
  if (!send) return;
  addEventListener('error', (e) => reportError(e.error || e.message, 'window'));
  addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}

export function track(name, props) {
  try {
    send?.(name, props);
  } catch {}
}

export function reportError(err, where = 'game') {
  if (!send || errorsSent >= MAX_ERRORS) return;
  errorsSent++;
  const message = String(err?.message || err || 'unknown').slice(0, 140);
  track('Error', { where, message });
}

function script(src, attrs) {
  const s = document.createElement('script');
  s.src = src;
  s.defer = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}
