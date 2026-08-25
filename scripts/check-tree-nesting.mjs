/**
 * Placed loot files in the world tree without moving on the map.
 *
 * Two records, one object: where a chest STANDS (map, q, r) and where it is
 * FILED (parentId). Filing it must not disturb standing, and must survive a
 * reload — a tree arrangement that unpicks itself on refresh is worse than no
 * arrangement.
 *
 * Run against a server on a throwaway DATA_DIR:
 *   node scripts/check-tree-nesting.mjs http://localhost:3120
 */
import { io } from 'socket.io-client';
const BASE = process.argv[2];
let failures = 0;
const ok = (c, l, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${l}${d ? ` -- ${d}` : ''}`); if (!c) failures++; };
async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function login(u, p) { let r = await api('/api/register', { username: u, password: p }); if (r.status !== 200) r = await api('/api/login', { username: u, password: p }); return r.data; }
const connect = (t) => new Promise((res, rej) => { const s = io(BASE, { auth: { token: t } }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
function waitFor(sock, ev, ms = 6000, f = () => true) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => { sock.off(ev, h); reject(new Error(`timeout ${ev}`)); }, ms);
    function h(p) { if (!f(p)) return; clearTimeout(t); sock.off(ev, h); resolve(p); } sock.on(ev, h); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dm = await login('nestdm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Nest Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
const objects = new Map();
sock.on('mapObjectUpserted', (p) => objects.set(p.object.id, p.object));

// A folder to file into, and a chest standing on the map.
const folderReady = waitFor(sock, 'worldFolders', 6000, (p) => p.folders.some((f) => f.name === 'Items'));
sock.emit('createWorldFolder', { name: 'Items', parentId: mapId });
const folder = (await folderReady).folders.find((f) => f.name === 'Items');
const chestReady = waitFor(sock, 'mapObjectUpserted', 6000, (p) => p.object.name === 'Wine');
sock.emit('placeMapObject', { mapId, kind: 'chest', name: 'Wine', description: '', q: 5, r: 5 });
const chest = (await chestReady).object;

console.log('filing a chest under a folder:');
ok(chest.parentId == null, 'it starts unfiled, hanging under its map', `parentId=${chest.parentId}`);
sock.emit('updateMapObject', { objectId: chest.id, patch: { parentId: folder.id } });
await sleep(500);
const filed = objects.get(chest.id);
ok(filed?.parentId === folder.id, 'filing it sticks', `parentId=${filed?.parentId}`);
ok(filed?.mapId === mapId && filed?.q === 5 && filed?.r === 5, 'and it has not moved on the map', `${filed?.q},${filed?.r} on ${filed?.mapId === mapId ? 'the same map' : 'A DIFFERENT MAP'}`);

console.log('it survives a reconnect:');
{
  const s2 = await connect(dm.token);
  // Map objects ride along inside mapState rather than an event of their own.
  const got = waitFor(s2, 'mapState', 8000, (p) => Array.isArray(p.mapObjects)).catch(() => null);
  const st2 = waitFor(s2, 'campaignState');
  s2.emit('joinCampaign', { campaignId: camp.id });
  await st2;
  const payload = await got;
  const again = payload?.mapObjects?.find((o) => o.id === chest.id);
  ok(!!again, 'the chest comes back on a fresh join');
  ok(again?.parentId === folder.id, 'still filed where it was put', `parentId=${again?.parentId}`);
  s2.close();
}

console.log('unfiling puts it back:');
sock.emit('updateMapObject', { objectId: chest.id, patch: { parentId: null } });
await sleep(500);
ok(objects.get(chest.id)?.parentId == null, 'back under its map');

sock.close();
console.log('');
console.log(failures === 0 ? 'nesting: all checks passed' : `nesting: ${failures} check(s) FAILED`);
process.exit(failures ? 1 : 0);
