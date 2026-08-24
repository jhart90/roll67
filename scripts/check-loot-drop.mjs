/**
 * A DM-run body puts what it was carrying on the floor.
 *
 * Covers the shape of the rule rather than one path through it: one item and
 * three items scatter into their own adjacent hexes, four collapse into a
 * single chest set down whole, a player's pack is never touched, and both
 * routes to death -- a sheet edit and the DM calling it outright -- trigger
 * it, because they run through different code and only one of them used to.
 *
 * Run against a server on a throwaway DATA_DIR:
 *   node scripts/check-loot-drop.mjs http://localhost:3111
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

const dm = await login('lootdm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Loot Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;

let nextOrigin = 5;
const objects = new Map();
sock.on('mapObjectUpserted', (p) => objects.set(p.object.id, p.object));
const removed = new Set();
sock.on('mapObjectRemoved', (p) => { removed.add(p.objectId); objects.delete(p.objectId); });

/** Build an unowned NPC with a body chest holding `n` items, then kill it. */
async function scenario(label, n, ownerUserId, how = 'sheet') {
  objects.clear();
  const chReady = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.name === label);
  sock.emit('createCharacter', { name: label, system: 'swade', ...(ownerUserId !== undefined ? { ownerUserId } : {}) });
  const pc = (await chReady).character;

  // Well clear of the previous scenario's drops: a body whose neighbours are
  // already full correctly falls back to a chest, which would quietly mask
  // whichever branch this scenario meant to exercise.
  const q = nextOrigin, r = 10;
  nextOrigin += 6;
  const tReady = waitFor(sock, 'tokenUpserted', 6000, (p) => p.token.name === `${label} tok`);
  sock.emit('createToken', { mapId, name: `${label} tok`, q, r, layer: 'token', characterId: pc.id });
  const tok = (await tReady).token;

  const oReady = waitFor(sock, 'mapObjectUpserted', 6000, (p) => p.object.name === `${label} pack`);
  sock.emit('placeMapObject', { mapId, kind: 'chest', name: `${label} pack`, description: '', q, r });
  const chest = (await oReady).object;
  const items = Array.from({ length: n }, (_, i) => ({ id: `it${i}`, name: `${label} loot ${i + 1}`, description: 'x' }));
  sock.emit('updateMapObject', { objectId: chest.id, patch: { items, linkedCharacterId: pc.id } });
  await sleep(250);
  objects.clear();

  if (how === 'incap') {
    // The other route entirely: the DM calls a death on an Incapacitated Wild
    // Card, which lands in persistSheet rather than in a sheet patch.
    sock.emit('updateCharacter', { characterId: pc.id, patch: { conditions: ['incapacitated'] } });
    await sleep(300);
    objects.clear();
    sock.emit('incapDeath', { characterId: pc.id });
  } else {
    sock.emit('updateCharacter', { characterId: pc.id, patch: { conditions: ['dead'] } });
  }
  await sleep(700);

  const bodyHex = { q: tok.q, r: tok.r };
  // Loot on the GROUND is anything holding items that nobody is carrying.
  // Identified that way rather than by id, because the 4+ case sets the body's
  // OWN chest down rather than minting a new one -- filtering by id hid it.
  const seen = [...objects.values()];
  const dropped = seen.filter((o) => o.items.length > 0 && !o.linkedCharacterId);
  const pack = seen.find((o) => o.id === chest.id);
  return { pc, tok, chest, dropped, pack, seen, bodyHex, items };
}

const adj = (a, b) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].some(([x,y]) => x === dq && y === dr);
};

console.log('one item:');
{
  const s = await scenario('Guard1', 1);
  ok(s.dropped.length === 1, 'a single item drops as one standalone pile', `${s.dropped.length} object(s)`);
  ok(s.dropped.every((o) => o.items.length === 1), 'it holds exactly the one item (so it draws as the item, not a crate)');
  ok(s.dropped.every((o) => adj(o, s.bodyHex)), 'it lands in a hex adjacent to the body');
  ok(!!s.pack && s.pack.items.length === 0 && s.pack.linkedCharacterId === s.pc.id,
    'the emptied pack stays on the body rather than being destroyed');
}
console.log('three items:');
{
  const s = await scenario('Guard3', 3);
  ok(s.dropped.length === 3, 'three items drop as three separate piles', `${s.dropped.length} object(s)`);
  const hexes = new Set(s.dropped.map((o) => `${o.q},${o.r}`));
  ok(hexes.size === 3, 'each pile gets its own hex', [...hexes].join(' '));
  ok(s.dropped.every((o) => adj(o, s.bodyHex)), 'all three are adjacent to the body');
  ok(s.dropped.every((o) => o.items.length === 1), 'each pile holds exactly one item');
}
console.log('four items:');
{
  const s = await scenario('Guard4', 4);
  ok(s.dropped.length === 1, 'four items drop as a SINGLE chest', `${s.dropped.length} object(s)`);
  const c = s.dropped[0];
  ok(!!c && c.items.length === 4, 'the chest holds all four', `${c?.items.length}`);
  ok(!!c && adj(c, s.bodyHex), 'the chest is adjacent to the body');
  ok(!!c && !c.linkedCharacterId, 'the chest is no longer carried by the corpse');
}
console.log('a player character:');
{
  const s = await scenario('Hero', 2, dm.user?.id ?? dm.userId ?? dm.id);
  ok(s.dropped.length === 0, 'an OWNED character drops nothing', `${s.dropped.length} object(s)`);
  // Nothing was upserted at all, which is the real claim: the pack was never
  // touched, so the server had no reason to broadcast it.
  ok(s.seen.length === 0, 'their pack is not even rewritten', `${s.seen.length} broadcast(s)`);
}

console.log('killed by the DM calling it, not by a sheet edit:');
{
  const s = await scenario('Wildcard', 2, undefined, 'incap');
  ok(s.dropped.length === 2, 'the other death route drops loot too', `${s.dropped.length} object(s)`);
  ok(s.dropped.every((o) => adj(o, s.bodyHex)), 'both land adjacent to the body');
}

console.log('picking loot up off the ground:')
{
  const s = await scenario('Fallen', 1);
  const pile = s.dropped[0];
  ok(!!pile, 'a pile is on the ground to pick up');
  removed.clear();
  sock.emit('takeChestItem', { objectId: pile.id, itemId: pile.items[0].id });
  await sleep(600);
  ok(removed.has(pile.id), 'taking the last item removes the object entirely');
  ok(!objects.has(pile.id), 'no empty chest is left standing where the item was');
}

console.log('a real chest is not dissolved by being emptied:')
{
  const s = await scenario('Hoarder', 4);
  const chest = s.dropped[0];
  ok(!!chest && chest.items.length === 4, 'a four-item chest is on the ground');
  removed.clear();
  objects.clear();
  sock.emit('takeAllChest', { objectId: chest.id });
  await sleep(900);
  ok(!removed.has(chest.id), 'emptying a genuine chest leaves the chest');
  const after = objects.get(chest.id);
  ok(!!after && after.items.length === 0, 'and it is now empty rather than gone', after ? `${after.items.length} items` : 'missing');
}

console.log("a body's pack survives being emptied:")
{
  const s = await scenario('Pocketed', 2);
  // The pack itself stays linked to the corpse; only what fell is on the floor.
  const pile = s.dropped[0];
  removed.clear();
  sock.emit('takeChestItem', { objectId: pile.id, itemId: pile.items[0].id });
  await sleep(600);
  ok(removed.has(pile.id), 'the dropped pile still vanishes when taken');
  ok(!removed.has(s.chest.id), "the corpse's own pack is never removed", s.chest.id);
}

sock.close();
console.log('');
console.log(failures === 0 ? 'loot drop: all checks passed' : `loot drop: ${failures} check(s) FAILED`);
process.exit(failures ? 1 : 0);
