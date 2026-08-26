// Campaign backup round-trip check.
//
// The question a backup has to answer is not "did the file download" — it is
// "can a server that has never heard of this campaign rebuild it". So this
// runs TWO servers with separate data directories: it builds a campaign on
// the first, exports it, restores the file onto the second, and then compares
// what the second server serves back against what the first one had.
//
// Usage: node scripts/backup-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { io } from 'socket.io-client';

const PORT_A = 3901;
const PORT_B = 3902;
let failures = 0;

function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}`); }
}

async function api(base, path_, body, token) {
  const res = await fetch(`${base}${path_}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(base, username, password) {
  let r = await api(base, '/api/register', { username, password });
  if (r.status !== 200) r = await api(base, '/api/login', { username, password });
  if (r.status !== 200) throw new Error(`cannot login ${username}: ${JSON.stringify(r.data)}`);
  return r.data;
}

function connect(base, token) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(new Error(`socket auth failed: ${e.message}`)));
  });
}

function waitFor(socket, event, timeoutMs = 8000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
    function handler(payload) {
      if (!filter(payload)) return;
      clearTimeout(timer); socket.off(event, handler); resolve(payload);
    }
    socket.on(event, handler);
  });
}

function startServer(port, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.resolve('server'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  proc.stdout.on('data', (b) => log.push(String(b)));
  proc.stderr.on('data', (b) => log.push(String(b)));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 90_000;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://localhost:${port}/healthz`);
        if (r.ok) { clearInterval(poll); resolve(proc); }
      } catch {
        if (Date.now() > deadline) { clearInterval(poll); reject(new Error(`server on ${port} never came up:\n${log.join('')}`)); }
      }
    }, 500);
  });
}

/** A tiny but real PNG, so the asset pipeline has actual bytes to move. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
);

async function uploadPng(base, token, campaignId) {
  const body = new FormData();
  body.append('file', new Blob([PNG], { type: 'image/png' }), 'backdrop.png');
  body.append('campaignId', campaignId);
  body.append('kind', 'map');
  const res = await fetch(`${base}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload failed: ${JSON.stringify(data)}`);
  // { assetId, url: '/uploads/<id>.<ext>', width, height }
  return { id: data.assetId, url: data.url, file: data.url.replace('/uploads/', '') };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r67backup-'));
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const baseA = `http://localhost:${PORT_A}`;
  const baseB = `http://localhost:${PORT_B}`;
  const procs = [];

  try {
    console.log('starting two servers with separate data directories…');
    procs.push(await startServer(PORT_A, dirA));
    procs.push(await startServer(PORT_B, dirB));

    // ---- Build a campaign on server A -------------------------------------
    console.log('building a campaign on server A:');
    const dm = await login(baseA, 'backup_dm', 'pw-backup-dm');
    const player = await login(baseA, 'backup_player', 'pw-backup-player');
    const made = await api(baseA, '/api/campaigns', { name: 'Backup Test Hold', system: 'swade' }, dm.token);
    const campaignId = made.data.campaign.id;
    const inviteCode = made.data.campaign.inviteCode;
    await api(baseA, '/api/campaigns/join', { inviteCode }, player.token);

    const dmSock = await connect(baseA, dm.token);
    const stateP = waitFor(dmSock, 'campaignState');
    dmSock.emit('joinCampaign', { campaignId });
    const state = await stateP;
    const mapId = state.maps[0].id;

    // Geometry, art, a sheet, a token, a chest and a line of chat: one of
    // everything the restore has to carry.
    const asset = await uploadPng(baseA, dm.token, campaignId);
    dmSock.emit('updateMap', { mapId, bgAssetId: asset.id });
    dmSock.emit('upsertWall', { mapId, wall: { points: [{ x: 10, y: 10 }, { x: 200, y: 10 }], type: 'solid' } });
    dmSock.emit('upsertDoor', { mapId, door: { a: { x: 20, y: 40 }, b: { x: 60, y: 40 }, open: false, locked: true, keyName: 'Brass Key' } });
    const charP = waitFor(dmSock, 'characterUpserted', 8000, (p) => p.character.name === 'Backup Hero');
    dmSock.emit('createCharacter', { name: 'Backup Hero', system: 'swade', ownerUserId: player.user.id });
    const hero = (await charP).character;
    dmSock.emit('updateCharacter', { characterId: hero.id, patch: { wounds: 2, bennies: 1, concept: 'the test subject' } });
    const tokenP = waitFor(dmSock, 'tokenUpserted', 8000, (p) => p.token.name === 'Hero Token');
    dmSock.emit('createToken', { mapId, name: 'Hero Token', q: 3, r: 4, characterId: hero.id, layer: 'token' });
    const token = (await tokenP).token;
    const chatP = waitFor(dmSock, 'chatMsg', 8000, (p) => p.msg?.text?.includes('remembered'));
    dmSock.emit('chat', { text: 'This line must be remembered.' });
    await chatP;
    // Let the writes land before reading the campaign back out.
    await new Promise((r) => setTimeout(r, 400));

    const beforeP = waitFor(dmSock, 'campaignState');
    dmSock.emit('joinCampaign', { campaignId });
    const before = await beforeP;
    const mapBeforeP = waitFor(dmSock, 'mapState');
    dmSock.emit('viewMap', { mapId });
    const mapBefore = await mapBeforeP;
    ok(before.characters.some((c) => c.id === hero.id), 'the campaign has the hero we just made');

    // ---- Export ------------------------------------------------------------
    console.log('exporting:');
    const res = await fetch(`${baseA}/api/campaigns/${campaignId}/backup`, { headers: { Authorization: `Bearer ${dm.token}` } });
    ok(res.ok, 'the DM can download a backup');
    const file = Buffer.from(await res.arrayBuffer());
    ok(file.subarray(0, 7).toString('ascii') === 'R67CAMP', 'the file starts with the format’s magic bytes');
    const manifestLen = file.readUInt32LE(8);
    const manifest = JSON.parse(zlib.gunzipSync(file.subarray(12, 12 + manifestLen)).toString('utf-8'));
    ok(manifest.kind === 'roll67.campaign', 'it declares itself a campaign backup');
    ok(manifest.tables.characters.length >= 1, 'characters travelled with it');
    ok(manifest.tables.maps.length >= 1, 'maps travelled with it');
    ok(manifest.tables.tokens.some((t) => t.id === token.id), 'tokens travelled with it');
    ok(manifest.tables.chat_messages.some((m) => String(m.text).includes('remembered')), 'the chat log travelled with it');
    ok(manifest.files.some((f) => f.name === asset.file), 'the uploaded image is listed in the file');
    ok(!JSON.stringify(manifest.users).includes('$2'), 'no password hashes are in the backup');
    // The way this feature rots is a new table nobody adds to the spec, so the
    // file itself names anything it knows it is leaving behind.
    ok(
      (manifest.unaccountedTables ?? []).length === 0,
      `every table in the database is accounted for${(manifest.unaccountedTables ?? []).length ? `: missing ${manifest.unaccountedTables.join(', ')}` : ''}`,
    );
    ok(manifest.users.some((u) => u.username === 'backup_player'), 'the player is named, so their character can be reunited with them');

    const exp = await fetch(`${baseA}/api/campaigns/${campaignId}/backup`, { headers: { Authorization: `Bearer ${player.token}` } });
    ok(exp.status === 403, 'a player cannot download the campaign');

    // ---- Restore onto a server that has never seen it ----------------------
    console.log('restoring onto an empty server B:');
    const dmB = await login(baseB, 'backup_dm', 'pw-backup-dm-elsewhere');
    // The player registers on the new server too — by NAME, which is how a
    // restore reunites people with their characters.
    await login(baseB, 'backup_player', 'pw-backup-player-elsewhere');

    async function restore(token_, replace) {
      const body = new FormData();
      body.append('file', new Blob([file]), 'campaign.r67campaign');
      if (replace) body.append('replace', 'true');
      const r = await fetch(`${baseB}/api/campaigns/restore`, { method: 'POST', headers: { Authorization: `Bearer ${token_}` }, body });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    }

    const restored = await restore(dmB.token, false);
    ok(restored.status === 200, `the restore succeeds${restored.status === 200 ? '' : `: ${JSON.stringify(restored.data)}`}`);
    ok(restored.data.campaignId === campaignId, 'it comes back under its original id');
    ok(restored.data.files >= 1, 'its images were written to the new server');
    ok((restored.data.notes ?? []).length === 0, `nothing was lost in the move${(restored.data.notes ?? []).length ? `: ${restored.data.notes.join(' | ')}` : ''}`);

    const again = await restore(dmB.token, false);
    ok(again.status === 400, 'restoring it a second time refuses rather than duplicating');
    const overwrite = await restore(dmB.token, true);
    ok(overwrite.status === 200, 'restoring with replace overwrites cleanly');

    // ---- Compare -----------------------------------------------------------
    console.log('comparing the rebuilt campaign against the original:');
    const dmSockB = await connect(baseB, dmB.token);
    const afterP = waitFor(dmSockB, 'campaignState');
    dmSockB.emit('joinCampaign', { campaignId });
    const after = await afterP;
    const mapAfterP = waitFor(dmSockB, 'mapState');
    dmSockB.emit('viewMap', { mapId });
    const mapAfter = await mapAfterP;

    ok(after.campaign.name === before.campaign.name, 'the campaign name came back');
    ok(after.campaign.system === before.campaign.system, 'the system came back');
    ok(after.characters.length === before.characters.length, `every character came back (${after.characters.length}/${before.characters.length})`);
    const heroAfter = after.characters.find((c) => c.id === hero.id);
    ok(!!heroAfter, 'the hero kept its id');
    ok(heroAfter?.sheet?.wounds === 2, 'their Wounds came back');
    ok(heroAfter?.sheet?.concept === 'the test subject', 'their sheet came back in full');
    ok(!!heroAfter?.ownerUserId, 'their owner was matched to the account of the same name on the new server');
    ok(after.chatTail.some((m) => m.text.includes('remembered')), 'the chat log came back');
    ok(JSON.stringify(mapAfter.dmGeometry?.walls) === JSON.stringify(mapBefore.dmGeometry?.walls) && (mapBefore.dmGeometry?.walls ?? []).length === 1, 'the walls came back exactly');
    ok(JSON.stringify(mapAfter.dmGeometry?.doors) === JSON.stringify(mapBefore.dmGeometry?.doors) && (mapBefore.dmGeometry?.doors ?? []).length === 1, 'the doors came back exactly, keyed lock and all');
    ok(mapAfter.tokens.some((t) => t.id === token.id && t.q === 3 && t.r === 4), 'the token came back where it stood');

    // Against what server A actually stores, not against the bytes we uploaded:
    // the upload pipeline re-encodes images, and the backup's job is to carry
    // the stored file across, not the one that went in.
    const origin = Buffer.from(await (await fetch(`${baseA}/uploads/${asset.file}`)).arrayBuffer());
    const img = await fetch(`${baseB}/uploads/${asset.file}`);
    const imgBytes = Buffer.from(await img.arrayBuffer());
    ok(img.ok && origin.length > 0 && imgBytes.equals(origin), 'the map background image is byte-for-byte what the old server had');

    // A stranger must not be able to overwrite somebody's campaign.
    const stranger = await login(baseB, 'backup_stranger', 'pw-backup-stranger');
    const attack = await restore(stranger.token, true);
    ok(attack.status === 400, 'a stranger cannot overwrite a campaign they do not run');

    const junk = new FormData();
    junk.append('file', new Blob([Buffer.from('not a backup at all')]), 'nope.r67campaign');
    const junkRes = await fetch(`${baseB}/api/campaigns/restore`, { method: 'POST', headers: { Authorization: `Bearer ${dmB.token}` }, body: junk });
    ok(junkRes.status === 400, 'a file that is not a backup is refused politely');

    dmSock.close();
    dmSockB.close();
  } finally {
    for (const p of procs) p.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows holds the db file briefly */ }
  }

  console.log(failures === 0 ? '\nall good.' : `\n${failures} failure(s).`);
  // Let closed sockets finish tearing down before exiting -- process.exit
  // mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
  await new Promise((r) => setTimeout(r, 300));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
