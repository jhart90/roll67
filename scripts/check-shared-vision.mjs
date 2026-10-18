/**
 * The DM can lend a character's eyes to every player without lending its
 * reins: a scout drone, a familiar, an ally's lookout. Its tokens become a
 * vision source for the whole table; control does not move.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-shared-vision.mjs http://localhost:3103
 */
import { io } from 'socket.io-client';
const BASE = process.argv[2] ?? 'http://localhost:3101';
let failures = 0;
const ok = (c, l) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${l}`); if (!c) failures++; };

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function login(u, p) {
  let r = await api('/api/register', { username: u, password: p });
  if (r.status !== 200) r = await api('/api/login', { username: u, password: p });
  return r.data;
}
const connect = (token) => new Promise((res, rej) => {
  const s = io(BASE, { auth: { token } });
  s.on('connect', () => res(s)); s.on('connect_error', (e) => rej(e));
});
function waitFor(socket, event, ms = 6000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout ${event}`)); }, ms);
    function h(p) { if (!filter(p)) return; clearTimeout(t); socket.off(event, h); resolve(p); }
    socket.on(event, h);
  });
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// shared/src/hex/pack.ts
const packHex = (h) => ((h.q + 2048) << 12) | (h.r + 2048);

const dm = await login('visiondm', 'test1234');
const pl = await login('visionpl', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Shared Vision', system: 'swade' }, dm.token)).data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pl.token);

const dmSock = await connect(dm.token);
const plSock = await connect(pl.token);
const plErrors = [];
dmSock.on('errorMsg', (e) => console.log('      [server error -> dm]', JSON.stringify(e)));
plSock.on('errorMsg', (e) => plErrors.push(JSON.stringify(e)));
const st = waitFor(dmSock, 'campaignState');
dmSock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;

// The player's current view, kept live.
let visible = new Set();
let seenTokens = new Map();
plSock.on('mapState', (p) => { if (p.visible) visible = new Set(p.visible); seenTokens = new Map(p.tokens.map((t) => [t.id, t])); });
plSock.on('visionUpdate', (p) => {
  if (p.mapId !== mapId) return;
  visible = new Set(p.visible);
  if (Array.isArray(p.tokens)) seenTokens = new Map(p.tokens.map((t) => [t.id, t]));
});
plSock.on('tokenUpserted', (p) => seenTokens.set(p.token.id, p.token));
plSock.on('tokenRemoved', (p) => seenTokens.delete(p.tokenId));
const joined = waitFor(plSock, 'mapState');
plSock.emit('joinCampaign', { campaignId: camp.id });
await joined;

const make = async (name, extra = {}) => {
  const w = waitFor(dmSock, 'characterUpserted', 6000, (p) => p.character.name === name);
  dmSock.emit('createCharacter', { name, system: 'swade', ...extra });
  return (await w).character;
};
const place = async (name, q, r, characterId) => {
  const w = waitFor(dmSock, 'tokenUpserted', 6000, (p) => p.token.name === name);
  dmSock.emit('createToken', { mapId, name, q, r, layer: 'token', characterId });
  return (await w).token;
};

// The player's hero in one corner; a scout the DM runs, far across the map
// (well past even daylight's 40-hex sight).
const hero = await make('Hero', { ownerUserId: pl.user.id });
await place('Hero', 2, 2, hero.id);
const scout = await make('Scout');
const scoutTok = await place('Scout', 25, 40, scout.id);
const scoutHex = packHex({ q: 25, r: 40 });
await pause(1500);

ok(!visible.has(scoutHex), 'before: the player cannot see the scout’s far corner');

// The DM shares the scout's sight.
const shared = waitFor(dmSock, 'characterUpserted', 6000, (p) => p.character.id === scout.id && p.character.sheet.sharedVision === true);
dmSock.emit('updateCharacter', { characterId: scout.id, patch: { sharedVision: true } });
await shared;
await pause(1500);
ok(visible.has(scoutHex), 'shared: the player now sees through the scout');
ok(visible.has(packHex({ q: 27, r: 40 })), 'and around it, not just its own hex');
ok(seenTokens.has(scoutTok.id), 'and sees the scout token itself');

// Seeing is not steering.
const before = { q: scoutTok.q, r: scoutTok.r };
plSock.emit('moveToken', { tokenId: scoutTok.id, q: 26, r: 40 });
await pause(1200);
const dmView = await new Promise((res) => {
  dmSock.once('mapState', (p) => res(p.tokens.find((t) => t.id === scoutTok.id)));
  dmSock.emit('viewMap', { mapId });
}).catch(() => null);
ok(!dmView || (dmView.q === before.q && dmView.r === before.r), 'the player still cannot move the scout');

// A player cannot hand out shared sight, even on their own hero.
plSock.emit('updateCharacter', { characterId: hero.id, patch: { sharedVision: true, notes: 'x' } });
await pause(1200);
const heroNow = await new Promise((res) => {
  dmSock.once('characterUpserted', (p) => res(p.character));
  dmSock.emit('updateCharacter', { characterId: hero.id, patch: {} });
}).catch(() => null);
ok(heroNow && heroNow.sheet.sharedVision !== true, 'a player’s own sharedVision edit is ignored');

// And the DM can take it back.
const unshared = waitFor(dmSock, 'characterUpserted', 6000, (p) => p.character.id === scout.id && p.character.sheet.sharedVision === false);
dmSock.emit('updateCharacter', { characterId: scout.id, patch: { sharedVision: false } });
await unshared;
await pause(1500);
ok(!visible.has(scoutHex), 'unshared: the scout’s corner goes dark for the player again');

dmSock.close(); plSock.close();
console.log('');
console.log(failures === 0 ? 'shared vision: all checks passed' : `shared vision: ${failures} check(s) FAILED`);
await pause(300);
process.exit(failures ? 1 : 0);
