/**
 * The Quiet Year, end to end over the socket: a campaign of it opens on a
 * shared scene everyone can see, the year is set up and started, and two
 * weeks are played — card, dice, action — with a project finishing, a
 * discussion going round the table, and Contempt taken. Turn order is the
 * server's to enforce, not the client's.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-quiet-year.mjs http://localhost:3103
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

const dm = await login('qydm', 'test1234');
const pl = await login('qyplayer', 'test1234');
const created = await api('/api/campaigns', { name: 'A Quiet Year', system: 'quietyear' }, dm.token);
ok(created.status === 200, `a Quiet Year campaign can be created (${created.status})`);
const camp = created.data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pl.token);

const dmSock = await connect(dm.token);
const plSock = await connect(pl.token);

// Each socket keeps the latest year it was shown, and its last error.
const latest = new Map();
const lastError = new Map();
for (const [who, s] of [['dm', dmSock], ['pl', plSock]]) {
  s.on('qyState', (p) => latest.set(who, p.state));
  s.on('errorMsg', (e) => lastError.set(who, e.message ?? String(e)));
}
const dmJoin = Promise.all([waitFor(dmSock, 'campaignState'), waitFor(dmSock, 'mapState')]);
dmSock.emit('joinCampaign', { campaignId: camp.id });
const [dmState, dmMap] = await dmJoin;
ok(dmState.campaign.system === 'quietyear', 'the campaign says it is playing The Quiet Year');
ok(dmMap.map.isScene === true, 'it opens on a shared scene, not a fogged battlemap');
const plJoin = waitFor(plSock, 'mapState');
plSock.emit('joinCampaign', { campaignId: camp.id });
const plMap = await plJoin;
ok(plMap.visible === null, 'a player sees the whole map with no token of their own');

// Send an action as someone and wait for the year that comes back (or an error).
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
async function as(who, action) {
  lastError.delete(who);
  (who === 'dm' ? dmSock : plSock).emit('qyAction', { action });
  await settle();
  return lastError.get(who) ?? null;
}
const year = () => latest.get('dm');

dmSock.emit('qyGet');
await settle();
ok(year()?.phase === 'setup', 'the year starts in setup');

await as('dm', { type: 'setSeats', seats: [{ userId: dm.user.id, name: 'qydm' }, { userId: pl.user.id, name: 'qyplayer' }] });
await as('pl', { type: 'nameResource', resource: 'fish' });
await as('dm', { type: 'nameResource', resource: 'clean water' });
ok(year()?.setup.resources.length === 2, 'each player names a resource');
ok(/facilitator/i.test(await as('pl', { type: 'start', abundance: 'fish' }) ?? ''), 'only the facilitator starts the year');
await as('dm', { type: 'start', abundance: 'fish' });
ok(year()?.phase === 'play' && year()?.deck.length === 52, 'the year begins with fifty-two weeks in the deck');
ok(JSON.stringify(year()?.abundances) === '["fish"]' && JSON.stringify(year()?.scarcities) === '["clean water"]', 'one Abundance, the rest Scarcity');
ok(latest.get('pl')?.phase === 'play', 'the player sees the same year');

// Week 1 — the facilitator's.
ok(/qydm/.test(await as('pl', { type: 'draw' }) ?? ''), 'a player cannot play someone else’s week');
await as('dm', { type: 'draw' });
ok(year()?.week === 1 && year()?.current?.cardId.startsWith('spring'), `week 1 draws a Spring card (${year()?.current?.cardId})`);
await as('dm', { type: 'choose', option: 0 });
await as('dm', { type: 'adjustDice' });
ok(year()?.step === 'action', 'card, then dice, then the action');
await as('dm', { type: 'startProject', text: 'Dig a well', weeks: 1 });
ok(year()?.projects.length === 1 && year()?.step === 'done', 'starting a project is the week’s action');
await as('dm', { type: 'endWeek' });
ok(year()?.seats[year().activeSeat].userId === pl.user.id, 'the week passes clockwise');

// Week 2 — the player's: the well finishes when the dice move.
const done = waitFor(plSock, 'chatMsg', 6000, (p) => /Project complete/.test(p.msg?.text ?? '')).catch(() => null);
await as('pl', { type: 'draw' });
await as('pl', { type: 'choose', option: 0 });
await as('pl', { type: 'adjustDice' });
ok(year()?.projects.length === 0, 'the project die reached zero and the project is complete');
ok(!!(await done), 'and the table is told who narrates how it turned out');

await as('pl', { type: 'openDiscussion', kind: 'question', text: 'Should we guard the well?' });
ok(JSON.stringify(year()?.discussion?.waiting) === JSON.stringify([dm.user.id, pl.user.id]), 'a question goes round the table and back to the asker');
ok(/turn/i.test(await as('pl', { type: 'weighIn', text: 'Me first!' }) ?? ''), 'nobody speaks out of turn');
await as('dm', { type: 'weighIn', text: 'Only at night.' });
await as('pl', { type: 'weighIn', text: 'Then we need lamps.' });
ok(year()?.discussion === null && year()?.step === 'done', 'the discussion ends without a decision, and so does the action');

await as('dm', { type: 'takeContempt' });
ok(year()?.contempt[dm.user.id] === 1, 'Contempt can be taken by anyone, at any time');

// The group's own deck text (invented here — never the real cards).
await as('dm', { type: 'importOracle', text: 'A Spring\nInvented one?\nor...\nInvented two?\n2 Spring\nInvented three. Do not reduce project dice this week.' });
ok(Object.keys(year()?.oracle ?? {}).length === 2, 'the facilitator can load their deck’s text into the campaign');
ok(/facilitator/i.test(await as('pl', { type: 'importOracle', text: 'A Spring\nx' }) ?? ''), 'players cannot');

dmSock.close(); plSock.close();
console.log('');
console.log(failures === 0 ? 'quiet year: all checks passed' : `quiet year: ${failures} check(s) FAILED`);
await settle(300);
process.exit(failures ? 1 : 0);
