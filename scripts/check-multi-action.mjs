/**
 * The Multi-Action penalty must cost an ACTION, not a glance.
 *
 * Asking the server what a shot would be modified by used to spend an action
 * as a side effect of answering, and the client asks that on hover -- so a
 * player who moused over their target and then swung was billed for an extra
 * action they never took. Three hovers maxed the penalty out at -4 on a first
 * and only attack.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-multi-action.mjs http://localhost:3103
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

const dm = await login('mapdm', 'test1234');
const camp = (await api('/api/campaigns', { name: 'MAP Test', system: 'swade' }, dm.token)).data.campaign;
const sock = await connect(dm.token);
const st = waitFor(sock, 'campaignState');
sock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
sock.on('errorMsg', (e) => console.log('      [server error]', JSON.stringify(e)));

// A fighter with one melee attack, and a target to swing at.
const chReady = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.name === 'Swinger');
sock.emit('createCharacter', { name: 'Swinger', system: 'swade' });
let pc = (await chReady).character;
const armed = waitFor(sock, 'characterUpserted', 6000, (p) => p.character.id === pc.id
  && (p.character.sheet.attacks ?? []).some((a) => a.name === 'Test Blade'));
sock.emit('updateCharacter', { characterId: pc.id, patch: {
  fighting: 'd8', agility: 'd8', vigor: 'd6', spirit: 'd6', strength: 'd6',
  skills: [{ name: 'Fighting', die: 'd8' }],
  attacks: [{ name: 'Test Blade', skill: 'Fighting', damage: '1d6!', range: 5 }],
} });
pc = (await armed).character;

const t1 = waitFor(sock, 'tokenUpserted', 6000, (p) => p.token.name === 'Swinger tok');
sock.emit('createToken', { mapId, name: 'Swinger tok', q: 5, r: 5, layer: 'token', characterId: pc.id });
const src = (await t1).token;
const t2 = waitFor(sock, 'tokenUpserted', 6000, (p) => p.token.name === 'Dummy');
sock.emit('createToken', { mapId, name: 'Dummy', q: 6, r: 5, layer: 'token', bar: { hp: 30, maxHp: 30 } });
const tgt = (await t2).token;

// Combat on, so the Multi-Action ledger is live at all.
const initUp = waitFor(sock, 'initiativeState', 6000, (p) => p.state?.active === true);
sock.emit('initAdd', { tokenId: src.id, name: 'Swinger tok' });
sock.emit('initAdd', { tokenId: tgt.id, name: 'Dummy' });
sock.emit('initSetActive', { active: true });
const initState = await initUp.catch(() => null);
ok(initState?.state?.active === true, 'combat is actually running (otherwise the ledger is dormant and this test proves nothing)');

const attack = (label) => {
  const card = waitFor(sock, 'chatMsg', 8000, (p) => p.msg?.text?.includes('attacks Dummy'));
  sock.emit('combatAction', { characterId: pc.id, actionId: 'attack:0', sourceTokenId: src.id, targetTokenId: tgt.id, adv: null });
  return card.then((c) => { const w = (c.msg.roll?.modWhy ?? []).join(' | '); console.log(`      ${label}: modWhy=[${w}]`); return `${c.msg.text} ${w}`; });
};
const preview = () => {
  const r = waitFor(sock, 'attackPreviewResult', 4000).catch(() => null);
  sock.emit('attackPreview', { characterId: pc.id, actionId: 'attack:0', sourceTokenId: src.id, targetTokenId: tgt.id, adv: null });
  return r;
};

// The bug: hovering a target used to spend an action.
const p1 = await preview();
await preview();
await preview();
ok(p1 !== null, 'the preview answers at all');
ok(!(p1?.tags ?? []).some((t) => /Multi-Action/i.test(t)), `previewing does not itself show a Multi-Action penalty (${JSON.stringify(p1?.tags ?? [])})`);

const first = await attack('1st attack');
ok(!/Multi-Action/i.test(first), 'the FIRST real attack takes no Multi-Action penalty, however many times it was previewed');

await preview();
const second = await attack('2nd attack');
ok(/Multi-Action/i.test(second), 'a genuine SECOND action still takes the penalty');
ok(/-2 Multi-Action|−2 Multi-Action/.test(second), `the second action takes exactly -2 (${(second.match(/[-−]\d Multi-Action/) ?? ['none'])[0]})`);

const third = await attack('3rd attack');
ok(/[-−]4 Multi-Action/.test(third), `a third action takes -4 (${(third.match(/[-−]\d Multi-Action/) ?? ['none'])[0]})`);

sock.close();
console.log('');
console.log(failures === 0 ? 'multi-action: all checks passed' : `multi-action: ${failures} check(s) FAILED`);
process.exit(failures ? 1 : 0);
