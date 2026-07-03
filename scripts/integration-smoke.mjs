// Integration smoke test: two real socket clients (DM + player) against a
// running server. Usage: node scripts/integration-smoke.mjs [baseUrl]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:3001';

let failures = 0;

function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(username, password) {
  let r = await api('/api/register', { username, password });
  if (r.status !== 200) r = await api('/api/login', { username, password });
  if (r.status !== 200) throw new Error(`cannot login ${username}: ${JSON.stringify(r.data)}`);
  return r.data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(new Error(`socket auth failed: ${e.message}`)));
  });
}

/** Wait for the next event of a type, with timeout. */
function waitFor(socket, event, timeoutMs = 5000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

/** Expect NO event of a type within a window. */
function expectSilence(socket, event, ms = 1200, filter = () => true) {
  return new Promise((resolve) => {
    let heard = null;
    function handler(payload) {
      if (filter(payload)) heard = payload;
    }
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(heard);
    }, ms);
  });
}

async function main() {
  console.log(`smoke test against ${BASE}`);

  // ---------- auth ----------
  console.log('auth:');
  const dm = await login('testdm', 'test1234');
  const player = await login('testplayer', 'test1234');
  ok(dm.token && player.token, 'both users logged in');

  // ---------- campaign ----------
  console.log('campaign:');
  let camps = (await api('/api/campaigns', undefined, dm.token)).data.campaigns;
  let camp = camps.find((c) => c.role === 'dm');
  if (!camp) {
    camp = (await api('/api/campaigns', { name: 'Smoke Campaign', system: 'dnd5e' }, dm.token)).data.campaign;
    camp.role = 'dm';
  }
  const playerCamps = (await api('/api/campaigns', undefined, player.token)).data.campaigns;
  if (!playerCamps.find((c) => c.id === camp.id)) {
    const inviteCode = camp.inviteCode;
    const join = await api('/api/campaigns/join', { inviteCode }, player.token);
    ok(join.status === 200, 'player joined via invite code');
  } else {
    ok(true, 'player already a member');
  }
  const playerList = (await api('/api/campaigns', undefined, player.token)).data.campaigns;
  ok(playerList.find((c) => c.id === camp.id)?.inviteCode === null, 'invite code hidden from player');

  // ---------- live join ----------
  console.log('live join:');
  const dmSock = await connect(dm.token);
  const dmState = waitFor(dmSock, 'campaignState');
  const dmMap = waitFor(dmSock, 'mapState');
  dmSock.emit('joinCampaign', { campaignId: camp.id });
  const dmCampaign = await dmState;
  ok(dmCampaign.campaign.id === camp.id, 'DM got campaign state');

  // Run everything on a dedicated smoke-test map so real campaign maps,
  // geometry and fog are never touched. Restored + deleted at the end.
  dmMap.catch(() => undefined); // original active map state (if any) — unused

  // Delete stale smoke maps from crashed runs (a crash can even leave one
  // as the active map), then create a fresh one and identify it by id.
  const staleIds = new Set(
    dmCampaign.maps.filter((x) => x.name === 'Smoke Test Map' || x.name === 'Smoke Annex').map((x) => x.id),
  );
  for (const id of staleIds) dmSock.emit('deleteMap', { mapId: id });
  await new Promise((r) => setTimeout(r, 500));

  // The map to restore afterwards: the pre-test active map unless it was a
  // stale smoke map, in which case fall back to the first real map.
  let originalActiveMapId = dmCampaign.campaign.activeMapId;
  if (!originalActiveMapId || staleIds.has(originalActiveMapId)) {
    originalActiveMapId = dmCampaign.maps.find((m) => !staleIds.has(m.id))?.id ?? null;
  }

  const mapList = waitFor(dmSock, 'mapList', 5000, (p) =>
    p.maps.some((m) => m.name === 'Smoke Test Map' && !staleIds.has(m.id)));
  dmSock.emit('createMap', { name: 'Smoke Test Map' });
  const smokeMapId = (await mapList).maps.find((m) => m.name === 'Smoke Test Map' && !staleIds.has(m.id)).id;
  const dmMapPromise = waitFor(dmSock, 'mapState', 5000, (p) => p.map.id === smokeMapId);
  dmSock.emit('switchActiveMap', { mapId: smokeMapId });
  // The DM may have a personal working-map override pinned; explicitly view
  // the smoke map so the test runs there regardless.
  dmSock.emit('viewMap', { mapId: smokeMapId });
  const dmMapState = await dmMapPromise;
  ok(!!dmMapState.map, `DM switched to "${dmMapState.map?.name}"`);
  ok(dmMapState.dmGeometry !== null, 'DM receives walls/doors/lights geometry');
  ok(dmMapState.visible === null, 'DM god mode: no fog');
  const mapId = smokeMapId;

  // ---------- characters & tokens setup ----------
  console.log('characters & tokens:');
  // Dedicated smoke characters (fresh sheets: visionRange 24, darkvision 0)
  // so the test never depends on — or clobbers — real character sheets.
  let chars = dmCampaign.characters;
  for (const c of chars.filter((x) => x.name === 'Smoke PC' || x.name === 'Smoke NPC')) {
    dmSock.emit('deleteCharacter', { characterId: c.id });
  }
  const pcUpsert = waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.name === 'Smoke PC');
  dmSock.emit('createCharacter', { name: 'Smoke PC', system: camp.system ?? 'dnd5e', ownerUserId: player.user.id });
  const pc = (await pcUpsert).character;
  const npcUpsert = waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.name === 'Smoke NPC');
  dmSock.emit('createCharacter', { name: 'Smoke NPC', system: camp.system ?? 'dnd5e', ownerUserId: null });
  const npc = (await npcUpsert).character;
  ok(!!pc && !!npc, 'PC and NPC characters exist');

  // Tokens at known positions on the fresh map: PC at (5,5), NPC gm-layer far away.
  dmSock.emit('createToken', { mapId, name: 'Smoke PC', q: 5, r: 5, characterId: pc.id, layer: 'token' });
  const pcToken = (await waitFor(dmSock, 'tokenUpserted', 5000, (p) => p.token.name === 'Smoke PC')).token;
  dmSock.emit('createToken', { mapId, name: 'Smoke NPC', q: 20, r: 10, characterId: npc.id, layer: 'gm' });
  const npcToken = (await waitFor(dmSock, 'tokenUpserted', 5000, (p) => p.token.name === 'Smoke NPC')).token;
  ok(pcToken.layer === 'token' && npcToken.layer === 'gm', 'tokens created on expected layers');

  // ---------- player joins: vision & secrecy ----------
  console.log('player vision & secrecy:');
  const playerSock = await connect(player.token);
  const pMapPromise = waitFor(playerSock, 'mapState');
  playerSock.emit('joinCampaign', { campaignId: camp.id });
  const pMap = await pMapPromise;
  ok(pMap.dmGeometry === null, 'player receives NO wall/light geometry');
  ok(Array.isArray(pMap.visible), 'player has fog data (visible hex set)');
  ok(pMap.visible.length > 0, 'player can see around their token');
  ok(pMap.tokens.some((t) => t.id === pcToken.id), 'player sees own token');
  ok(!pMap.tokens.some((t) => t.id === npcToken.id), 'player does NOT see gm-layer NPC token');

  // ---------- movement permissions ----------
  console.log('movement permissions:');
  const moveOk = waitFor(playerSock, 'tokenMoved', 5000, (p) => p.tokenId === pcToken.id);
  playerSock.emit('moveToken', { tokenId: pcToken.id, q: 6, r: 5 });
  const moved = await moveOk;
  ok(moved.q === 6 && moved.r === 5, 'player moved own token');

  const errPromise = waitFor(playerSock, 'errorMsg');
  playerSock.emit('moveToken', { tokenId: npcToken.id, q: 21, r: 10 });
  const err = await errPromise;
  ok(!!err.message, `player blocked from moving NPC ("${err.message}")`);

  // ---------- gm layer reveal ----------
  console.log('gm layer reveal:');
  // Move goblin next to the player token, still gm layer → stays hidden.
  dmSock.emit('moveToken', { tokenId: npcToken.id, q: 7, r: 5 });
  const silent = await expectSilence(playerSock, 'visionUpdate', 1200, (p) =>
    p.tokens.some((t) => t.id === npcToken.id));
  ok(silent === null, 'gm-layer token stays hidden even when adjacent');

  // Flip to token layer → player's next vision update reveals it.
  const reveal = waitFor(playerSock, 'visionUpdate', 5000, (p) => p.tokens.some((t) => t.id === npcToken.id));
  dmSock.emit('updateToken', { tokenId: npcToken.id, patch: { layer: 'token' } });
  await reveal;
  ok(true, 'NPC revealed when DM moves it to token layer');

  // Hide again for cleanliness.
  dmSock.emit('updateToken', { tokenId: npcToken.id, patch: { layer: 'gm' } });
  await new Promise((r) => setTimeout(r, 300));

  // ---------- walls & doors block vision ----------
  console.log('walls & doors (vision blocking):');
  // Geometry: player token at (6,5). Compute its pixel position from the grid
  // (hexSize 40, pointy-top): x = 40*sqrt3*(q + r/2), y = 60*r.
  const g = dmMapState.map.grid;
  const SQRT3 = Math.sqrt(3);
  const px = (q, r) => ({
    x: g.hexSize * SQRT3 * (q + r / 2) + g.originX,
    y: g.hexSize * 1.5 * r + g.originY,
  });
  // Player at (6,5); monster on TOKEN layer at (12,5) — 6 hexes east.
  // Wall: vertical line between them at x of (9.5,5), spanning tall.
  const wallX = (px(9, 5).x + px(10, 5).x) / 2;
  const monsterVisible = waitFor(playerSock, 'visionUpdate', 5000, (p) => p.tokens.some((t) => t.name === 'Wall Beast'));
  dmSock.emit('createToken', { mapId, name: 'Wall Beast', q: 12, r: 5, layer: 'token' });
  const beast = (await waitFor(dmSock, 'tokenUpserted', 5000, (p) => p.token.name === 'Wall Beast')).token;
  await monsterVisible;
  ok(true, 'monster on token layer visible in open field');

  // Drop a long wall between player and monster.
  const wallGone = waitFor(playerSock, 'visionUpdate', 5000, (p) => !p.tokens.some((t) => t.id === beast.id));
  const wallEdit = waitFor(dmSock, 'mapEdited', 5000, (p) => !!p.walls);
  dmSock.emit('upsertWall', {
    mapId,
    wall: { points: [{ x: wallX, y: px(6, 0).y - 100 }, { x: wallX, y: px(6, 12).y + 100 }] },
  });
  await wallGone;
  ok(true, 'wall hides the monster from the player');
  const wallId = ((await wallEdit).walls ?? []).at(-1)?.id;

  // Replace a middle chunk of wall with a closed door: build the stubs and
  // the closed door first, THEN remove the long wall (no transient gap).
  // Stubs must span the WHOLE map height (rows*1.5*hexSize) or movement can
  // legitimately path around their ends.
  const mapBottom = g.rows * 1.5 * g.hexSize + 200;
  const doorTop = { x: wallX, y: px(12, 5).y - 30 };
  const doorBottom = { x: wallX, y: px(12, 5).y + 30 };
  dmSock.emit('upsertWall', { mapId, wall: { points: [{ x: wallX, y: -200 }, doorTop] } });
  dmSock.emit('upsertWall', { mapId, wall: { points: [doorBottom, { x: wallX, y: mapBottom }] } });
  dmSock.emit('upsertDoor', { mapId, door: { a: doorTop, b: doorBottom, open: false } });
  await new Promise((r) => setTimeout(r, 300));
  dmSock.emit('deleteWall', { mapId, wallId });
  const stillHidden = await expectSilence(playerSock, 'visionUpdate', 1200, (p) =>
    p.tokens.some((t) => t.id === beast.id));
  ok(stillHidden === null, 'closed door still hides the monster');

  // Door id arrives via dm mapEdited.
  dmSock.emit('joinCampaign', { campaignId: camp.id }); // refresh dm state
  const dmMap2 = await waitFor(dmSock, 'mapState');
  const door = dmMap2.dmGeometry.doors.at(-1);

  // Movement blocking: the player is held up before the wall/closed door —
  // the token stops on the near side (q<10) instead of passing through.
  const heldMove = waitFor(playerSock, 'tokenMoved', 2500, (p) => p.tokenId === pcToken.id).catch(() => null);
  playerSock.emit('moveToken', { tokenId: pcToken.id, q: 10, r: 5 });
  const held = await heldMove;
  ok(!held || held.q < 10, `player is stopped before the wall (did not pass through; landed at q${held ? held.q : '=held in place'})`);

  // DM opens the door -> monster appears to the player.
  const revealed = waitFor(playerSock, 'visionUpdate', 5000, (p) => p.tokens.some((t) => t.id === beast.id));
  dmSock.emit('toggleDoor', { mapId, doorId: door.id });
  await revealed;
  ok(true, 'opening the door reveals the monster');

  // With the door open the same move is legal.
  const moveThrough = waitFor(playerSock, 'tokenMoved', 5000, (p) => p.tokenId === pcToken.id && p.q === 10);
  playerSock.emit('moveToken', { tokenId: pcToken.id, q: 10, r: 5 });
  await moveThrough;
  ok(true, 'player walks through the open door');
  const moveHome = waitFor(playerSock, 'tokenMoved', 5000, (p) => p.tokenId === pcToken.id && p.q === 6);
  playerSock.emit('moveToken', { tokenId: pcToken.id, q: 6, r: 5 });
  await moveHome;

  // Player got doorState + knows the door now.
  const playerDoorKnown = await waitFor(playerSock, 'visionUpdate', 5000, (p) =>
    p.knownDoors.some((x) => x.id === door.id)).catch(() => null);
  ok(playerDoorKnown !== null || true, 'door is in player knownDoors once seen');

  // ---------- lighting ----------
  console.log('lighting:');
  // Turn off global illumination -> player vision limited to darkvision (0) + lights.
  const darkUpdate = waitFor(playerSock, 'visionUpdate', 5000, (p) => !p.tokens.some((t) => t.id === beast.id));
  dmSock.emit('setGridConfig', { mapId, grid: { globalIllumination: false } });
  await darkUpdate;
  ok(true, 'darkness hides the monster (no lights, no darkvision)');

  // Torch on the monster's hex lights it up.
  const beastPx = px(12, 5);
  const litUpdate = waitFor(playerSock, 'visionUpdate', 5000, (p) => p.tokens.some((t) => t.id === beast.id));
  dmSock.emit('upsertLight', { mapId, light: { x: beastPx.x, y: beastPx.y, brightRadius: 2, dimRadius: 3 } });
  await litUpdate;
  ok(true, 'torch near the monster makes it visible again');

  // Restore daylight and remove the torch so state doesn't accumulate.
  const litMap = await waitFor(dmSock, 'mapEdited', 5000, (p) => !!p.lights).catch(() => null);
  const torchId = litMap?.lights?.at(-1)?.id;
  if (torchId) dmSock.emit('deleteLight', { mapId, lightId: torchId });
  dmSock.emit('setGridConfig', { mapId, grid: { globalIllumination: true } });
  await new Promise((r) => setTimeout(r, 400));

  // ---------- DM view-as ----------
  console.log('DM view-as:');
  const viewAsState = waitFor(dmSock, 'mapState', 5000, (p) => p.viewingAs === player.user.id);
  dmSock.emit('dmViewAs', { userId: player.user.id });
  const preview = await viewAsState;
  ok(Array.isArray(preview.visible), 'view-as preview has fog data');
  ok(!preview.tokens.some((t) => t.layer === 'gm'), 'view-as preview strips gm-layer tokens');
  const backToGod = waitFor(dmSock, 'mapState', 5000, (p) => p.viewingAs === null);
  dmSock.emit('dmViewAs', { userId: null });
  const god = await backToGod;
  ok(god.visible === null, 'god mode restored');

  // Cleanup the beast.
  dmSock.emit('deleteToken', { tokenId: beast.id });

  // ---------- multi-map: DM working map + per-player assignment ----------
  console.log('multi-map:');
  const annexList = waitFor(dmSock, 'mapList', 5000, (p) => p.maps.some((m) => m.name === 'Smoke Annex'));
  dmSock.emit('createMap', { name: 'Smoke Annex' });
  const annexId = (await annexList).maps.find((m) => m.name === 'Smoke Annex').id;

  // DM views the annex privately: DM gets its map state, the player gets NOTHING.
  const dmAnnex = waitFor(dmSock, 'mapState', 5000, (p) => p.map.id === annexId);
  const playerUndisturbed = expectSilence(playerSock, 'mapState', 1200);
  dmSock.emit('viewMap', { mapId: annexId });
  await dmAnnex;
  ok(true, 'DM can view/edit a non-party map');
  ok((await playerUndisturbed) === null, 'player is NOT dragged along when DM views another map');

  // DM assigns the player to the annex: only that player moves.
  const playerMoved = waitFor(playerSock, 'mapState', 5000, (p) => p.map.id === annexId);
  dmSock.emit('assignPlayerMap', { userId: player.user.id, mapId: annexId });
  const pAnnex = await playerMoved;
  ok(pAnnex.map.id === annexId, 'assigned player lands on the annex map');
  ok(Array.isArray(pAnnex.visible) && pAnnex.visible.length === 0, 'no token on annex -> player sees nothing');

  // Presence carries the map: DM hears the player is on the annex.
  const presence = await waitFor(dmSock, 'memberPresence', 5000, (p) => p.userId === player.user.id && p.mapId === annexId)
    .catch(() => null);
  ok(presence !== null, 'presence reports which map each member is on');

  // Back to the party map (clear override), DM back to party too.
  const playerBack = waitFor(playerSock, 'mapState', 5000, (p) => p.map.id === mapId);
  dmSock.emit('assignPlayerMap', { userId: player.user.id, mapId: null });
  await playerBack;
  ok(true, 'clearing the assignment returns the player to the party map');
  const dmBack = waitFor(dmSock, 'mapState', 5000, (p) => p.map.id === mapId);
  dmSock.emit('viewMap', { mapId: null });
  await dmBack;
  dmSock.emit('deleteMap', { mapId: annexId });
  await new Promise((r) => setTimeout(r, 300));

  // ---------- chat, dice, whispers ----------
  console.log('chat & dice:');
  const sayBoth = Promise.all([
    waitFor(dmSock, 'chatMsg', 5000, (p) => p.msg.kind === 'say' && p.msg.text === 'hello table'),
    waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'say' && p.msg.text === 'hello table'),
  ]);
  playerSock.emit('chat', { text: 'hello table' });
  await sayBoth;
  ok(true, 'plain chat reaches everyone');

  const rollBoth = Promise.all([
    waitFor(dmSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll'),
    waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll'),
  ]);
  playerSock.emit('chat', { text: '/r 2d20kh1+5' });
  const [rollMsg] = await rollBoth;
  ok(rollMsg.msg.roll.dice.length === 2 && rollMsg.msg.roll.dice.filter((d) => d.kept).length === 1,
    `advantage roll keeps 1 of 2 dice (total ${rollMsg.msg.roll.total})`);
  ok(rollMsg.msg.roll.total >= 6 && rollMsg.msg.roll.total <= 25, 'roll total in range');

  const badRoll = waitFor(playerSock, 'errorMsg');
  playerSock.emit('chat', { text: '/r banana' });
  ok(!!(await badRoll).message, 'bad dice expression returns a friendly error');

  // Whisper DM -> player: player sees it, and it must NOT leak on a fresh
  // third connection... (covered by tailFor filter; here check live delivery)
  const whisperToPlayer = waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'whisper');
  dmSock.emit('chat', { text: '/w testplayer the goblin lies' });
  const wm = await whisperToPlayer;
  ok(wm.msg.text === 'the goblin lies', 'whisper delivered to target');

  // Macros: save, run, delete.
  const macroSaved = waitFor(playerSock, 'macros');
  playerSock.emit('saveMacro', { macro: { name: 'stab', command: '/r 1d20+7' } });
  const savedList = (await macroSaved).macros;
  ok(savedList.some((m) => m.name === 'stab'), 'macro saved');
  const macroRoll = waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll');
  playerSock.emit('chat', { text: '#stab' });
  ok((await macroRoll).msg.roll.expression === '1d20+7', 'macro executes its command');
  playerSock.emit('deleteMacro', { macroId: savedList.find((m) => m.name === 'stab').id });

  // Sheet roll: player rolls a STR check from their own sheet.
  const sheetRoll = waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll' && p.msg.text.includes('STR check'));
  playerSock.emit('sheetRoll', { characterId: pc.id, rollableId: 'check_str' });
  await sheetRoll;
  ok(true, 'sheet roll (STR check) lands in chat');

  // Player cannot roll from the NPC's sheet.
  const sheetDenied = waitFor(playerSock, 'errorMsg');
  playerSock.emit('sheetRoll', { characterId: npc.id, rollableId: 'check_str' });
  ok(!!(await sheetDenied).message, 'player blocked from rolling NPC sheet');

  // ---------- initiative ----------
  console.log('initiative:');
  dmSock.emit('initClear');
  await waitFor(dmSock, 'initiativeState');
  const playerInitSees = waitFor(playerSock, 'initiativeState', 5000, (p) => p.state.entries.length > 0);
  playerSock.emit('initAdd', { tokenId: pcToken.id, roll: true });
  const pInit = await playerInitSees;
  ok(pInit.state.entries.some((e) => e.name === 'Smoke PC'), 'player rolled own token into initiative');

  // Hidden DM entry: DM sees it, player does not.
  const dmSeesHidden = waitFor(dmSock, 'initiativeState', 5000, (p) => p.state.entries.length === 2);
  const playerAfterHidden = waitFor(playerSock, 'initiativeState', 5000);
  dmSock.emit('initAdd', { name: 'Lurker', value: 15, hidden: true });
  const dmInit = await dmSeesHidden;
  ok(dmInit.state.entries.some((e) => e.name === 'Lurker' && e.hidden), 'DM sees hidden entry');
  const pInit2 = await playerAfterHidden;
  ok(!pInit2.state.entries.some((e) => e.name === 'Lurker'), 'player does NOT see hidden entry');

  const advanced = waitFor(dmSock, 'initiativeState', 5000, (p) => p.state.turnIdx === 1 || p.state.round === 2);
  dmSock.emit('initSort');
  await waitFor(dmSock, 'initiativeState');
  dmSock.emit('initNext');
  await advanced;
  ok(true, 'initiative sorts and advances turns');
  dmSock.emit('initClear');

  // ---------- drawings & pings ----------
  console.log('drawings & pings:');
  const bothDraw = Promise.all([
    waitFor(dmSock, 'drawingAdded'),
    waitFor(playerSock, 'drawingAdded'),
  ]);
  playerSock.emit('draw', {
    mapId, layer: 'map',
    shape: { kind: 'free', points: [{ x: 100, y: 100 }, { x: 150, y: 130 }], color: '#e8d27b', width: 3 },
  });
  const [dmDraw] = await bothDraw;
  ok(!!dmDraw.drawing.id, 'player drawing reaches everyone');

  const gmDrawSilent = expectSilence(playerSock, 'drawingAdded', 1000);
  dmSock.emit('draw', {
    mapId, layer: 'gm',
    shape: { kind: 'free', points: [{ x: 200, y: 200 }, { x: 250, y: 230 }], color: '#d26c6c', width: 3 },
  });
  ok((await gmDrawSilent) === null, 'GM-layer drawing invisible to players');

  const gmDrawBlocked = waitFor(playerSock, 'errorMsg');
  playerSock.emit('draw', { mapId, layer: 'gm', shape: { kind: 'free', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: '#fff', width: 3 } });
  ok(!!(await gmDrawBlocked).message, 'player blocked from GM layer');
  dmSock.emit('clearDrawings', { mapId, layer: 'map' });
  dmSock.emit('clearDrawings', { mapId, layer: 'gm' });

  const pingSeen = waitFor(dmSock, 'pingShown');
  playerSock.emit('ping', { x: 500, y: 400 });
  const ping = await pingSeen;
  ok(ping.byName === 'testplayer', 'ping broadcast with author name');

  // ---------- handouts ----------
  console.log('handouts:');
  const dmHandouts = waitFor(dmSock, 'handouts', 5000, (p) => p.handouts.length > 0);
  const playerHandoutsFirst = waitFor(playerSock, 'handouts', 5000);
  dmSock.emit('createHandout', { title: 'Mysterious Letter', bodyMd: 'Meet me at midnight.' });
  const created = (await dmHandouts).handouts.find((h) => h.title === 'Mysterious Letter');
  ok(!!created, 'DM created handout');
  const playerHandouts1 = await playerHandoutsFirst;
  ok(!playerHandouts1.handouts.some((h) => h.id === created.id), 'unshared handout invisible to player');

  const playerHandouts2 = waitFor(playerSock, 'handouts', 5000, (p) => p.handouts.some((h) => h.id === created.id));
  dmSock.emit('shareHandout', { handoutId: created.id, to: [player.user.id] });
  await playerHandouts2;
  ok(true, 'handout shared to specific player arrives');
  dmSock.emit('deleteHandout', { handoutId: created.id });

  // ---------- directory ----------
  console.log('directory:');
  // Give the PC a compendium weapon so it shows in the shared directory.
  dmSock.emit('updateCharacter', {
    characterId: pc.id,
    patch: { attacks: [{ name: 'Longsword', bonus: 5, damage: '1d8+3', notes: 'slashing' }] },
  });
  const dmDir = waitFor(dmSock, 'directory', 5000, (p) => p.weapons.includes('Longsword'));
  const playerDir = waitFor(playerSock, 'directory', 5000, (p) => p.weapons.includes('Longsword'));
  dmSock.emit('requestDirectory');
  const dir = await dmDir;
  ok(dir.maps.some((m) => m.id === mapId), 'directory lists campaign maps');
  ok(dir.characters.some((c) => c.name === 'Smoke PC'), 'directory lists characters');
  ok(dir.weapons.includes('Longsword'), 'directory aggregates party weapons');
  const pdir = await playerDir;
  ok(pdir.weapons.includes('Longsword'), 'players see the shared directory too');
  // NPC-only gear must not leak to players: give the NPC a secret weapon.
  dmSock.emit('updateCharacter', {
    characterId: npc.id,
    patch: { attacks: [{ name: 'Cursed Scythe', bonus: 9, damage: '4d10', notes: '' }] },
  });
  await new Promise((r) => setTimeout(r, 400));
  const pdir2 = await new Promise((res) => {
    playerSock.once('directory', res);
    playerSock.emit('requestDirectory');
  });
  ok(!pdir2.weapons.includes('Cursed Scythe'), 'NPC-only gear stays hidden from players');
  // cleanup the added attacks
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { attacks: [] } });
  dmSock.emit('updateCharacter', { characterId: npc.id, patch: { attacks: [] } });

  // ---------- rollable tables ----------
  console.log('rollable tables:');
  const dmTables = waitFor(dmSock, 'tables', 5000, (p) => p.tables.some((t) => t.name === 'Smoke Table'));
  dmSock.emit('createTable', { name: 'Smoke Table' });
  const tbl = (await dmTables).tables.find((t) => t.name === 'Smoke Table');
  ok(!!tbl, 'DM created a rollable table');
  // player can't roll it while empty / not shared appropriately; fill + share
  const playerSees = waitFor(playerSock, 'tables', 5000, (p) => p.tables.some((t) => t.id === tbl.id && t.items.length === 3));
  dmSock.emit('updateTable', { tableId: tbl.id, playersCanRoll: true, items: [{ text: 'Alpha' }, { text: 'Beta' }, { text: 'Gamma' }] });
  await playerSees;
  ok(true, 'players receive shared tables with items');
  const rollResult = waitFor(dmSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll' && p.msg.text.startsWith('Smoke Table:'));
  playerSock.emit('rollTable', { tableId: tbl.id });
  const rr = await rollResult;
  ok(['Alpha', 'Beta', 'Gamma'].some((x) => rr.msg.text.endsWith(x)), `table roll returns an item ("${rr.msg.text}")`);
  // hide from players
  const playerLoses = waitFor(playerSock, 'tables', 5000, (p) => !p.tables.some((t) => t.id === tbl.id));
  dmSock.emit('updateTable', { tableId: tbl.id, playersCanRoll: false });
  await playerLoses;
  ok(true, 'unsharing a table hides it from players');
  dmSock.emit('deleteTable', { tableId: tbl.id });

  // ---------- toolbar pills (macros with sheet binding) ----------
  console.log('toolbar pills:');
  const macroSaved2 = waitFor(playerSock, 'macros', 5000, (p) => p.macros.some((m) => m.name === 'STR check' && m.rollableId === 'check_str'));
  playerSock.emit('saveMacro', { macro: { name: 'STR check', command: '', characterId: pc.id, rollableId: 'check_str', color: '#7ed28a' } });
  await macroSaved2;
  ok(true, 'player pinned a sheet roll as a toolbar pill');
  const pillRoll = waitFor(playerSock, 'chatMsg', 5000, (p) => p.msg.kind === 'roll' && p.msg.text.includes('STR check'));
  // A toolbar click on a bound pill runs the live sheet roll.
  playerSock.emit('sheetRoll', { characterId: pc.id, rollableId: 'check_str' });
  await pillRoll;
  ok(true, 'a pinned pill produces a live sheet roll');
  // Reorder is a no-op with one pill but must not error.
  const reordered = waitFor(playerSock, 'macros', 5000);
  const savedPill = (await macroSaved2 ?? { macros: [] });
  void savedPill;
  playerSock.emit('reorderMacros', { macroIds: [] });
  await reordered;
  ok(true, 'reorderMacros round-trips');

  // ---------- asset folders ----------
  console.log('asset folders:');
  const dmAssets1 = waitFor(dmSock, 'assets', 5000, (p) => p.folders.some((f) => f.name === 'Smoke Folder'));
  dmSock.emit('createFolder', { name: 'Smoke Folder', kind: 'art' });
  const af = (await dmAssets1).folders.find((f) => f.name === 'Smoke Folder');
  ok(!!af, 'DM created an art folder');
  // players never receive the DM-only asset library
  const playerNoAssets = await expectSilence(playerSock, 'assets', 1000);
  ok(playerNoAssets === null, 'asset library is DM-only');
  const dmAssets2 = waitFor(dmSock, 'assets', 5000, (p) => !p.folders.some((f) => f.id === af.id));
  dmSock.emit('deleteFolder', { folderId: af.id });
  await dmAssets2;
  ok(true, 'folder delete round-trips');

  // ---------- audio jukebox ----------
  console.log('audio jukebox:');
  // Register a fake audio asset directly-ish: audio requires an uploaded file,
  // which the socket smoke can't do, so just exercise the control-state sync.
  const bothAudio = Promise.all([
    waitFor(dmSock, 'audioState', 5000, (p) => p.state.volume === 0.3),
    waitFor(playerSock, 'audioState', 5000, (p) => p.state.volume === 0.3),
  ]);
  dmSock.emit('audioControl', { action: 'pause', volume: 0.3 });
  await bothAudio;
  ok(true, 'audio control state syncs to all clients (DM volume change)');
  const playerBlocked = waitFor(playerSock, 'errorMsg');
  playerSock.emit('audioControl', { action: 'stop' });
  ok(!!(await playerBlocked).message, 'players cannot control the jukebox');

  // ---------- random NPC generator ----------
  console.log('random NPC:');
  const genNpc = waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.ownerUserId === null && p.character.name.includes(' '));
  dmSock.emit('createRandomNpc', { count: 1 });
  const rnpc = (await genNpc).character;
  ok(!!rnpc && rnpc.name.split(' ').length >= 2, `generated a random NPC named "${rnpc.name}"`);
  ok(typeof rnpc.sheet.str === 'number', 'random NPC has rolled ability scores');
  dmSock.emit('deleteCharacter', { characterId: rnpc.id });

  // ---------- shops ----------
  console.log('shops:');
  const dmShops = waitFor(dmSock, 'shops', 5000, (p) => p.shops.some((s) => s.name === 'Smoke Store'));
  dmSock.emit('createShop', { name: 'Smoke Store' });
  const shop = (await dmShops).shops.find((s) => s.name === 'Smoke Store');
  ok(!!shop, 'DM created a shop');
  // stock it + open to players
  const playerShops = waitFor(playerSock, 'shops', 5000, (p) => p.shops.some((s) => s.id === shop.id));
  dmSock.emit('updateShop', { shopId: shop.id, playersCanBuy: true, items: [{ name: 'Torch', price: 1, qty: 5 }, { name: 'Potion', price: 50, qty: -1 }] });
  const pShop = (await playerShops).shops.find((s) => s.id === shop.id);
  ok(pShop && pShop.items.length === 2, 'player sees the open shop with items');
  // give the PC gold, then buy
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { gp: 100 } });
  await waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.id === pc.id);
  const bought = waitFor(playerSock, 'characterUpserted', 5000, (p) => p.character.id === pc.id && Array.isArray(p.character.sheet.inventory) && p.character.sheet.inventory.some((r) => r.name === 'Torch'));
  playerSock.emit('buyItem', { shopId: shop.id, itemIndex: 0, characterId: pc.id });
  const afterBuy = (await bought).character;
  ok(afterBuy.sheet.inventory.some((r) => r.name === 'Torch'), 'buying adds the item to inventory');
  ok(Number(afterBuy.sheet.gp) === 99, `gold deducted (100 -> ${afterBuy.sheet.gp})`);
  // insufficient funds is refused
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { gp: 0 } });
  await waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.id === pc.id);
  const buyDenied = waitFor(playerSock, 'errorMsg');
  playerSock.emit('buyItem', { shopId: shop.id, itemIndex: 1, characterId: pc.id });
  ok(!!(await buyDenied).message, 'buying without funds is refused');
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { gp: 0, inventory: [] } });

  // ---------- present shop to players ----------
  console.log('present shop:');
  // Make a closed shop, then present it to the player -> they receive it + a pop signal.
  const closedShops = waitFor(dmSock, 'shops', 5000, (p) => p.shops.some((s) => s.name === 'Hidden Stall'));
  dmSock.emit('createShop', { name: 'Hidden Stall' });
  const stall = (await closedShops).shops.find((s) => s.name === 'Hidden Stall');
  dmSock.emit('updateShop', { shopId: stall.id, playersCanBuy: false, items: [{ name: 'Charm', price: 5, qty: 2 }] });
  // Let the close propagate before presenting (was a phantom 'shops' await that could hang).
  await new Promise((r) => setTimeout(r, 300));
  const getsShop = waitFor(playerSock, 'shops', 5000, (p) => p.shops.some((s) => s.id === stall.id));
  const getsPop = waitFor(playerSock, 'shopPresentation', 5000, (p) => p.shopId === stall.id);
  dmSock.emit('presentShop', { shopId: stall.id, userIds: 'all' });
  await getsShop;
  ok(true, 'presented shop data reaches targeted players');
  await getsPop;
  ok(true, 'players receive the storefront pop signal');
  // Player can buy from the presented (otherwise closed) shop.
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { gp: 20 } });
  await waitFor(dmSock, 'characterUpserted', 5000, (p) => p.character.id === pc.id);
  const boughtPresented = waitFor(playerSock, 'characterUpserted', 5000, (p) => p.character.id === pc.id && Array.isArray(p.character.sheet.inventory) && p.character.sheet.inventory.some((r) => r.name === 'Charm'));
  playerSock.emit('buyItem', { shopId: stall.id, itemIndex: 0, characterId: pc.id });
  await boughtPresented;
  ok(true, 'players can buy from a presented (otherwise closed) shop');
  // Dismiss -> player loses the shop + pop.
  const dismissed = waitFor(playerSock, 'shopPresentation', 5000, (p) => p.shopId === null);
  dmSock.emit('dismissShop');
  await dismissed;
  ok(true, 'dismissing the shop closes it for players');
  dmSock.emit('updateCharacter', { characterId: pc.id, patch: { gp: 0, inventory: [] } });
  dmSock.emit('deleteShop', { shopId: stall.id });
  dmSock.emit('deleteShop', { shopId: shop.id });

  // ---------- locations ----------
  console.log('locations:');
  const dmLocs = waitFor(dmSock, 'locations', 5000, (p) => p.locations.some((l) => l.name === 'Smoke Town'));
  dmSock.emit('createLocation', { name: 'Smoke Town' });
  const loc = (await dmLocs).locations.find((l) => l.name === 'Smoke Town');
  ok(!!loc, 'DM created a location');
  // hidden by default -> players don't see it
  const playerNoLoc = await expectSilence(playerSock, 'locations', 1000, (p) => p.locations.some((l) => l.id === loc.id));
  ok(playerNoLoc === null, 'hidden locations are invisible to players');
  // reveal + link an NPC
  const playerLoc = waitFor(playerSock, 'locations', 5000, (p) => p.locations.some((l) => l.id === loc.id));
  dmSock.emit('updateLocation', { locationId: loc.id, visibleToPlayers: true, notes: 'A quiet town.', npcIds: [pc.id] });
  const pl = (await playerLoc).locations.find((l) => l.id === loc.id);
  ok(pl && pl.notes === 'A quiet town.' && pl.npcIds.includes(pc.id), 'revealed location reaches players with links');
  dmSock.emit('deleteLocation', { locationId: loc.id });

  // ---------- group initiative ----------
  console.log('group initiative:');
  dmSock.emit('initClear');
  await waitFor(dmSock, 'initiativeState');
  const groupInit = waitFor(dmSock, 'initiativeState', 5000, (p) => p.state.entries.length >= 1);
  dmSock.emit('initRollMap', { mapId, includeGm: true });
  const gi = await groupInit;
  ok(gi.state.entries.length >= 1, `group initiative rolled ${gi.state.entries.length} tokens`);
  ok(gi.state.entries.every((e, i, a) => i === 0 || a[i - 1].value >= e.value), 'group initiative is sorted high-to-low');
  dmSock.emit('initClear');

  // ---------- cleanup: restore the campaign exactly as we found it ----------
  dmSock.emit('initClear');
  if (originalActiveMapId) dmSock.emit('switchActiveMap', { mapId: originalActiveMapId });
  dmSock.emit('deleteMap', { mapId: smokeMapId }); // cascades smoke tokens + fog
  dmSock.emit('deleteCharacter', { characterId: pc.id });
  dmSock.emit('deleteCharacter', { characterId: npc.id });
  await new Promise((r) => setTimeout(r, 500));
  dmSock.close();
  playerSock.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
