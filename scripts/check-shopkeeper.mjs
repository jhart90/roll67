/**
 * Talking to a shopkeeper you can actually reach.
 *
 * Clicking a merchant's token opens their shop, but only from within earshot
 * -- four hexes, the twenty feet the rule is written in. The range is checked
 * on the SERVER, because the browser had been opening these outright from
 * anywhere on the map.
 *
 * Run against a server on a throwaway DATA_DIR:
 *   node scripts/check-shopkeeper.mjs http://localhost:3116
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

const dm = await login('keepdm', 'test1234');
const pl = await login('keepplayer', 'test1234');
const playerId = pl.user?.id ?? pl.userId ?? pl.id;
const camp = (await api('/api/campaigns', { name: 'Keeper Test', system: 'swade' }, dm.token)).data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pl.token);

const dms = await connect(dm.token);
const dst = waitFor(dms, 'campaignState');
dms.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await dst).campaign.activeMapId;

const pls = await connect(pl.token);
const pst = waitFor(pls, 'campaignState');
pls.emit('joinCampaign', { campaignId: camp.id });
await pst;

// A shopkeeper NPC, and the player's own character standing near her.
const npcReady = waitFor(dms, 'characterUpserted', 6000, (p) => p.character.name === 'Tiaa');
dms.emit('createCharacter', { name: 'Tiaa', system: 'swade' });
const npc = (await npcReady).character;
const pcReady = waitFor(dms, 'characterUpserted', 6000, (p) => p.character.name === 'Buyer');
dms.emit('createCharacter', { name: 'Buyer', system: 'swade', ownerUserId: playerId });
const pc = (await pcReady).character;

const t1 = waitFor(dms, 'tokenUpserted', 6000, (p) => p.token.name === 'Tiaa tok');
dms.emit('createToken', { mapId, name: 'Tiaa tok', q: 10, r: 10, layer: 'token', characterId: npc.id });
const npcTok = (await t1).token;
const t2 = waitFor(dms, 'tokenUpserted', 6000, (p) => p.token.name === 'Buyer tok');
dms.emit('createToken', { mapId, name: 'Buyer tok', q: 12, r: 10, layer: 'token', characterId: pc.id });
const pcTok = (await t2).token;

// A brand new shop, with nothing switched on afterwards: players should be
// able to buy from it already.
const playerSees = waitFor(pls, 'shops', 6000, (p) => p.shops.some((s) => s.name === "Tiaa's Food Stall")).catch(() => null);
const shopReady = waitFor(dms, 'shops', 6000, (p) => p.shops.some((s) => s.name === "Tiaa's Food Stall"));
dms.emit('createShop', { name: "Tiaa's Food Stall" });
const shop = (await shopReady).shops.find((s) => s.name === "Tiaa's Food Stall");
console.log('a shop the DM just made:');
ok(!!(await playerSees), 'reaches players without the DM ticking anything');
ok(shop.playersCanBuy === true, 'and says it is open to them', `playersCanBuy=${shop.playersCanBuy}`);
// Nested under its owner in the world tree, which is how the tree already
// shows a merchant and their stall and so what a DM reaches for first.
dms.emit('updateShop', { shopId: shop.id, playersCanBuy: true, parentId: npc.id });
await sleep(400);

console.log('within speaking range (2 hexes):');
{
  const opened = waitFor(pls, 'openShop', 4000).catch(() => null);
  const refused = waitFor(pls, 'errorMsg', 2500).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npcTok.id });
  const [o, r] = await Promise.all([opened, refused]);
  ok(o?.shopId === shop.id, 'clicking the shopkeeper opens her shop', o ? 'opened' : 'nothing came back');
  ok(r === null, 'and nothing is refused');
}

console.log('well out of earshot (10 hexes):');
{
  dms.emit('moveToken', { tokenId: pcTok.id, q: 20, r: 10, drag: true });
  await sleep(500);
  const opened = waitFor(pls, 'openShop', 2500).catch(() => null);
  const refused = waitFor(pls, 'errorMsg', 2500).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npcTok.id });
  const [o, r] = await Promise.all([opened, refused]);
  ok(o === null, 'the shop does not open from across the map');
  ok(!!r && /too far away to talk/i.test(r.message ?? ''), 'and says why', r?.message ?? 'silence');
}

console.log('the edge of earshot:');
{
  // Four hexes is the twenty feet the rule is written in; five is not.
  dms.emit('moveToken', { tokenId: pcTok.id, q: 14, r: 10, drag: true });
  await sleep(500);
  const at4 = waitFor(pls, 'openShop', 2500).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npcTok.id });
  ok(!!(await at4), 'exactly 4 hexes away still counts as talking distance');

  dms.emit('moveToken', { tokenId: pcTok.id, q: 15, r: 10, drag: true });
  await sleep(500);
  const at5 = waitFor(pls, 'openShop', 2000).catch(() => null);
  const no5 = waitFor(pls, 'errorMsg', 2000).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npcTok.id });
  const [o5, r5] = await Promise.all([at5, no5]);
  ok(o5 === null && !!r5, 'one hex further is out of earshot');
}

console.log('a plain NPC with nothing to sell:');
{
  const b1 = waitFor(dms, 'characterUpserted', 6000, (p) => p.character.name === 'Bystander');
  dms.emit('createCharacter', { name: 'Bystander', system: 'swade' });
  const by = (await b1).character;
  const b2 = waitFor(dms, 'tokenUpserted', 6000, (p) => p.token.name === 'Bystander tok');
  dms.emit('createToken', { mapId, name: 'Bystander tok', q: 20, r: 11, layer: 'token', characterId: by.id });
  const byTok = (await b2).token;
  const opened = waitFor(pls, 'openShop', 2000).catch(() => null);
  const refused = waitFor(pls, 'errorMsg', 2000).catch(() => null);
  pls.emit('shopAtToken', { tokenId: byTok.id });
  const [o, r] = await Promise.all([opened, refused]);
  ok(o === null && r === null, 'clicking them is silent, not an error');
}

console.log('the other way of attaching a shop still works:');
{
  // Dragged onto the token on the map, which sets linkedCharacterId instead.
  const n2 = waitFor(dms, 'characterUpserted', 6000, (p) => p.character.name === 'Nebamun');
  dms.emit('createCharacter', { name: 'Nebamun', system: 'swade' });
  const npc2 = (await n2).character;
  const t3 = waitFor(dms, 'tokenUpserted', 6000, (p) => p.token.name === 'Nebamun tok');
  dms.emit('createToken', { mapId, name: 'Nebamun tok', q: 20, r: 12, layer: 'token', characterId: npc2.id });
  const npc2Tok = (await t3).token;
  const s2 = waitFor(dms, 'shops', 6000, (p) => p.shops.some((x) => x.name === "Nebamun's Cloth"));
  dms.emit('createShop', { name: "Nebamun's Cloth" });
  const shop2 = (await s2).shops.find((x) => x.name === "Nebamun's Cloth");
  dms.emit('updateShop', { shopId: shop2.id, playersCanBuy: true, linkedCharacterId: npc2.id });
  dms.emit('moveToken', { tokenId: pcTok.id, q: 20, r: 13, drag: true });
  await sleep(600);
  const opened = waitFor(pls, 'openShop', 3000).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npc2Tok.id });
  ok((await opened)?.shopId === shop2.id, 'a shop dragged onto a token opens too');
}

console.log('a shop the DM has not opened to players:');
{
  dms.emit('updateShop', { shopId: shop.id, playersCanBuy: false });
  dms.emit('moveToken', { tokenId: pcTok.id, q: 12, r: 10, drag: true });
  await sleep(600);
  const opened = waitFor(pls, 'openShop', 2000).catch(() => null);
  const refused = waitFor(pls, 'errorMsg', 2000).catch(() => null);
  pls.emit('shopAtToken', { tokenId: npcTok.id });
  const [o, r] = await Promise.all([opened, refused]);
  ok(o === null && r === null, 'stays shut, and silent about why');
}

dms.close(); pls.close();
console.log('');
console.log(failures === 0 ? 'shopkeeper clicks: all checks passed' : `shopkeeper clicks: ${failures} check(s) FAILED`);
// Let closed sockets finish tearing down before exiting -- process.exit
// mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
