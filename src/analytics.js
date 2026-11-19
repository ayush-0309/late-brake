// Analytics and error reports, off unless CONFIG.analytics is set. Nothing
// personal: event names and a few plain values (circuit, camera, lap valid
// or not), sent to Plausible, GoatCounter or Microsoft Clarity.

import { CONFIG } from './config.js';

const MAX_ERRORS = 5; // error reports per page load
// Clarity events carry no values, so the one that sorts an event goes in its
// name ("Lap: valid", "Sign in: asked") and a few others go in as tags, for
// filtering recordings by circuit or camera.
const CLARITY_KINDS = ['step', 'result', 'choice', 'medal', 'mode', 'board'];
const CLARITY_TAGS = { track: 'circuit', camera: 'camera', difficulty: 'difficulty' };
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
  } else if (cfg.provider === 'clarity') {
    // Clarity's tag is already in each page's head, and window.clarity
    // queues calls until it has loaded. Pages without it send nothing.
    send = (name, props = {}) => {
      if (typeof window.clarity !== 'function') return;
      for (const [key, tag] of Object.entries(CLARITY_TAGS)) {
        if (props[key]) window.clarity('set', tag, String(props[key]));
      }
      const kind = CLARITY_KINDS.map((k) => props[k]).find(Boolean);
      window.clarity('event', kind ? `${name}: ${kind}` : name);
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
