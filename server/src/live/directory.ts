import type { Server } from 'socket.io';
import { S2C, type DirectoryPayload, type WorldVisState } from 'shared';
import { campaigns, characters, maps, tokens, worldVis, type WorldVisKind } from '../db/repos.js';
import { campaignSockets, sdata } from './hub.js';

function distinct(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && v.trim()))].sort((a, b) => a.localeCompare(b));
}

function namesFrom(sheet: Record<string, unknown>, listId: string): string[] {
  const list = Array.isArray(sheet[listId]) ? (sheet[listId] as Array<Record<string, unknown>>) : [];
  return list.map((r) => (typeof r.name === 'string' ? r.name : '')).filter(Boolean);
}

/**
 * Build the shared campaign directory. The DM sees everything; players see a
 * safe subset: all maps, token-layer tokens, characters that have been placed
 * on a map, and the party's collective weapons/spells/items (never NPC kit or
 * GM-layer secrets).
 */
export function buildDirectory(campaignId: string, isDm: boolean, userId?: string): DirectoryPayload {
  const campaignMaps = maps.forCampaign(campaignId);
  const allCharacters = characters.forCampaign(campaignId);

  // Players only see what the party has actually discovered (a controlled
  // token had it in sight) — unless the DM force-revealed or force-hid it.
  // The DM's badges show the union of every player's knowledge; a player's
  // own view shows only what THEY have seen.
  const disc = worldVis.discovered(campaignId, isDm ? undefined : userId);
  const ov = worldVis.overrides(campaignId);
  const visOf = (kind: WorldVisKind, key: string, base: boolean): WorldVisState =>
    ov.get(`${kind}:${key}`) ?? (base ? 'seen' : 'unseen');
  const shows = (v: WorldVisState) => v === 'seen' || v === 'reveal';

  const tokenList: DirectoryPayload['tokens'] = [];
  const charHasVisibleToken = new Set<string>();
  for (const meta of campaignMaps) {
    for (const t of tokens.forMap(meta.id)) {
      const ownedByPlayer = !!t.characterId && allCharacters.find((c) => c.id === t.characterId)?.ownerUserId != null;
      const tokVis = visOf('token', t.id, ownedByPlayer || disc.has(`token:${t.id}`));
      if (t.characterId && t.layer !== 'gm' && shows(tokVis)) charHasVisibleToken.add(t.characterId);
      if (isDm) tokenList.push({ id: t.id, name: t.name, mapName: meta.name, gm: t.layer === 'gm', vis: tokVis });
      else if (t.layer !== 'gm' && shows(tokVis)) tokenList.push({ id: t.id, name: t.name, mapName: meta.name, gm: false });
    }
  }

  // Characters shown: DM = all; players = party PCs + discovered/revealed.
  const shownChars = allCharacters.filter((c) => isDm
    || shows(visOf('character', c.id, c.ownerUserId !== null || disc.has(`character:${c.id}`) || charHasVisibleToken.has(c.id))));

  // Aggregate gear/spells: DM from every character; players from party-owned
  // characters only (so NPC inventories/spellbooks aren't leaked).
  const gearSource = isDm ? allCharacters : allCharacters.filter((c) => c.ownerUserId !== null);
  const weapons: string[] = [];
  const spells: string[] = [];
  const items: string[] = [];
  for (const c of gearSource) {
    weapons.push(...namesFrom(c.sheet, 'attacks'));
    spells.push(...namesFrom(c.sheet, 'spells'), ...namesFrom(c.sheet, 'cantrips'), ...namesFrom(c.sheet, 'powers'));
    items.push(...namesFrom(c.sheet, 'inventory'), ...namesFrom(c.sheet, 'armor'));
  }

  const shownMaps = campaignMaps.filter((m) => isDm || shows(visOf('map', m.id, disc.has(`map:${m.id}`))));
  return {
    maps: shownMaps.map((m) => ({ id: m.id, name: m.name, ...(isDm ? { vis: visOf('map', m.id, disc.has(`map:${m.id}`)) } : {}) })),
    characters: shownChars.map((c) => {
      const owner = c.ownerUserId ? campaigns.members(campaignId).find((m) => m.userId === c.ownerUserId)?.username ?? null : null;
      const base = c.ownerUserId !== null || disc.has(`character:${c.id}`) || charHasVisibleToken.has(c.id);
      return { id: c.id, name: c.name, owner, system: c.system, ...(isDm ? { vis: visOf('character', c.id, base) } : {}) };
    }),
    tokens: tokenList,
    weapons: distinct(weapons),
    spells: distinct(spells),
    items: distinct(items),
  };
}

/** Send each connected member their (role-filtered) directory. */
export function broadcastDirectory(io: Server, campaignId: string): void {
  // Per-player knowledge means per-player payloads; memoize per user so a
  // player with several tabs open costs one build.
  const dmView = buildDirectory(campaignId, true);
  const perUser = new Map<string, DirectoryPayload>();
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    if (d.role === 'dm') { socket.emit(S2C.DIRECTORY, dmView); continue; }
    let view = perUser.get(d.userId);
    if (!view) { view = buildDirectory(campaignId, false, d.userId); perUser.set(d.userId, view); }
    socket.emit(S2C.DIRECTORY, view);
  }
}
