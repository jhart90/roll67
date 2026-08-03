// Multiplayer load probe: 1 DM + N players against a running server.
// Usage: node scripts/load-test.mjs [baseUrl] [players]
// Measures broadcast fan-out latency (token moves), chat delivery under a
// simultaneous burst, and roll throughput with everyone throwing dice at once.
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:3210';
const N_PLAYERS = Number(process.argv[3] ?? 6);

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(username, password) {
  let r = await api('/api/register', { username, password });
  if (r.status !== 200) r = await api('/api/login', { username, password });
  if (r.status !== 200) throw new Error(`cannot login ${username}: ${JSON.stringify(r.data)}`);
  return r.data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(new Error(`socket auth failed: ${e.message}`)));
  });
}

function waitFor(socket, event, timeoutMs = 8000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (label, arr) =>
  console.log(`  ${label}: n=${arr.length} p50=${pct(arr, 50).toFixed(1)}ms p95=${pct(arr, 95).toFixed(1)}ms max=${Math.max(...arr, 0).toFixed(1)}ms`);

async function main() {
  console.log(`load test vs ${BASE} — 1 DM + ${N_PLAYERS} players`);

  // ---- accounts + campaign ----
  const dm = await login('loaddm', 'test1234');
  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) players.push(await login(`loadp${i + 1}`, 'test1234'));
  const camp = (await api('/api/campaigns', { name: 'Load Campaign', system: 'swade' }, dm.token)).data.campaign;
  for (const p of players) await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, p.token);

  // ---- sockets ----
  const t0 = performance.now();
  const dmSock = await connect(dm.token);
  const dmJoined = waitFor(dmSock, 'campaignState');
  dmSock.emit('joinCampaign', { campaignId: camp.id });
  const dmCampaignState = await dmJoined;
  const pSocks = [];
  for (const p of players) {
    const s = await connect(p.token);
    const joined = waitFor(s, 'campaignState');
    s.emit('joinCampaign', { campaignId: camp.id });
    await joined;
    pSocks.push(s);
  }
  console.log(`  join: all ${N_PLAYERS + 1} clients connected + joined in ${(performance.now() - t0).toFixed(0)}ms`);

  // ---- use the campaign's starter map (already active for everyone) ----
  const mapId = dmCampaignState.campaign.activeMapId ?? dmCampaignState.maps[0].id;

  // One owned character + token per player — the realistic table shape, and
  // token vision is what makes move broadcasts flow at all.
  const pTokens = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const chMade = waitFor(dmSock, 'characterUpserted', 8000, (m) => m.character?.name === `LoadChar ${i + 1}`);
    dmSock.emit('createCharacter', { name: `LoadChar ${i + 1}`, system: 'swade', ownerUserId: players[i].user.id });
    const ch = (await chMade).character;
    const tokMade = waitFor(dmSock, 'tokenUpserted', 8000, (m) => m.token?.characterId === ch.id);
    dmSock.emit('createToken', { mapId, q: 4 + i * 2, r: 8, characterId: ch.id, layer: 'token' });
    pTokens.push((await tokMade).token);
  }
  await new Promise((r) => setTimeout(r, 800));

  // ---- 1) concurrent token moves: all players move at once, DM receives ----
  const moveLat = [];
  const MOVES = 15;
  for (let i = 0; i < MOVES; i++) {
    const r2 = 8 + ((i % 6) + 1);
    const burst = pSocks.map((s, pi) => {
      const dmSees = waitFor(dmSock, 'tokenMoved', 8000, (m) => m.tokenId === pTokens[pi].id && m.r === r2);
      const t = performance.now();
      s.emit('moveToken', { tokenId: pTokens[pi].id, q: 4 + pi * 2, r: r2 });
      return dmSees.then(() => moveLat.push(performance.now() - t));
    });
    await Promise.all(burst);
  }
  stats(`${N_PLAYERS} players moving simultaneously (per-move round-trip)`, moveLat);

  // ---- 2) chat burst: everyone talks at once, 5 rounds ----
  const chatLat = [];
  for (let round = 0; round < 5; round++) {
    const sends = [dmSock, ...pSocks].map((s, si) => {
      const marker = `burst-${round}-${si}-${Math.floor(performance.now())}`;
      const everyone = [dmSock, ...pSocks].map((r) => waitFor(r, 'chatMsg', 10000, (m) => m.msg?.text === marker));
      const t = performance.now();
      s.emit('chat', { text: marker });
      return Promise.all(everyone).then(() => chatLat.push(performance.now() - t));
    });
    await Promise.all(sends);
  }
  stats(`chat burst (${N_PLAYERS + 1} simultaneous senders → all)`, chatLat);

  // ---- 3) dice burst: everyone rolls at once, 5 rounds ----
  const rollLat = [];
  for (let round = 0; round < 5; round++) {
    const sends = [dmSock, ...pSocks].map((s, si) => {
      const label = `load ${round}-${si}`;
      const everyone = [dmSock, ...pSocks].map((r) => waitFor(r, 'chatMsg', 10000, (m) => m.msg?.text === label && m.msg?.roll));
      const t = performance.now();
      s.emit('chat', { text: `/r 2d6+1d8 # ${label}` });
      return Promise.all(everyone).then(() => rollLat.push(performance.now() - t));
    });
    await Promise.all(sends);
  }
  stats(`roll burst (${N_PLAYERS + 1} simultaneous rollers → all)`, rollLat);

  // ---- 4) sustained mixed load: 20s of continuous traffic ----
  let recv = 0;
  for (const s of [dmSock, ...pSocks]) s.on('chatMsg', () => recv++);
  const mixed = [];
  const t1 = performance.now();
  let sent = 0;
  while (performance.now() - t1 < 10_000) {
    const s = pSocks[sent % pSocks.length];
    const marker = `mix-${sent}`;
    const w = waitFor(dmSock, 'chatMsg', 10000, (m) => m.msg?.text?.includes(marker));
    const t = performance.now();
    s.emit('chat', { text: sent % 3 === 0 ? `/r 1d20 # ${marker}` : `chatter ${marker}` });
    await w;
    mixed.push(performance.now() - t);
    sent++;
  }
  stats(`sustained serial traffic (${sent} msgs over 10s)`, mixed);
  console.log(`  throughput: ${(sent / 10).toFixed(1)} msg/s serial round-trip; ${recv} total deliveries`);

  // ---- cleanup ----
  await new Promise((r) => setTimeout(r, 200));
  for (const s of [dmSock, ...pSocks]) s.close();
  console.log('done');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
