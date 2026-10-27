// Web game portals: ad breaks and gameplay events. On our own site there are
// no ads and every call resolves at once. The portal is detected from where
// the game is hosted, or forced with ?platform=crazygames|poki|test.
//
// Portal SDKs (check their docs when submitting, APIs change):
//   CrazyGames v3: https://docs.crazygames.com
//   Poki v2:       https://developers.poki.com/guide/sdk-html5

import { CONFIG } from './config.js';

const SDK_URL = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};
const TEST_GAP = 60; // seconds between pretend ad breaks in test mode

export function detectPlatform() {
  const forced = new URLSearchParams(location.search).get('platform') || CONFIG.platform;
  if (forced) return forced;
  const where = `${location.hostname} ${document.referrer}`;
  if (/crazygames\./.test(where)) return 'crazygames';
  if (/poki(-gdn)?\./.test(where)) return 'poki';
  return 'none';
}

// `onAdStart` / `onAdEnd`: mute and pause the game around an ad.
export function createPlatform({ onAdStart = () => {}, onAdEnd = () => {} } = {}) {
  const name = detectPlatform();
  let sdk = null;          // the portal's API once loaded, null otherwise
  let playing = false;
  let lastTestBreak = -Infinity;

  const ready = (async () => {
    if (!SDK_URL[name]) return;
    try {
      await loadScript(SDK_URL[name]);
      if (name === 'crazygames') {
        await window.CrazyGames.SDK.init();
        sdk = window.CrazyGames.SDK;
      } else if (name === 'poki') {
        await window.PokiSDK.init();
        sdk = window.PokiSDK;
      }
    } catch (err) {
      // Ad blockers often stop the SDK; the game must still work without it.
      console.warn('Ad SDK unavailable', err);
      sdk = null;
    }
  })();

  function gameplayStart() {
    if (playing) return;
    playing = true;
    if (name === 'crazygames') sdk?.game.gameplayStart();
    if (name === 'poki') sdk?.gameplayStart();
  }

  function gameplayStop() {
    if (!playing) return;
    playing = false;
    if (name === 'crazygames') sdk?.game.gameplayStop();
    if (name === 'poki') sdk?.gameplayStop();
  }

  // A chance for an ad at a natural break (between runs). The portal decides
  // whether one actually plays. Resolves when the game may continue.
  async function commercialBreak() {
    await ready;
    if (name === 'test') {
      if (performance.now() / 1000 - lastTestBreak < TEST_GAP) return;
      lastTestBreak = performance.now() / 1000;
      return withAd(() => pretendAd('Ad break', false));
    }
    if (!sdk) return;
    if (name === 'poki') return withAd(() => sdk.commercialBreak());
    if (name === 'crazygames') return withAd(() => crazyAd('midgame'));
  }

  // An ad the player chose to watch for a reward. Resolves true only if it
  // played to the end.
  async function rewardedBreak() {
    await ready;
    if (name === 'test') return withAd(() => pretendAd('Rewarded ad', true));
    if (!sdk) return false;
    if (name === 'poki') return withAd(() => sdk.rewardedBreak());
    if (name === 'crazygames') return withAd(() => crazyAd('rewarded'));
    return false;
  }

  async function withAd(show) {
    const was = playing;
    gameplayStop();
    onAdStart();
    try {
      return await show();
    } catch {
      return false;
    } finally {
      onAdEnd();
      if (was) gameplayStart();
    }
  }

  function crazyAd(type) {
    return new Promise((resolve) => {
      sdk.ad.requestAd(type, {
        adStarted: () => {},
        adFinished: () => resolve(true),
        adError: () => resolve(false), // also when no ad was available
      });
    });
  }

  return {
    name,
    ready,
    // Rewarded ads exist on the portals and in test mode, not on our own site.
    get rewardedAvailable() { return name === 'test' || !!sdk; },
    loadingFinished() {
      ready.then(() => {
        if (name === 'crazygames') sdk?.game.loadingStop?.();
        if (name === 'poki') sdk?.gameLoadingFinished();
      });
    },
    gameplayStart,
    gameplayStop,
    commercialBreak,
    rewardedBreak,
    // A moment worth celebrating (a new best lap); some portals use it.
    happyTime() {
      if (name === 'crazygames') sdk?.game.happytime?.();
    },
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Test mode: a full-screen stand-in for an ad with a countdown. Rewarded
// ones can be closed early, which forfeits the reward.
function pretendAd(title, rewarded) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'test-ad';
    el.innerHTML = `<div><b>${title}</b><span>Test mode: a real ad plays here on the portal.</span><em>3</em>${rewarded ? '<button type="button">Close (no reward)</button>' : ''}</div>`;
    document.body.appendChild(el);
    let left = 3;
    const done = (ok) => { clearInterval(timer); el.remove(); resolve(ok); };
    const timer = setInterval(() => {
      left--;
      if (left <= 0) done(true);
      else el.querySelector('em').textContent = left;
    }, 1000);
    el.querySelector('button')?.addEventListener('click', () => done(false));
  });
}
