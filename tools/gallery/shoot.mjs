// Screenshots for store and launch pages (Product Hunt's gallery is 1270 ×
// 760; these are saved at twice that), taken from the game itself in
// headless Chrome while the game's AI drives. Online features are blocked,
// so no real player's name ends up in a picture, and so is Clarity, so the
// shoot doesn't land in the site's recordings.
//
// Needs the dev server (node serve.mjs 5173) and Chrome. Writes to
// launch/gallery/:   node tools/gallery/shoot.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'http://localhost:5173/play.html';
const OUT = fileURLToPath(new URL('../../launch/gallery/', import.meta.url));
const W = 1270, H = 760, SCALE = 2, PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In the page: drive the player's car with the AI from now on (`skill`, and
// it can be changed), and run the session on quickly without drawing.
const HELPERS = `
window.shoot = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  click: (sel) => document.querySelector(sel).click(),
  circuit(name) {
    [...document.querySelectorAll('.track-card')].find((c) => c.textContent.includes(name)).click();
  },
  set(name, value) {
    document.querySelector('[data-setting="' + name + '"] [data-value="' + value + '"]').click();
  },
  async start() {
    document.getElementById('startBtn').click();
    while (!window.lateBrake.session) await this.wait(50);
    return window.lateBrake.session;
  },
  async ai(skill) {
    const { createDriver } = await import('/src/ai.js');
    const { buildLine } = await import('/src/line.js');
    const s = window.lateBrake.session, t = s.track;
    const line = t.line ||= buildLine(t);
    this.driver = createDriver(t, line, skill);
    this.skill = (k) => { this.driver = createDriver(t, line, k); };
    if (!s.step.ai) {
      const step = s.step.bind(s);
      s.step = (inp) => {
        if (s.phase !== 'running' || s.finished) return step(inp);
        const others = (s.opponents || []).map((r) => ({ car: r.car, lat: r.car.lat ?? 0 }));
        const a = this.driver.control(s.car, others, 1 / 60);
        if (a.reset) s.resetToTrack();
        return step({ ...a, sens: 1 });
      };
      s.step.ai = true;
    }
    return s;
  },
  // Steps without drawing until done(s) says so (or a lap limit).
  run(done, quiet = true) {
    const s = window.lateBrake.session;
    for (let k = 0; k < 60 * 900 && !done(s); k++) s.step({ throttle: 0, brake: 0, steer: 0 });
    if (quiet) s.events.length = 0; // no lap toasts for laps nobody watched
  },
};
`;

// Each shot: what to set up in the page before the picture.
const SHOTS = [
  {
    name: '01-race-spa', setup: `
      shoot.circuit('Spa');
      shoot.click('.mode[data-mode="race"]');
      shoot.set('opponents', '3'); shoot.set('difficulty', 'medium'); shoot.set('camera', 'chase'); shoot.set('line', 'off');
      await shoot.start(); await shoot.ai(0.95);
      await shoot.wait(2400 + 7200);`,
  },
  {
    name: '04-cockpit-monaco', setup: `
      shoot.circuit('Monaco');
      shoot.click('.mode[data-mode="trial"]');
      shoot.set('camera', 'cockpit'); shoot.set('line', 'braking');
      const s = await shoot.start(); await shoot.ai(0.97);
      shoot.run((s) => s.laps.length >= 1 && s.lapTime > 21);
      await shoot.wait(1500);`,
  },
  {
    name: '03-ghost-monza', setup: `
      shoot.circuit('Monza');
      shoot.click('.mode[data-mode="trial"]');
      shoot.set('camera', 'chase'); shoot.set('line', 'full'); shoot.set('ghost', 'true');
      // Two laps by a quick driver (the flying one becomes the ghost), then
      // a slower one, so the ghost is clear ahead going into the chicane.
      const s = await shoot.start(); await shoot.ai(0.985);
      shoot.run((s) => s.laps.length >= 2);
      shoot.skill(0.92);
      shoot.run((s) => s.laps.length >= 3 && s.lapTime > 8.5);
      await shoot.wait(1200);`,
  },
  {
    // On the grid with all three lights on, just before GO.
    name: '02-start-silverstone', setup: `
      shoot.circuit('Silverstone');
      shoot.click('.mode[data-mode="race"]');
      shoot.set('opponents', '3'); shoot.set('difficulty', 'medium'); shoot.set('camera', 'chase'); shoot.set('line', 'off');
      const s = await shoot.start();
      while (s.clock < -0.45) await shoot.wait(20);`,
  },
  {
    // With online features blocked the online mode reads "Coming soon"; on
    // latebrake.in it's open, so the picture shows it as it is there.
    name: '05-menu-monaco', setup: `
      shoot.circuit('Monaco');
      shoot.click('.mode[data-mode="trial"]');
      const online = document.querySelector('.mode[data-mode="online"]');
      online.disabled = false;
      online.querySelector('small').textContent = 'Up to 4 drivers';
      await shoot.wait(800);`,
  },
];

// ---------- a little Chrome DevTools Protocol client ----------

async function devtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome never opened its DevTools port');
}

function client(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  };
  const ready = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  return { ready, send, evaluate, close: () => ws.close() };
}

// ---------- the shoot ----------

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'latebrake-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

try {
  const cdp = client(await devtools());
  await cdp.ready;
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*supabase*', '*clarity.ms*'] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  // Just some shots: node tools/gallery/shoot.mjs 03 04
  const only = process.argv.slice(2);
  for (const shot of SHOTS.filter((x) => !only.length || only.some((o) => x.name.startsWith(o)))) {
    // A fresh page each time: a new player's settings, nothing left over.
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await cdp.evaluate('localStorage.clear(); sessionStorage.clear(); true').catch(() => {});
    await cdp.send('Page.navigate', { url: PAGE });
    await sleep(2500);
    await cdp.evaluate('localStorage.clear(); true');
    await cdp.send('Page.reload');
    await sleep(3000);
    await cdp.evaluate(HELPERS);
    await cdp.evaluate(`(async () => { ${shot.setup} })()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    const file = join(OUT, `${shot.name}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`Saved ${file}`);
  }
  cdp.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
