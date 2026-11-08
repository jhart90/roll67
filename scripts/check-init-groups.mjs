/**
 * The DM's drag and drop on the initiative tracker: moving a row by hand
 * (it keeps its value, is marked manualOrder, and holds its place until the
 * DM sorts), grouping rows onto a leader's initiative, the turn staying with
 * whoever has it, a removed leader handing its group on, and players being
 * refused.
 *
 *   node scripts/check-init-groups.mjs http://localhost:3103
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

const dm = await login('initgroupdm', 'test1234');
const pl = await login('initgrouppl', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Init Groups', system: 'dnd5e' }, dm.token)).data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pl.token);
const dmSock = await connect(dm.token);
const plSock = await connect(pl.token);
let st = null;
dmSock.on('initiativeState', (p) => { st = p.state; });
let plSt = null;
plSock.on('initiativeState', (p) => { plSt = p.state; });
const joined = waitFor(dmSock, 'campaignState');
dmSock.emit('joinCampaign', { campaignId: camp.id });
await joined;
plSock.emit('joinCampaign', { campaignId: camp.id });
await pause(800);

for (const [name, value] of [['Chief', 20], ['Robber 1', 15], ['Robber 2', 10], ['Medjay', 5]]) {
  dmSock.emit('initAdd', { name, value });
  await pause(250);
}
await pause(500);
const id = (name) => st.entries.find((e) => e.name === name).id;
const order = () => st.entries.map((e) => e.name).join(', ');
ok(order() === 'Chief, Robber 1, Robber 2, Medjay', `starts in initiative order (${order()})`);

dmSock.emit('initSetActive', { active: true });
await pause(500);
const upFirst = st.entries[st.turnIdx].name;

// (a) Move by hand.
dmSock.emit('initMove', { entryId: id('Medjay'), targetId: id('Chief'), where: 'before' });
await pause(600);
const medjay = st.entries.find((e) => e.name === 'Medjay');
ok(order() === 'Medjay, Chief, Robber 1, Robber 2', `Medjay dropped above Chief (${order()})`);
ok(medjay.manualOrder === true && medjay.value === 5, 'it keeps its own initiative and is marked as moved by hand');
ok(st.entries[st.turnIdx].name === upFirst, `the turn stays with ${upFirst}`);
ok(plSt?.entries[0]?.name === 'Medjay', 'players see the new order');

// (b) Group: Robber 2 onto Robber 1.
dmSock.emit('initMove', { entryId: id('Robber 2'), targetId: id('Robber 1'), where: 'onto' });
await pause(600);
const r2 = st.entries.find((e) => e.name === 'Robber 2');
ok(r2.groupId === id('Robber 1') && r2.value === 15, 'Robber 2 joins Robber 1’s group on its initiative');
// The leader moved carries the group.
dmSock.emit('initMove', { entryId: id('Robber 1'), targetId: id('Medjay'), where: 'before' });
await pause(600);
ok(order() === 'Robber 1, Robber 2, Medjay, Chief', `moving the leader brings its group (${order()})`);

// A newcomer re-sorts the free rows; hand-placed ones hold.
dmSock.emit('initAdd', { name: 'Late Medjay', value: 25 });
await pause(600);
ok(order().startsWith('Robber 1, Robber 2'), `a newcomer does not unseat the hand-placed group (${order()})`);

// Players cannot rearrange.
const before = order();
plSock.emit('initMove', { entryId: id('Chief'), targetId: id('Robber 1'), where: 'before' });
await pause(600);
ok(order() === before, 'a player’s drag is refused');

// Sort lets the values decide again; groups survive it.
dmSock.emit('initSort', {});
await pause(600);
ok(order() === 'Late Medjay, Chief, Robber 1, Robber 2, Medjay', `sort restores initiative order, group intact (${order()})`);
ok(!st.entries.some((e) => e.manualOrder), 'and clears the hand-placed marks');

// Removing the leader hands the group on.
dmSock.emit('initMove', { entryId: id('Medjay'), targetId: id('Robber 1'), where: 'onto' });
await pause(600);
dmSock.emit('initRemove', { entryId: id('Robber 1') });
await pause(600);
const r2b = st.entries.find((e) => e.name === 'Robber 2');
const m2 = st.entries.find((e) => e.name === 'Medjay');
ok(!r2b.groupId && m2.groupId === r2b.id, 'with the leader gone, its first member leads the rest');

// Ungroup.
dmSock.emit('initUngroup', { entryId: m2.id });
await pause(600);
ok(!st.entries.find((e) => e.name === 'Medjay').groupId, 'ungroup takes a member out');

dmSock.close(); plSock.close();
console.log('');
console.log(failures === 0 ? 'init groups: all checks passed' : `init groups: ${failures} check(s) FAILED`);
await pause(300);
process.exit(failures ? 1 : 0);
