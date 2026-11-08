/**
 * The four GM tools the KV20 finale asked for:
 *   - /as: the DM speaks in an NPC's voice; a player cannot.
 *   - loot notes: a chest item's DM-only note reaches the DM and never a player.
 *   - all-maps counters: one counter shown over every map in the campaign.
 *   - Dramatic Tasks: tokens on the tracker, scored from chat rolls once each.
 *
 * Run against a server started on a throwaway DATA_DIR:
 *   node scripts/check-thebes-tools.mjs http://localhost:3103
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

const dm = await login('thebesdm', 'test1234');
const pl = await login('thebespl', 'test1234');
const camp = (await api('/api/campaigns', { name: 'Thebes Tools', system: 'swade' }, dm.token)).data.campaign;
await api('/api/campaigns/join', { inviteCode: camp.inviteCode }, pl.token);

const dmSock = await connect(dm.token);
const plSock = await connect(pl.token);
const dmErrors = [];
const plErrors = [];
dmSock.on('errorMsg', (e) => dmErrors.push(JSON.stringify(e)));
plSock.on('errorMsg', (e) => plErrors.push(JSON.stringify(e)));

// Everything the player is sent, so a leak anywhere is caught.
const plTraffic = [];
plSock.onAny((event, payload) => plTraffic.push(`${event} ${JSON.stringify(payload)}`));
const plChat = [];
plSock.on('chatMsg', (p) => plChat.push(p.msg));
const dmChat = [];
dmSock.on('chatMsg', (p) => dmChat.push(p.msg));
let dmInit = null;
dmSock.on('initiativeState', (p) => { dmInit = p.state; });
let plInit = null;
plSock.on('initiativeState', (p) => { plInit = p.state; });

const st = waitFor(dmSock, 'campaignState');
dmSock.emit('joinCampaign', { campaignId: camp.id });
const mapId = (await st).campaign.activeMapId;
const plJoined = waitFor(plSock, 'mapState');
plSock.emit('joinCampaign', { campaignId: camp.id });
await plJoined;

// ---------- /as ----------
console.log('/as');
dmSock.emit('chat', { text: '/as Sabu: Place your weapons on the floor.' });
await pause(800);
const said = plChat.find((m) => m.text === 'Place your weapons on the floor.');
ok(!!said && said.fromName === 'Sabu', 'the table hears it from Sabu');
plSock.emit('chat', { text: '/as Sabu: I am Sabu now.' });
await pause(800);
ok(!plChat.some((m) => m.text === 'I am Sabu now.'), 'a player cannot speak as someone else');
ok(plErrors.some((e) => e.includes('Only the DM')), 'and is told why');

// ---------- loot notes ----------
console.log('loot notes');
const SECRET = 'REPLICA-khemet-tracker-7731';
const folderW = waitFor(dmSock, 'worldFolders', 6000, (p) => p.folders.some((f) => f.name === 'False Treasury'));
dmSock.emit('createWorldFolder', {
  name: 'False Treasury', parentId: null, displayKind: 'chest',
  items: [{ id: 'bowl-1', name: 'Electrum libation bowl', description: 'Bears a cartouche.' }],
});
const folderId = (await folderW).folders.find((f) => f.name === 'False Treasury').id;
const notesW = waitFor(dmSock, 'lootNotes', 6000, (p) => p.notes['bowl-1'] === SECRET);
dmSock.emit('lootNoteSet', { itemId: 'bowl-1', text: SECRET });
ok(!!(await notesW.catch(() => null)), 'the DM receives the note');
plSock.emit('lootNoteSet', { itemId: 'bowl-1', text: 'player was here' });
await pause(800);
// Put the chest on the player's map, beside nobody in particular: whatever
// the player is sent about it must not carry the note.
dmSock.emit('dropFolderOnMap', { folderId, mapId, q: 3, r: 3 });
await pause(1500);
ok(!plTraffic.some((t) => t.includes(SECRET)), 'the note never reaches the player, on any event');
const rejoinW = waitFor(dmSock, 'lootNotes', 6000);
dmSock.emit('joinCampaign', { campaignId: camp.id });
const after = await rejoinW.catch(() => null);
ok(after?.notes['bowl-1'] === SECRET, 'a player’s attempt did not overwrite it, and it survives a rejoin');

// ---------- all-maps counters ----------
console.log('all-maps counters');
const mapListW = waitFor(dmSock, 'mapList', 6000, (p) => p.maps.some((m) => m.name === 'Khay’s Chamber'));
dmSock.emit('createMap', { name: 'Khay’s Chamber' });
const mapB = (await mapListW).maps.find((m) => m.name === 'Khay’s Chamber').id;
const made = waitFor(dmSock, 'counters', 6000, (p) => p.mapId === mapId && p.counters.length > 0);
dmSock.emit('counterCreate', { mapId });
const counter = (await made).counters[0];
const shownW = waitFor(dmSock, 'counters', 6000, (p) => p.mapId === mapB && p.counters.some((c) => c.id === counter.id));
dmSock.emit('counterUpdate', { counterId: counter.id, patch: { name: 'Timeline Stability', visible: true, allMaps: true } });
ok(!!(await shownW.catch(() => null)), 'switched on, it appears over the other map too');
// The player is sent to the other map and asks for its counters.
dmSock.emit('assignPlayerMap', { userId: pl.user.id, mapId: mapB });
await pause(1200);
const plB = waitFor(plSock, 'counters', 6000, (p) => p.mapId === mapB);
plSock.emit('countersGet', { mapId: mapB });
const gotB = await plB.catch(() => null);
ok(!!gotB?.counters.some((c) => c.name === 'Timeline Stability'), 'the player on the other map sees it');
const offW = waitFor(dmSock, 'counters', 6000, (p) => p.mapId === mapB && !p.counters.some((c) => c.id === counter.id));
dmSock.emit('counterUpdate', { counterId: counter.id, patch: { allMaps: false } });
ok(!!(await offW.catch(() => null)), 'switched off, it leaves the other map');
dmSock.emit('assignPlayerMap', { userId: pl.user.id, mapId: null });
await pause(800);

// ---------- Dramatic Tasks ----------
console.log('dramatic task');
dmSock.emit('dtaskStart', { name: 'Shut down Inpu', tokensNeeded: 8, maxRounds: 5 });
await pause(800);
ok(!dmInit?.dramaticTask && dmErrors.some((e) => e.includes('Start the fight first')), 'refused while no fight is running');
dmSock.emit('initAdd', { name: 'Inpu Sentinel', value: 10 });
await pause(500);
dmSock.emit('initSetActive', { active: true });
await pause(800);
dmSock.emit('dtaskStart', { name: 'Shut down Inpu', tokensNeeded: 8, maxRounds: 5 });
await pause(800);
ok(dmInit?.dramaticTask?.tokensNeeded === 8 && dmInit.dramaticTask.maxRounds === 5, 'starts on the tracker: 8 tokens in 5 rounds');
ok(plInit?.dramaticTask?.name === 'Shut down Inpu', 'the player sees the task too');

plSock.emit('dtaskAdjust', { delta: 5 });
await pause(600);
ok(dmInit.dramaticTask.tokens === 0, 'a player cannot award tokens');

// Rolls are announced for a couple of seconds before they land.
const rollW = waitFor(dmSock, 'chatMsg', 8000, (p) => !!p.msg.roll && p.msg.text.includes('platform core'));
dmSock.emit('chat', { text: '/r 1d4+8 # Electronics on the platform core' });
const roll = (await rollW).msg;
// 9–12: a success and one raise or two — two or three tokens.
const expected = 1 + Math.floor((roll.roll.total - 4) / 4);
dmSock.emit('dtaskCountRoll', { messageId: roll.id });
await pause(800);
ok(dmInit.dramaticTask.tokens === expected && expected >= 2, `a ${roll.roll.total} scores ${expected} tokens (success + raises)`);
dmSock.emit('dtaskCountRoll', { messageId: roll.id });
await pause(800);
ok(dmInit.dramaticTask.tokens === expected && dmErrors.some((e) => e.includes('already counted')), 'the same roll cannot count twice');

const missW = waitFor(dmSock, 'chatMsg', 8000, (p) => !!p.msg.roll && p.msg.text.includes('fumble'));
dmSock.emit('chat', { text: '/r 1d2 # a fumble' });
const miss = (await missW).msg;
dmSock.emit('dtaskCountRoll', { messageId: miss.id });
await pause(800);
ok(dmInit.dramaticTask.tokens === expected, 'a failure scores nothing');

dmSock.emit('dtaskAdjust', { delta: 8 - expected, why: 'held Inpu off the robbers' });
await pause(800);
ok(dmInit.dramaticTask.tokens === 8, 'tokens awarded by hand');
ok(plChat.some((m) => m.kind === 'system' && m.text.includes('Shut down Inpu is done')), 'reaching the target announces success');

dmSock.emit('dtaskEnd', {});
await pause(800);
ok(!dmInit.dramaticTask && plChat.some((m) => m.text.includes('succeeded with 8/8')), 'ending it clears the bar and posts the result');
ok(dmInit.active === true, 'the fight carries on');

dmSock.close(); plSock.close();
console.log('');
console.log(failures === 0 ? 'thebes tools: all checks passed' : `thebes tools: ${failures} check(s) FAILED`);
await pause(300);
process.exit(failures ? 1 : 0);
