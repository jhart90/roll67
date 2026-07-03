// Focused combat-system check against the running dev server.
import { io } from 'socket.io-client';
const BASE = process.argv[2] ?? 'http://localhost:3001';
let failures = 0;
const ok = (c, l) => { if (c) console.log(`  ✓ ${l}`); else { failures++; console.error(`  ✗ ${l}`); } };

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
function waitFor(socket, event, ms = 5000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout ${event}`)); }, ms);
    function h(p) { if (!filter(p)) return; clearTimeout(timer); socket.off(event, h); resolve(p); }
    socket.on(event, h);
  });
}

async function main() {
  const dm = await login('testdm', 'test1234');
  let camp = (await api('/api/campaigns', undefined, dm.token)).data.campaigns.find((c) => c.role === 'dm');
  const s = await connect(dm.token);
  const st = waitFor(s, 'campaignState');
  s.emit('joinCampaign', { campaignId: camp.id });
  const state = await st;

  // Fresh map.
  for (const m of state.maps.filter((m) => m.name === 'Combat Check Map')) s.emit('deleteMap', { mapId: m.id });
  await new Promise((r) => setTimeout(r, 300));
  const ml = waitFor(s, 'mapList', 5000, (p) => p.maps.some((m) => m.name === 'Combat Check Map'));
  s.emit('createMap', { name: 'Combat Check Map' });
  const mapId = (await ml).maps.find((m) => m.name === 'Combat Check Map').id;
  const restore = state.campaign.activeMapId;
  await waitForMapState(s, mapId, () => { s.emit('switchActiveMap', { mapId }); s.emit('viewMap', { mapId }); });

  // Fresh PC (with weapon + potion) and NPC.
  for (const c of state.characters.filter((c) => c.name === 'Combat PC' || c.name === 'Combat NPC')) s.emit('deleteCharacter', { characterId: c.id });
  const pcU = waitFor(s, 'characterUpserted', 5000, (p) => p.character.name === 'Combat PC');
  s.emit('createCharacter', { name: 'Combat PC', system: 'dnd5e', ownerUserId: null });
  const pc = (await pcU).character;
  const npcU = waitFor(s, 'characterUpserted', 5000, (p) => p.character.name === 'Combat NPC');
  s.emit('createCharacter', { name: 'Combat NPC', system: 'dnd5e', ownerUserId: null });
  const npc = (await npcU).character;

  // PC: a longsword + 2 healing potions; start hurt so heal is visible.
  s.emit('updateCharacter', { characterId: pc.id, patch: {
    hp: 5, maxHp: 20, ac: 12,
    attacks: [{ name: 'Longsword', bonus: 5, damage: '1d8+3', range: 5 }],
    inventory: [{ name: 'Potion of Healing', qty: 2, effect: 'heal', amount: '2d4+2', range: 5 }],
  } });
  await waitFor(s, 'characterUpserted', 5000, (p) => p.character.id === pc.id && p.character.sheet.hp === 5);
  // NPC: low AC so the attack lands; 10/10 HP.
  s.emit('updateCharacter', { characterId: npc.id, patch: { hp: 10, maxHp: 10, ac: 1 } });
  await waitFor(s, 'characterUpserted', 5000, (p) => p.character.id === npc.id && p.character.sheet.ac === 1);

  // Tokens adjacent: PC (5,5), NPC (6,5).
  s.emit('createToken', { mapId, name: 'Combat PC', q: 5, r: 5, characterId: pc.id, layer: 'token' });
  const pcTok = (await waitFor(s, 'tokenUpserted', 5000, (p) => p.token.name === 'Combat PC')).token;
  s.emit('createToken', { mapId, name: 'Combat NPC', q: 6, r: 5, characterId: npc.id, layer: 'token' });
  const npcTok = (await waitFor(s, 'tokenUpserted', 5000, (p) => p.token.name === 'Combat NPC')).token;

  console.log('combat:');

  // 1) Attack in range -> chat card + HP float + NPC hp drops.
  const chatP = waitFor(s, 'chatMsg', 5000, (p) => p.msg.text.includes('Longsword'));
  const floatP = waitFor(s, 'hpFloat', 5000, (p) => p.tokenId === npcTok.id);
  const npcHpP = waitFor(s, 'characterUpserted', 5000, (p) => p.character.id === npc.id && p.character.sheet.hp < 10);
  s.emit('combatAction', { characterId: pc.id, actionId: 'attack:0', sourceTokenId: pcTok.id, targetTokenId: npcTok.id });
  const chat = await chatP;
  ok(/HIT|MISS/.test(chat.msg.text), `attack posts a combat card ("${chat.msg.text}")`);
  const flt = await floatP;
  ok(flt.delta < 0, `damage floats a negative number over the target (${flt.delta})`);
  const npcHp = (await npcHpP).character.sheet.hp;
  ok(npcHp < 10, `NPC HP auto-reduced on the sheet (${npcHp}/10)`);

  // 2) Out of range -> error.
  s.emit('moveToken', { tokenId: npcTok.id, q: 25, r: 20 });
  await waitFor(s, 'tokenMoved', 5000, (p) => p.tokenId === npcTok.id);
  const errP = waitFor(s, 'errorMsg', 5000, (p) => /range/i.test(p.message));
  s.emit('combatAction', { characterId: pc.id, actionId: 'attack:0', sourceTokenId: pcTok.id, targetTokenId: npcTok.id });
  ok(!!(await errP).message, 'out-of-range attack is rejected');

  // 3) Heal potion on self -> positive float, PC healed, potion consumed.
  //    Wait for the final (post-consume) upsert so we confirm the heal isn't
  //    reverted by the item-consume write.
  const healFloat = waitFor(s, 'hpFloat', 5000, (p) => p.tokenId === pcTok.id && p.delta > 0);
  const pcConsumed = waitFor(s, 'characterUpserted', 5000, (p) => p.character.id === pc.id && p.character.sheet.inventory[0].qty === 1);
  s.emit('combatAction', { characterId: pc.id, actionId: 'item:0', sourceTokenId: pcTok.id, targetTokenId: pcTok.id });
  const hf = await healFloat;
  ok(hf.delta > 0, `heal floats a positive number (+${hf.delta})`);
  const healedChar = (await pcConsumed).character;
  ok(healedChar.sheet.hp > 5, `PC HP auto-increased and not reverted by consume (${healedChar.sheet.hp}/20)`);
  ok(healedChar.sheet.inventory[0].qty === 1, `potion consumed (qty ${healedChar.sheet.inventory[0].qty})`);

  // cleanup
  s.emit('deleteToken', { tokenId: pcTok.id });
  s.emit('deleteToken', { tokenId: npcTok.id });
  s.emit('deleteCharacter', { characterId: pc.id });
  s.emit('deleteCharacter', { characterId: npc.id });
  await new Promise((r) => setTimeout(r, 200));
  if (restore) s.emit('switchActiveMap', { mapId: restore });
  s.emit('deleteMap', { mapId });
  await new Promise((r) => setTimeout(r, 300));

  console.log(failures ? `\n${failures} FAILED` : '\nALL COMBAT CHECKS PASSED');
  s.close();
  process.exit(failures ? 1 : 0);
}
function waitForMapState(s, mapId, trigger) {
  const p = waitFor(s, 'mapState', 5000, (x) => x.map.id === mapId);
  trigger();
  return p;
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
