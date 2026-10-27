// Rooms for online races: who's here (presence) and messages between them
// (broadcast). Two transports with the same interface:
//   Supabase Realtime, for real play (needs CONFIG.supabase);
//   BroadcastChannel between tabs of one browser, for trying it locally
//   (?net=local).
//
// room.join(meta) · room.onPeers(fn(list)) · room.on(event, fn(payload)) ·
// room.send(event, payload) · room.leave()

export const MAX_PLAYERS = 4;
const EVENTS = ['state', 'start', 'chat'];

export function createRoom(code, me, db) {
  return new URLSearchParams(location.search).get('net') === 'local' || !db
    ? localRoom(code, me)
    : supabaseRoom(code, me, db);
}

function supabaseRoom(code, me, db) {
  const handlers = new Map();
  let peersFn = () => {};
  const ch = db.channel(`latebrake:${code}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me.id } },
  });
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState();
    peersFn(Object.values(state).map((metas) => metas[0]).filter(Boolean));
  });
  for (const ev of EVENTS) {
    ch.on('broadcast', { event: ev }, ({ payload }) => handlers.get(ev)?.(payload));
  }
  return {
    join(meta) {
      return new Promise((resolve, reject) => {
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await ch.track(meta);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error('Could not reach the race server'));
          }
        });
      });
    },
    onPeers(fn) { peersFn = fn; },
    on(ev, fn) { handlers.set(ev, fn); },
    send(ev, payload) { ch.send({ type: 'broadcast', event: ev, payload }); },
    update(meta) { ch.track(meta); },
    leave() { db.removeChannel(ch); },
  };
}

// Tabs of the same browser: presence by heartbeat, peers expire when quiet.
function localRoom(code, me) {
  const bc = new BroadcastChannel(`latebrake:${code}`);
  const handlers = new Map();
  const peers = new Map(); // id -> { meta, seen }
  let peersFn = () => {};
  let mine = null;
  let beat = 0;
  const publish = () => peersFn([mine, ...[...peers.values()].map((p) => p.meta)].filter(Boolean));
  bc.onmessage = ({ data }) => {
    if (data.kind === 'hello' || data.kind === 'beat') {
      const known = peers.has(data.meta.id);
      peers.set(data.meta.id, { meta: data.meta, seen: performance.now() });
      if (data.kind === 'hello' && mine) bc.postMessage({ kind: 'beat', meta: mine });
      if (!known || data.kind === 'hello') publish();
    } else if (data.kind === 'bye') {
      peers.delete(data.id);
      publish();
    } else if (data.kind === 'msg') {
      handlers.get(data.ev)?.(data.payload);
    }
  };
  return {
    async join(meta) {
      mine = meta;
      bc.postMessage({ kind: 'hello', meta });
      publish();
      beat = setInterval(() => {
        bc.postMessage({ kind: 'beat', meta: mine });
        const now = performance.now();
        let changed = false;
        for (const [id, p] of peers) if (now - p.seen > 3500) { peers.delete(id); changed = true; }
        if (changed) publish();
      }, 1000);
    },
    onPeers(fn) { peersFn = fn; },
    on(ev, fn) { handlers.set(ev, fn); },
    send(ev, payload) { bc.postMessage({ kind: 'msg', ev, payload }); },
    update(meta) { mine = meta; bc.postMessage({ kind: 'beat', meta }); publish(); },
    leave() {
      clearInterval(beat);
      bc.postMessage({ kind: 'bye', id: me.id });
      bc.close();
    },
  };
}

// Five letters, no look-alikes (no I, L, O, 0, 1).
export function newRoomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
