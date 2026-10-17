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
const tester = await makeChar('Tester', { agility: 'd6', spirit: 'd6', vigor: 'd6' });
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

ok(errors.length === 0, `no server errors (${errors.join(' ; ')})`);
sock.close();
console.log('');
console.log(failures === 0 ? 'resist cards: all checks passed' : `resist cards: ${failures} check(s) FAILED`);
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
