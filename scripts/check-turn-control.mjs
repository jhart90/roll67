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
const dmMapState = waitFor(dmSock, 'mapState', 8000);
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
  // a step of base+1 hexes must be allowed. The PLAYER walks it — a DM
  // moving someone else's token is refereeing and spends no Pace at all.
  const target = { q: heroTok.q + (grown?.pace ?? 0) - 1, r: heroTok.r };
  const moved = waitFor(dmSock, 'tokenMoved', 6000, (p) => p.tokenId === heroTok.id);
  const refused = waitFor(bSock, 'errorMsg', 1500).then(() => true, () => false);
  bSock.emit('moveToken', { tokenId: heroTok.id, q: target.q, r: target.r });
  const [mv, err] = await Promise.all([quiet(moved), refused]);
  ok(!!mv && !err, `a ${(grown?.pace ?? 0) - 1}-hex step is allowed against the raised allowance (moved ${!!mv}, refused ${err})`);
}

// ---------- 2c. movement is provisional until committed or acted on ----------
console.log('provisional movement:');
{
  // Hero (B's) is up and, from the Pace block above, stands 7 hexes east of
  // where the turn began with a raised allowance of 7. Nothing is spent yet.
  const now = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id);
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: 1 });
  dmSock.emit('adjustPace', { tokenId: heroTok.id, delta: -1 });
  const b0 = await quiet(now);
  ok(!!b0 && b0.moved === 0 && b0.provisional === 7, `after walking 7 hexes nothing is committed: moved ${b0?.moved}, provisional ${b0?.provisional}`);
  ok(b0?.from.q === heroTok.q && b0?.from.r === heroTok.r, 'the reach is still measured from where the turn began');
  // Think again: walk 4 back toward the start. The provisional cost falls.
  const back = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.provisional === 3);
  bSock.emit('moveToken', { tokenId: heroTok.id, q: heroTok.q + 3, r: heroTok.r });
  ok(!!(await quiet(back)), 'walking back toward the start costs nothing — provisional drops to 3');
  // Commit: the 3 are spent and the anchor moves under the token.
  const committed = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.moved === 3 && p.provisional === 0);
  bSock.emit('commitMove', { tokenId: heroTok.id });
  const b1 = await quiet(committed);
  ok(!!b1, `committing spends exactly what the spot costs (moved ${b1?.moved}, provisional ${b1?.provisional})`);
  ok(b1?.from.q === heroTok.q + 3, 'the reach is now measured from the committed hex');
  // Walk 2 more, then ACT: the action commits the walk on its own.
  const two = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.provisional === 2);
  bSock.emit('moveToken', { tokenId: heroTok.id, q: heroTok.q + 5, r: heroTok.r });
  ok(!!(await quiet(two)), 'two more hexes sit provisional (2)');
  const armed = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && (p.character.sheet.attacks ?? []).some((a) => a.name === 'Long Rifle'));
  bSock.emit('updateCharacter', { characterId: hero.id, patch: {
    shooting: 'd8', agility: 'd8', skills: [{ name: 'Shooting', die: 'd8' }],
    attacks: [{ name: 'Long Rifle', skill: 'Shooting', damage: '2d8', range: 200, ranged: true }],
  } });
  await quiet(armed);
  const acted = waitFor(bSock, 'moveBudget', 8000, (p) => p.tokenId === heroTok.id && p.moved === 5 && p.provisional === 0);
  bSock.emit('combatAction', { characterId: hero.id, actionId: 'attack:0', sourceTokenId: heroTok.id, targetTokenId: dumTok.id, adv: null });
  const b2 = await quiet(acted);
  ok(!!b2, `taking an action commits the walk that led to it (moved ${b2?.moved ?? '?'})`);
  // The running die, once per turn, adds to this turn's Pace.
  const ran = waitFor(bSock, 'moveBudget', 6000, (p) => p.tokenId === heroTok.id && p.runBonus !== null);
  bSock.emit('runRoll', { tokenId: heroTok.id });
  const b3 = await quiet(ran);
  ok(!!b3 && b3.runBonus > 0 && b3.runMax === 0, `the running die adds +${b3?.runBonus} for the turn and cannot be rolled again (runMax ${b3?.runMax})`);
  const again = waitFor(bSock, 'moveBudget', 1200, (p) => p.tokenId === heroTok.id).then(() => true, () => false);
  bSock.emit('runRoll', { tokenId: heroTok.id });
  ok(!(await again), 'a second run roll this turn is refused silently');
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

// ---------- 4. a granted Advance lives on the sheet and is spent by taking one ----------
console.log('granted Advances:');
{
  // Hero is B's now. The DM grants twice; B takes one; one is left.
  const one = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && p.character.sheet.grantedAdvances === 1);
  dmSock.emit('updateCharacter', { characterId: hero.id, patch: { grantedAdvances: 1 } });
  ok(!!(await quiet(one)), 'the owner\'s client receives the sheet with one Advance waiting');
  const two = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && p.character.sheet.grantedAdvances === 2);
  dmSock.emit('updateCharacter', { characterId: hero.id, patch: { grantedAdvances: 2 } });
  ok(!!(await quiet(two)), 'a second grant stacks (2 waiting)');
  // B takes an Advance: the same sheet write that raises `advances` spends a
  // grant, so there is no moment in which the wizard would re-open.
  const spent = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && p.character.sheet.advances === 1);
  bSock.emit('updateCharacter', { characterId: hero.id, patch: { advances: 1, rank: 'Novice' } });
  const after = await quiet(spent);
  ok(after?.character.sheet.grantedAdvances === 1, `taking an Advance spends one grant in the same write (${after?.character.sheet.grantedAdvances} left)`);
  // An ordinary sheet edit leaves the grant alone.
  const edit = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && p.character.sheet.notesX === 'hi');
  bSock.emit('updateCharacter', { characterId: hero.id, patch: { notesX: 'hi' } });
  const plain = await quiet(edit);
  ok(plain?.character.sheet.grantedAdvances === 1, 'an unrelated sheet edit does not spend a grant');
  // The DM takes the offer back.
  const revoked = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && p.character.sheet.grantedAdvances === 0);
  dmSock.emit('updateCharacter', { characterId: hero.id, patch: { grantedAdvances: 0 } });
  ok(!!(await quiet(revoked)), 'revoking clears it on the owner\'s screen');
}

// ---------- 5. map labels arrive live, for the DM and for players ----------
console.log('map labels:');
{
  // Placing a label used to reach nobody until they refreshed: the DM was
  // skipped by vision sync and a player's vision packet has no texts.
  const dmSees = waitFor(dmSock, 'mapEdited', 6000, (p) => p.mapId === mapId && (p.texts ?? []).some((t) => t.text === 'Old Mill'));
  const bSees = waitFor(bSock, 'mapEdited', 6000, (p) => p.mapId === mapId && (p.texts ?? []).some((t) => t.text === 'Old Mill'));
  dmSock.emit('upsertMapText', { mapId, text: { id: 'lbl-mill', x: 100, y: 100, text: 'Old Mill', size: 28, color: '#ffffff', font: 'serif' } });
  const [dmL, bL] = await Promise.all([quiet(dmSees), quiet(bSees)]);
  ok(!!dmL, 'the DM sees the label the moment it is placed');
  ok(!!bL, 'a player sees it too, without a refresh');
  ok(dmL?.texts.find((t) => t.id === 'lbl-mill')?.id === 'lbl-mill', 'the client-minted id is kept (so the toolbar can select it at once)');
  const moved = waitFor(bSock, 'mapEdited', 6000, (p) => p.mapId === mapId && (p.texts ?? []).some((t) => t.id === 'lbl-mill' && t.x === 250 && t.size === 40));
  dmSock.emit('upsertMapText', { mapId, text: { id: 'lbl-mill', x: 250, y: 100, text: 'Old Mill', size: 40, color: '#ffffff', font: 'serif', bold: true } });
  ok(!!(await quiet(moved)), 'moving and restyling it updates in place rather than adding a second label');
  const gone = waitFor(bSock, 'mapEdited', 6000, (p) => p.mapId === mapId && !(p.texts ?? []).some((t) => t.id === 'lbl-mill'));
  dmSock.emit('deleteMapText', { mapId, textId: 'lbl-mill' });
  ok(!!(await quiet(gone)), 'removing it reaches players live');
}

// ---------- 6. a wall with a crossing check asks before it stops ----------
console.log('crossing checks:');
{
  // Out of combat, so Pace is not in the way: the only question is the wall.
  const over = waitFor(dmSock, 'initiativeState', 6000, (p) => p.state.active === false);
  dmSock.emit('initSetActive', { active: false });
  await over;
  // Hero (B's) to a known spot; the DM moves freely.
  const parked = waitFor(dmSock, 'tokenMoved', 6000, (p) => p.tokenId === heroTok.id && p.q === 3 && p.r === 12);
  dmSock.emit('moveToken', { tokenId: heroTok.id, q: 3, r: 12 });
  await parked;
  // A wall across the seam between (3,12) and (4,12), with Athletics TN 2
  // (a d12 all but cannot miss it) and Climbing TN 30 (nothing can).
  const grid = (await dmMapState).map.grid;
  const px = (h) => ({ x: grid.hexSize * Math.sqrt(3) * (h.q + h.r / 2) + grid.originX, y: grid.hexSize * 1.5 * h.r + grid.originY });
  const a = px({ q: 3, r: 12 }), b = px({ q: 4, r: 12 });
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const wallUp = waitFor(dmSock, 'mapEdited', 6000, (p) => (p.walls ?? []).some((w) => w.crossChecks?.length === 2));
  dmSock.emit('upsertWall', { mapId, wall: {
    points: [{ x: mx, y: my - grid.hexSize * 3 }, { x: mx, y: my + grid.hexSize * 3 }], type: 'solid',
    crossChecks: [{ skill: 'Athletics', tn: 2 }, { skill: 'Climbing', tn: 30 }, { skill: '', tn: 4 }, { skill: 'Notice', tn: 4000 }],
  } });
  const walls = (await wallUp).walls;
  const gate = walls.find((w) => w.crossChecks?.length === 2);
  ok(!!gate && gate.crossChecks[0].skill === 'Athletics', 'the DM saves two checks on the wall; a blank skill and an absurd TN are dropped');
  // B has a d12 in Athletics, so TN 2 is missed only on a critical failure.
  const armed = waitFor(bSock, 'characterUpserted', 6000, (p) => p.character.id === hero.id && (p.character.sheet.skills ?? []).some((s) => s.name === 'Athletics' && s.die === 'd12'));
  bSock.emit('updateCharacter', { characterId: hero.id, patch: { skills: [{ name: 'Athletics', die: 'd12' }, { name: 'Shooting', die: 'd8' }] } });
  await armed;
  // The drag across the wall is answered with the question, not a move.
  const asked = waitFor(bSock, 'wallCheckPrompt', 6000, (p) => p.tokenId === heroTok.id);
  const moved = waitFor(dmSock, 'tokenMoved', 1200, (p) => p.tokenId === heroTok.id).then(() => true, () => false);
  bSock.emit('moveToken', { tokenId: heroTok.id, q: 5, r: 12 });
  const [prompt, movedAnyway] = await Promise.all([quiet(asked), moved]);
  ok(!!prompt && !movedAnyway, 'walking into the wall asks for a check instead of moving');
  ok(prompt?.wallId === gate?.id && prompt?.checks.length === 2 && prompt?.q === 5, 'the prompt names the wall, both skill options, and where the move was going');
  // The impossible option: the roll posts, the token stays.
  const failCard = waitFor(bSock, 'chatMsg', 6000, (p) => p.msg.roll && /can't get across/.test(p.msg.text));
  const notPassed = waitFor(bSock, 'wallCheckPassed', 1200).then(() => true, () => false);
  bSock.emit('wallCheckRoll', { tokenId: heroTok.id, wallId: gate.id, skill: 'Climbing', q: 5, r: 12 });
  const [fc, passedAnyway] = await Promise.all([quiet(failCard), notPassed]);
  ok(!!fc && !passedAnyway, 'failing the check posts the roll and grants nothing');
  // The near-certain option: a pass tells the client to send the move again,
  // and this time the wall is not there for it.
  const passCard = waitFor(bSock, 'chatMsg', 8000, (p) => p.msg.roll && /makes it across|can't get across/.test(p.msg.text) && p.msg.text.includes('Athletics'));
  const passed = waitFor(bSock, 'wallCheckPassed', 8000, (p) => p.tokenId === heroTok.id).then((p) => p, () => null);
  bSock.emit('wallCheckRoll', { tokenId: heroTok.id, wallId: gate.id, skill: 'Athletics', q: 5, r: 12 });
  const [pc, pass] = await Promise.all([quiet(passCard), passed]);
  if (pc && /can't get across/.test(pc.msg.text)) {
    console.log('      (critical failure on a d12 vs TN 2 — the one-in-seventy-two; skipping the crossing itself)');
  } else {
    ok(!!pass && pass.q === 5 && pass.r === 12, 'passing hands the client the move to send again');
    const across = waitFor(dmSock, 'tokenMoved', 6000, (p) => p.tokenId === heroTok.id && p.q === 5 && p.r === 12);
    bSock.emit('moveToken', { tokenId: heroTok.id, q: 5, r: 12 });
    ok(!!(await quiet(across)), 'the re-sent move crosses the wall');
    // The pass was for ONE crossing: coming back is a fresh question.
    const askedAgain = waitFor(bSock, 'wallCheckPrompt', 6000, (p) => p.tokenId === heroTok.id);
    bSock.emit('moveToken', { tokenId: heroTok.id, q: 3, r: 12 });
    ok(!!(await quiet(askedAgain)), 'crossing back asks again — a pass is spent by the crossing');
  }
  // The DM is never asked.
  const dmAcross = waitFor(dmSock, 'tokenMoved', 6000, (p) => p.tokenId === heroTok.id && p.q === 2 && p.r === 12);
  const dmAsked = waitFor(dmSock, 'wallCheckPrompt', 1200).then(() => true, () => false);
  dmSock.emit('moveToken', { tokenId: heroTok.id, q: 2, r: 12 });
  const [dmMoved, dmPrompted] = await Promise.all([quiet(dmAcross), dmAsked]);
  ok(!!dmMoved && !dmPrompted, 'the DM moves the token over the wall without being asked');
}

for (const s of [dmSock, aSock, bSock]) s.close();
console.log('');
console.log(failures === 0 ? 'turn-control: all checks passed' : `turn-control: ${failures} check(s) FAILED`);
// Let closed sockets finish tearing down before exiting -- process.exit
// mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
await new Promise((r) => setTimeout(r, 300));
process.exit(failures ? 1 : 0);
