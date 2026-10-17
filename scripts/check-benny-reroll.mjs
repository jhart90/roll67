/**
 * A Benny rerolls the roll on the card you right-clicked.
 *
 * The server used to keep ONE rerollable trait roll per character, for five
 * minutes. Roll Agility, then Notice, right-click the Agility card, and the
 * Benny rerolled Notice; wait a few minutes and it said there was nothing to
 * reroll at all. Now every recent roll is kept against its chat card.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-benny-reroll.mjs http://localhost:3103
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

const dm = await login('bennydm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Benny Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
await st;
const errors = [];
sock.on('errorMsg', (e) => { errors.push(JSON.stringify(e)); console.log('      [server error]', JSON.stringify(e)); });

const chReady = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.name === 'Roller');
sock.emit('createCharacter', { name: 'Roller', system: 'swade' });
let pc = (await chReady).character;
const set = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.id === pc.id && p.character.sheet.bennies === 5);
sock.emit('updateCharacter', { characterId: pc.id, patch: {
  wildCard: true, bennies: 5, agility: 'd8', smarts: 'd6',
  skills: [{ name: 'Notice', die: 'd8' }],
} });
pc = (await set).character;

// The server sends this twice per roll (banked, then tied to its card), so
// read whatever is LATEST once things settle, not whichever arrives first.
let latest = null;
sock.on('bennyState', (p) => { if (p.characterId === pc.id) latest = p; });
const settle = () => new Promise((r) => setTimeout(r, 500));

// Two different trait rolls. A Critical Failure on either would (rightly)
// refuse the reroll and prove nothing, so roll until both are clean.
async function sheetRoll(rollableId) {
  for (let tries = 0; tries < 10; tries++) {
    const card = waitFor(sock, 'chatMsg', 6000, (p) => p.msg?.characterId === pc.id && p.msg?.roll);
    sock.emit('sheetRoll', { characterId: pc.id, rollableId });
    const c = await card;
    await settle();
    if (!latest?.critFailMsgIds?.includes(c.msg.id)) return c.msg;
  }
  throw new Error('ten Critical Failures in a row');
}

const agi = await sheetRoll('trait_agility');
const notice = await sheetRoll('skill_0');
ok(!!latest?.traitMsgIds?.includes(agi.id), 'the OLDER Agility card is still rerollable after a newer roll');
ok(!!latest?.traitMsgIds?.includes(notice.id), 'and so is the newer Notice card');

// Right-click the Agility card — the older one.
const spent = waitFor(sock, 'chatMsg', 6000, (p) => /spends a Benny to reroll/.test(p.msg?.text ?? ''));
const reroll = waitFor(sock, 'chatMsg', 10000, (p) => /rerolls/.test(p.msg?.text ?? '') && p.msg?.characterId === pc.id);
sock.emit('bennyUse', { characterId: pc.id, use: 'reroll-trait', messageId: agi.id });
const spentMsg = (await spent).msg.text;
ok(spentMsg.includes(agi.text), `the Benny rerolls the card that was clicked (${spentMsg})`);
ok(!spentMsg.includes(notice.text), 'not the most recent roll');
await reroll;
await settle();
ok(!!latest?.traitMsgIds?.includes(notice.id), 'the Notice card can still be rerolled afterwards');

// A refreshed page is told what is still open.
const sock2 = await connect(dm.token);
const st2 = waitFor(sock2, 'bennyState', 6000, (p) => p.characterId === pc.id);
sock2.emit('joinCampaign', { campaignId: camp.id });
const onJoin = await st2.catch(() => null);
ok(!!onJoin && onJoin.traitMsgIds?.includes(notice.id), 'a fresh join receives the rerollable cards');

ok(errors.length === 0, `no server errors (${errors.join(' ; ')})`);
sock.close(); sock2.close();
console.log('');
console.log(failures === 0 ? 'benny reroll: all checks passed' : `benny reroll: ${failures} check(s) FAILED`);
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
