/**
 * Deleting a thing takes its map marker with it.
 *
 * A marker points at its shop (or its bearer) across a plain text column with
 * no foreign key, so nothing cascades and every delete has to say so itself.
 * Miss one and the map keeps a storefront that opens onto nothing, or a chest
 * riding a token that no longer exists.
 *
 * Run against a server on a throwaway DATA_DIR:
 *   node scripts/check-orphans.mjs http://localhost:3114
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

const dm = await login('shopdm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Shop Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
const objects = new Map();
const removed = new Set();
sock.on('mapObjectUpserted', (p) => objects.set(p.object.id, p.object));
sock.on('mapObjectRemoved', (p) => { removed.add(p.objectId); objects.delete(p.objectId); });

console.log('deleting a shop:');
const shopsReady = waitFor(sock, 'shops', 6000, (p) => p.shops.some((s) => s.name === 'Package 6'));
sock.emit('createShop', { name: 'Package 6' });
const shop = (await shopsReady).shops.find((s) => s.name === 'Package 6');
ok(!!shop, 'the shop exists');

const marker = waitFor(sock, 'mapObjectUpserted', 6000, (p) => p.object.shopId === shop.id);
sock.emit('dropShopOnMap', { shopId: shop.id, mapId, q: 6, r: 6 });
const obj = (await marker).object;
ok(!!obj && obj.kind === 'shop', 'its marker is on the map');

removed.clear();
sock.emit('deleteShop', { shopId: shop.id });
await sleep(700);
ok(removed.has(obj.id), 'deleting the shop removes its marker too');
ok(!objects.has(obj.id), 'nothing is left standing on the map');

console.log('deleting a character that carries a chest:');
const chReady = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.name === 'Mule');
sock.emit('createCharacter', { name: 'Mule', system: 'swade' });
const pc = (await chReady).character;
const packReady = waitFor(sock, 'mapObjectUpserted', 6000, (p) => p.object.name === 'Mule pack');
sock.emit('placeMapObject', { mapId, kind: 'chest', name: 'Mule pack', description: '', q: 9, r: 9 });
const pack = (await packReady).object;
sock.emit('updateMapObject', { objectId: pack.id, patch: { linkedCharacterId: pc.id, items: [{ id: 'a', name: 'Rope', description: '' }] } });
await sleep(300);
removed.clear();
sock.emit('deleteCharacter', { characterId: pc.id });
await sleep(700);
ok(removed.has(pack.id), 'the carried chest goes with them instead of being stranded');

sock.close();
console.log('');
console.log(failures === 0 ? 'shop/character cleanup: all checks passed' : `shop/character cleanup: ${failures} check(s) FAILED`);
// Let closed sockets finish tearing down before exiting -- process.exit
// mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
