// Lobby for online races: a room code to share, who's in, and (for the
// host, the first to arrive) whether to fill the grid with AI and when to
// start. Signed-in players only.

import { createRoom, newRoomCode, MAX_PLAYERS } from './net.js';
import { RIVALS } from './race.js';
import { rivalPaint } from './medals.js';
import { track } from './analytics.js';

// Car colours by grid slot, for AI cars and drivers in the free red. You see
// your own car in your colour, and other drivers in theirs.
const COLORS = ['#ff8000', '#00a19b', '#2b4bd4', '#f5c542'];

// game: { onlineUI, colour(), selected(), select(trackById), settings, startOnline(start, room, me, host), toast, openAccount() }
export function createLobby(game) {
  const $ = (id) => document.getElementById(id);
  let room = null, me = null, code = null, peers = [], racing = false, session = null;

  async function open(roomCode) {
    const online = await game.onlineUI.ready;
    if (!online) return;
    if (!online.user?.name) {
      game.toast('Online race', 'Sign in first', 'Racing online needs a driver name', 'info');
      game.openAccount();
      return;
    }
    leave();
    me = { id: online.user.id, name: online.user.name };
    code = (roomCode || newRoomCode()).toUpperCase();
    room = createRoom(code, me, online.db);
    room.onPeers(onPeers);
    room.on('start', onStart);
    $('lobbyCode').textContent = code;
    $('lobbyStatus').textContent = 'Connecting…';
    $('lobbyPlayers').innerHTML = '';
    $('lobby').hidden = false;
    try {
      await room.join({ id: me.id, name: me.name, joinedAt: Date.now(), track: game.selected().id, colour: game.colour().id });
      track('Online lobby', { step: roomCode ? 'joined' : 'created' });
    } catch (err) {
      $('lobbyStatus').textContent = err.message;
    }
  }

  function onPeers(list) {
    peers = list.slice().sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    // Someone dropped out mid-race.
    if (racing && session) for (const g of session.opts.online.start.grid) if (!g.ai && !peers.some((p) => p.id === g.id)) session.markLeft(g.id);
    if (racing) return;
    const mine = peers.findIndex((p) => p.id === me.id);
    if (mine >= MAX_PLAYERS) {
      leave();
      game.toast('Online race', 'Room full', `Up to ${MAX_PLAYERS} drivers per race`, 'info');
      return;
    }
    render();
  }

  const isHost = () => peers[0]?.id === me?.id;

  function render() {
    const host = isHost();
    const t = game.selected();
    $('lobbyTrack').textContent = host ? t.name : (game.trackById(peers[0]?.track)?.name || t.name);
    $('lobbyPlayers').innerHTML = peers.slice(0, MAX_PLAYERS).map((p, i) =>
      `<li><span class="c" style="background:${p.id === me.id ? game.colour().paint : rivalPaint(p.colour, game.colour(), COLORS[i])}"></span><span class="n">${escapeHtml(p.name)}${p.id === me.id ? ' (you)' : ''}</span>${i === 0 ? '<span class="tag">Host</span>' : ''}</li>`).join('');
    const ai = $('lobbyAi').checked ? MAX_PLAYERS - Math.min(peers.length, MAX_PLAYERS) : 0;
    $('lobbyAiNote').textContent = ai ? `+ ${ai} AI driver${ai > 1 ? 's' : ''}` : '';
    $('lobbyHostOnly').hidden = !host;
    const enough = peers.length >= 2 || $('lobbyAi').checked;
    $('lobbyStart').hidden = !host;
    $('lobbyStart').disabled = !enough;
    $('lobbyStatus').textContent = host
      ? (enough ? `${game.settings.raceLaps} laps on ${t.name}. Start when everyone's in.` : 'Waiting for another driver, or turn on AI drivers.')
      : 'Waiting for the host to start…';
  }

  // Host: everyone gets the same grid and settings.
  function start() {
    if (!isHost()) return;
    const humans = peers.slice(0, MAX_PLAYERS).map((p, i) => ({ id: p.id, name: p.name, color: COLORS[i], colour: p.colour }));
    const ai = $('lobbyAi').checked
      ? RIVALS.slice(0, MAX_PLAYERS - humans.length).map((r, k) => ({ id: `ai-${k}`, name: r.name, color: COLORS[humans.length + k], ai: true }))
      : [];
    const msg = {
      track: game.selected().id, laps: game.settings.raceLaps, difficulty: game.settings.difficulty,
      grid: [...ai, ...humans], // AI on the front rows, players behind
    };
    room.send('start', msg);
    onStart(msg, true);
  }

  function onStart(msg, mine = false) {
    if (!msg.grid.some((g) => g.id === me.id)) {
      $('lobbyStatus').textContent = 'A race started without you. Wait for the next one.';
      return;
    }
    racing = true;
    $('lobby').hidden = true;
    track('Online race', { step: 'start', players: String(msg.grid.filter((g) => !g.ai).length) });
    // Everyone paints the other drivers here, against their own colour.
    const grid = msg.grid.map((g) => (g.ai ? g : { ...g, color: rivalPaint(g.colour, game.colour(), g.color) }));
    session = game.startOnline({ ...msg, grid }, room, me, mine || isHost());
  }

  function leave() {
    room?.leave();
    room = null;
    racing = false;
    session = null;
    peers = [];
    $('lobby').hidden = true;
  }

  $('lobbyStart').addEventListener('click', start);
  $('lobbyLeave').addEventListener('click', leave);
  $('lobbyAi').addEventListener('change', render);
  $('lobbyInvite').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Late Brake', text: `Race me in Late Brake: room ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        game.toast('Invite link copied', code, 'Friends join your room straight away', 'info');
      }
    } catch {}
  });
  $('lobbyJoin').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = $('lobbyJoinCode').value.trim().toUpperCase();
    if (/^[A-Z]{5}$/.test(c)) open(c);
  });

  // play.html?room=CODE joins that room once signed in.
  (async () => {
    const c = new URLSearchParams(location.search).get('room');
    if (!c) return;
    const online = await game.onlineUI.ready;
    if (online?.user?.name) open(c);
    else online?.onUser((u) => { if (u?.name && !room) open(c); });
  })();

  return {
    open,
    leave,
    get inRace() { return racing; },
    // A finished race back to the lobby: same room, next race.
    backToLobby() {
      racing = false;
      session = null;
      if (room) { $('lobby').hidden = false; render(); }
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
