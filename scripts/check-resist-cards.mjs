/**
 * A resist roll says it is one — on the card and on the banner over the map.
 *
 * A resisted attack (a stun pulse, a blinding flash, a shrieking cone) has no
 * to-hit roll: the dice are the DEFENDER's. They used to be posted under the
 * attacker's name reading "Turret attacks Tester … SAVE (negated entirely)",
 * and the banner named the attacker (or the DM's account, for a cone), so a
 * big green number looked like an attack that somehow did nothing.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-resist-cards.mjs http://localhost:3103
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

const dm = await login('resistdm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Resist Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
const errors = [];
sock.on('errorMsg', (e) => { errors.push(JSON.stringify(e)); console.log('      [server error]', JSON.stringify(e)); });

async function makeChar(name, patch) {
  const made = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.name === name);
  sock.emit('createCharacter', { name, system: 'swade' });
  const ch = (await made).character;
  const set = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.id === ch.id && p.character.sheet.agility === patch.agility);
  sock.emit('updateCharacter', { characterId: ch.id, patch });
  return (await set).character;
}
async function place(ch, q, r) {
  const t = waitFor(sock, 'tokenUpserted', 6000, (p) => p.token.name === ch.name);
  sock.emit('createToken', { mapId, name: ch.name, q, r, layer: 'token', characterId: ch.id });
  return (await t).token;
}

const glarer = await makeChar('Glarer', {
  agility: 'd8', skills: [{ name: 'Shooting', die: 'd8' }],
  attacks: [
    { name: 'Glare', skill: 'Shooting', damage: '0', dtype: 'energy', range: 60, save: 'agility', onSave: 'negate', saveDc: 4, condition: 'distracted', wielded: true },
    { name: 'Shriek', skill: 'Shooting', damage: '0', dtype: '', range: 0, save: 'spirit', saveMod: -1, onSave: 'negate', saveDc: 4, condition: 'shaken', aoeShape: 'cone', aoeSize: 54, wielded: true },
  ],
});
// A Wild Card with a weak Agility: fails a resist often enough to test, and
// has the Bennies to buy one back.
const tester = await makeChar('Tester', { agility: 'd4', spirit: 'd6', vigor: 'd6', wildCard: true, bennies: 6 });
const gTok = await place(glarer, 5, 5);
const tTok = await place(tester, 7, 5);

const VERDICT_GLARE = /^(RESISTED — not Distracted|FAILED — Distracted)$/;
const VERDICT_SHRIEK = /^(RESISTED — not Shaken|FAILED — Shaken)$/;

// 1. A single-target resist.
const glareCard = waitFor(sock, 'chatMsg', 8000, (p) => /resists/.test(p.msg?.text ?? ''));
sock.emit('combatAction', { characterId: glarer.id, actionId: 'attack:0', sourceTokenId: gTok.id, targetTokenId: tTok.id, adv: null });
const g = (await glareCard).msg;
const [gHead, gVerdict] = g.text.split('\n');
ok(gHead.startsWith('Tester resists Glarer’s Glare — Agility roll:'), `the card says whose resist it is (${gHead})`);
ok(/vs TN 4$/.test(gHead), 'and what it was up against');
ok(VERDICT_GLARE.test(gVerdict ?? ''), `and what it cost or spared them (${gVerdict})`);
ok(g.callout?.who === 'Tester', `the banner names the defender (${g.callout?.who})`);
ok(g.callout?.tone === 'save' && /^resisting Glare/.test(g.callout?.what ?? ''), `the banner says it is a resist (${g.callout?.what})`);

// 2. A cone everyone in it resists.
await new Promise((r) => setTimeout(r, 2500));
const shriekCard = waitFor(sock, 'chatMsg', 12000, (p) => /resists Glarer’s Shriek/.test(p.msg?.text ?? ''));
sock.emit('castAoe', {
  characterId: glarer.id, actionId: 'attack:1', sourceTokenId: gTok.id,
  originHex: { q: 5, r: 5 }, aimHex: { q: 9, r: 5 }, adv: null,
});
const s = (await shriekCard.catch(() => null))?.msg;
ok(!!s, 'the cone posts a resist card for the target caught in it');
if (s) {
  const [sHead, sVerdict] = s.text.split('\n');
  ok(sHead.startsWith('Tester resists Glarer’s Shriek — Spirit roll −1:'), `the cone card names roller, source and modifier (${sHead})`);
  ok(VERDICT_SHRIEK.test(sVerdict ?? ''), `and the verdict (${sVerdict})`);
  ok(s.callout?.who === 'Tester', `the cone banner names the defender, not the GM's account (${s.callout?.who})`);
}

// 3. A Benny buys back a FAILED resist — and takes its effect off again.
let testerSheet = tester.sheet;
sock.on('characterUpserted', (p) => { if (p.character.id === tester.id) testerSheet = p.character.sheet; });
let bState = null;
sock.on('bennyState', (p) => { if (p.characterId === tester.id) bState = p; });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const conds = () => (Array.isArray(testerSheet.conditions) ? testerSheet.conditions : []);
const reset = async () => {
  // Whatever the last glare did has to land before it can be wiped.
  await pause(4500);
  sock.emit('updateCharacter', { characterId: tester.id, patch: { conditions: [], bennies: 6 } });
  await pause(1000);
};

await pause(1500);
await reset();
ok(conds().length === 0, `setup: Tester starts clean (${conds().join(',') || 'none'})`);

// Dice decide: a resist has to fail, then a Benny has to beat it before
// snake eyes (a Critical Failure, which no Benny buys back) ends the try.
let checked = false;
let resolved = null;
for (let attempt = 0; attempt < 6 && !resolved; attempt++) {
  let failed = null;
  for (let i = 0; i < 12 && !failed; i++) {
    const card = waitFor(sock, 'chatMsg', 8000, (p) => /resists Glarer’s Glare/.test(p.msg?.text ?? ''));
    sock.emit('combatAction', { characterId: glarer.id, actionId: 'attack:0', sourceTokenId: gTok.id, targetTokenId: tTok.id, adv: null });
    const m = (await card).msg;
    await pause(400);
    if (/^FAILED/.test(m.text.split('\n')[1] ?? '') && !(bState?.critFailMsgIds ?? []).includes(m.id)) failed = m;
    else await reset();
  }
  if (!failed) continue;
  await pause(5500); // the Distracted lands, and the effect is measured
  if (!checked) {
    checked = true;
    ok(conds().includes('distracted'), `the failed resist left them Distracted (${conds().join(',')})`);
    ok((bState?.traitMsgIds ?? []).includes(failed.id), 'the failed resist card is offered for a Benny');
  }
  let cardId = failed.id;
  for (let tries = 0; tries < 5 && !resolved; tries++) {
    const before = errors.length;
    const reroll = waitFor(sock, 'chatMsg', 12000, (p) => /rerolls the resist against/.test(p.msg?.text ?? '')).catch(() => null);
    sock.emit('bennyUse', { characterId: tester.id, use: 'reroll-trait', messageId: cardId });
    const r = (await reroll)?.msg;
    if (!r) break;
    console.log(`      reroll: ${r.text.replace('\n', ' / ')}`);
    if (/RESISTED after all/.test(r.text)) resolved = r;
    else {
      await pause(1200);
      // Snake eyes on the reroll: that one stands, and is refused politely.
      if ((bState?.critFailMsgIds ?? []).includes(r.id) || errors.length > before) break;
      cardId = r.id;
    }
  }
  if (!resolved) await reset();
}
ok(!!resolved, 'a Benny turned the failure into a success');
if (resolved) {
  ok(/no longer Distracted/.test(resolved.text), `the card says what came off (${resolved.text.split('\n')[1]})`);
  await pause(800);
  ok(!conds().includes('distracted'), `and Tester really is no longer Distracted (${conds().join(',') || 'none'})`);
}

// A refused Critical Failure is the rule working, not a server fault.
const realErrors = errors.filter((e) => !/Critical Failure/.test(e));
ok(realErrors.length === 0, `no server errors (${realErrors.join(' ; ')})`);
sock.close();
console.log('');
console.log(failures === 0 ? 'resist cards: all checks passed' : `resist cards: ${failures} check(s) FAILED`);
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
