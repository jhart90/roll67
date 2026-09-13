/**
 * Who controls a token, and whose turn it is, must reach every screen live.
 *
 * Three things the DM does mid-fight that used to need a refresh (or quietly
 * broke the round) to be believed:
 *
 *   1. Handing a character from player A to player B. B's client got the
 *      sheet but not the initiative stamps or the current turn's Pace
 *      budget, so the "end turn" button and the reach shading stayed dark
 *      until B reloaded. A gm-layer NPC handed to a player was invisible to
 *      its new owner altogether.
 *   2. Removing a combatant from the tracker. The index stayed put while the
 *      rows above it shifted, so the turn jumped to whoever came next.
 *   3. There was no way to give a turn BACK to someone who ended it early.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-turn-control.mjs http://localhost:3103
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
const quiet = (p) => p.catch(() => null);

const dm = await login('turndm', 'test1234');
const pa = await login('turnpa', 'test1234');
const pb = await login('turnpb', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Turn Control', system: 'swade' }, dm.token)).data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pa.token);
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pb.token);

const dmSock = await connect(dm.token);
const aSock = await connect(pa.token);
const bSock = await connect(pb.token);
for (const [who, s] of [['dm', dmSock], ['A', aSock], ['B', bSock]]) {
  s.on('errorMsg', (e) => console.log(`      [server error -> ${who}]`, JSON.stringify(e)));
}
const st = waitFor(dmSock, 'campaignState');
dmSock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
const aJoined = waitFor(aSock, 'mapState');
const bJoined = waitFor(bSock, 'mapState');
aSock.emit('joinCampaign', { campaignId: camp.id });
bSock.emit('joinCampaign', { campaignId: camp.id });
await Promise.all([aJoined, bJoined]);

// A hero owned by player A, a gm-layer NPC nobody owns, and a plain dummy.
const heroReady = waitFor(dmSock, 'characterUpserted', 6000, (p) => p.character.name === 'Hero');
dmSock.emit('createCharacter', { name: 'Hero', system: 'swade', ownerUserId: pa.user.id });
const hero = (await heroReady).character;
ok(hero.ownerUserId === pa.user.id, 'setup: Hero belongs to player A');
const gobReady = waitFor(dmSock, 'characterUpserted', 6000, (p) => p.character.name === 'Goblin');
dmSock.emit('createCharacter', { name: 'Goblin', system: 'swade' });
const goblin = (await gobReady).character;

const tok = async (name, extra) => {
  const w = waitFor(dmSock, 'tokenUpserted', 6000, (p) => p.token.name === name);
  dmSock.emit('createToken', { mapId, name, layer: 'token', ...extra });
  return (await w).token;
};
const heroTok = await tok('Hero', { q: 5, r: 5, characterId: hero.id });
const gobTok = await tok('Goblin', { q: 8, r: 5, characterId: goblin.id, layer: 'gm' });
const dumTok = await tok('Dummy', { q: 6, r: 8, bar: { hp: 10, maxHp: 10 } });

// Fixed values so the order is Hero, Goblin, Dummy -- then combat on.
for (const [t, value] of [[heroTok, 20], [gobTok, 15], [dumTok, 10]]) {
  const w = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.entries.some((e) => e.tokenId === t.id));
  dmSock.emit('initAdd', { tokenId: t.id, value });
  await w;
}
const sorted = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.entries[0]?.tokenId === heroTok.id);
dmSock.emit('initSort');
await sorted;
const live = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.active === true);
dmSock.emit('initSetActive', { active: true });
let state = (await live).state;
const entryOf = (t) => state.entries.find((e) => e.tokenId === t.id);
ok(state.turnIdx === 0 && entryOf(heroTok) && state.round === 1, `setup: Hero is up, round 1 (order ${state.entries.map((e) => e.name).join(' > ')})`);

// ---------- 1. control changes hands mid-turn ----------
console.log('control handoff (A -> B) during Hero\'s turn:');
{
  const bSheet = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id);
  const bInit = waitFor(bSock, 'initiativeState', 6000, (p) => p.state.entries.some((e) => e.tokenId === heroTok.id && e.ownerUserId === pb.user.id));
  const bBudget = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id);
  const aGone = waitFor(aSock, 'characterRemoved', 6000, (p) => p.characterId === hero.id);
  dmSock.emit('updateCharacter', { characterId: hero.id, patch: {}, ownerUserId: pb.user.id });
  const [sheet, init, budget, gone] = await Promise.all([quiet(bSheet), quiet(bInit), quiet(bBudget), quiet(aGone)]);
  ok(sheet?.character.ownerUserId === pb.user.id, 'B receives the Hero sheet, stamped as theirs');
  ok(!!init, 'B receives the initiative tracker with Hero\'s entry now controlled by B (no refresh)');
  const stamped = init?.state.entries.find((e) => e.tokenId === heroTok.id);
  ok(stamped?.ownerName === 'turnpb', `...and the controller's name on it (${stamped?.ownerName})`);
  ok(!!budget && budget.pace > 0, `B receives the current turn's Pace budget for Hero (pace ${budget?.pace})`);
  ok(!!gone, 'A is told the Hero sheet is no longer theirs');
}

console.log('gm-layer NPC handed to B:');
{
  const bSees = waitFor(bSock, 'visionUpdate', 6000, (p) => (p.tokens ?? []).some((t) => t.id === gobTok.id));
  const dmTok = waitFor(dmSock, 'tokenUpserted', 6000, (p) => p.token.id === gobTok.id);
  dmSock.emit('updateCharacter', { characterId: goblin.id, patch: {}, ownerUserId: pb.user.id });
  const [vision, upd] = await Promise.all([quiet(bSees), quiet(dmTok)]);
  ok(upd?.token.layer === 'token', `the Goblin token leaves the GM layer so its new owner can see it (layer ${upd?.token.layer})`);
  ok(!!vision, 'B\'s map now shows the Goblin token');
}

// ---------- 2. the DM hands the turn to anyone ----------
console.log('DM sets the turn:');
{
  const dumEntry = entryOf(dumTok);
  const w = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.entries[p.state.turnIdx]?.id === dumEntry.id);
  dmSock.emit('initSetTurn', { entryId: dumEntry.id });
  state = (await quiet(w))?.state ?? state;
  ok(state.entries[state.turnIdx]?.tokenId === dumTok.id, 'jumping forward: Dummy is up');
  ok(state.round === 1, `round unchanged by a jump (${state.round})`);

  const heroEntry = entryOf(heroTok);
  const back = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.entries[p.state.turnIdx]?.id === heroEntry.id);
  const bBudget = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id);
  const note = waitFor(dmSock, 'chatMsg', 6000, (p) => /hands the turn to Hero/.test(p.msg?.text ?? ''));
  dmSock.emit('initSetTurn', { entryId: heroEntry.id });
  const [s2, budget, msg] = await Promise.all([quiet(back), quiet(bBudget), quiet(note)]);
  state = s2?.state ?? state;
  ok(state.entries[state.turnIdx]?.tokenId === heroTok.id && state.round === 1, 'rewinding: Hero is up again, same round');
  ok(!!budget && budget.moved === 0, `Hero's controller gets a fresh Pace budget for the do-over (moved ${budget?.moved})`);
  ok(!!msg, 'the table is told in chat');
  ok(state.entries.map((e) => e.tokenId).join() === [heroTok, gobTok, dumTok].map((t) => t.id).join(), 'the order itself is untouched');
}

// ---------- 2b. the DM's Pace dial works before the first step, both ways ----------
console.log('DM adjusts Pace:');
{
  // Hero is up and has not moved. "-" used to be a silent no-op here (no
  // movement record to edit yet) and "+" could never exceed the sheet.
  const base = (await (async () => {
    const w = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.pace !== undefined);
    dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: -1 });
    return quiet(w);
  })());
  ok(!!base, 'taking an inch away before any movement produces a new budget');
  const w2 = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.pace === (base?.pace ?? -9) + 3);
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: 1 });
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: 1 });
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: 1 });
  const grown = await quiet(w2);
  ok(!!grown, `three "+" nudges raise the allowance past the sheet's own Pace (${base?.pace} -> ${grown?.pace})`);
  const dmSees = waitFor(dmSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.pace === (grown?.pace ?? -9) - 1);
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: -1 });
  ok(!!(await quiet(dmSees)), 'the DM\'s own screen receives the adjusted budget too');
  // A move is measured against the adjusted figure: with Pace now base+1,
  // a step of base+1 hexes must be allowed.
  const target = { q: heroTok.q + (grown?.pace ?? 0) - 1, r: heroTok.r };
  const moved = waitFor(dmSock, 'tokenMoved', 6000, (p) => p.tokenId === heroTok.id);
  const refused = waitFor(dmSock, 'errorMsg', 1500).then(() => true, () => false);
  dmSock.emit('moveToken', { tokenId: heroTok.id, q: target.q, r: target.r });
  const [mv, err] = await Promise.all([quiet(moved), refused]);
  ok(!!mv && !err, `a ${(grown?.pace ?? 0) - 1}-hex step is allowed against the raised allowance (moved ${!!mv}, refused ${err})`);
}

// ---------- 3. removing a combatant keeps the turn where it was ----------
console.log('removing combatants:');
{
  const next = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.turnIdx === 1);
  dmSock.emit('initNext');
  state = (await quiet(next))?.state ?? state;
  ok(state.entries[state.turnIdx]?.tokenId === gobTok.id, 'Goblin is up');

  // Hero sits ABOVE the current turn: removing it must not skip Goblin.
  const w = waitFor(dmSock, 'initiativeState', 6000, (p) => !p.state.entries.some((e) => e.tokenId === heroTok.id));
  dmSock.emit('initRemove', { entryId: entryOf(heroTok).id });
  state = (await quiet(w))?.state ?? state;
  ok(state.entries[state.turnIdx]?.tokenId === gobTok.id, `removing an entry above the current turn keeps it Goblin's turn (now at index ${state.turnIdx})`);
  ok(state.round === 1, `...in the same round (${state.round})`);

  // Now the LAST combatant, while it is their turn: the round ends as if
  // they had passed, and the top of the order is up.
  const toDummy = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.entries[p.state.turnIdx]?.tokenId === dumTok.id);
  dmSock.emit('initNext');
  state = (await quiet(toDummy))?.state ?? state;
  const w2 = waitFor(dmSock, 'initiativeState', 6000, (p) => !p.state.entries.some((e) => e.tokenId === dumTok.id));
  dmSock.emit('initRemove', { entryId: entryOf(dumTok).id });
  state = (await quiet(w2))?.state ?? state;
  ok(state.entries.length === 1 && state.entries[state.turnIdx]?.tokenId === gobTok.id, 'removing the acting last combatant hands the turn to the top of the order');
  ok(state.round === 2, `...and the round rolls over (${state.round})`);
}

for (const s of [dmSock, aSock, bSock]) s.close();
console.log('');
console.log(failures === 0 ? 'turn-control: all checks passed' : `turn-control: ${failures} check(s) FAILED`);
// Let closed sockets finish tearing down before exiting -- process.exit
// mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
