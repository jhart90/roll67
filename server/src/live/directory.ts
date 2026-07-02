import type { Server } from 'socket.io';
import { S2C, type DirectoryPayload } from 'shared';
import { campaigns, characters, maps, tokens } from '../db/repos.js';
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
export function buildDirectory(campaignId: string, isDm: boolean): DirectoryPayload {
  const campaignMaps = maps.forCampaign(campaignId);
  const allCharacters = characters.forCampaign(campaignId);

  const tokenList: DirectoryPayload['tokens'] = [];
  const charHasVisibleToken = new Set<string>();
  const charHasAnyToken = new Set<string>();
  for (const meta of campaignMaps) {
    for (const t of tokens.forMap(meta.id)) {
      if (t.characterId) {
        charHasAnyToken.add(t.characterId);
        if (t.layer !== 'gm') charHasVisibleToken.add(t.characterId);
      }
      if (isDm || t.layer !== 'gm') {
        tokenList.push({ name: t.name, mapName: meta.name, gm: t.layer === 'gm' });
      }
    }
  }

  // Characters shown: DM = all; players = party PCs + any character with a
  // visible (token-layer) token that they could have encountered.
  const shownChars = allCharacters.filter((c) =>
    isDm || c.ownerUserId !== null || charHasVisibleToken.has(c.id));

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

  return {
    maps: campaignMaps.map((m) => ({ id: m.id, name: m.name })),
    characters: shownChars.map((c) => {
      const owner = c.ownerUserId ? campaigns.members(campaignId).find((m) => m.userId === c.ownerUserId)?.username ?? null : null;
      return { id: c.id, name: c.name, owner, system: c.system };
    }),
    tokens: tokenList,
    weapons: distinct(weapons),
    spells: distinct(spells),
    items: distinct(items),
  };
}

/** Send each connected member their (role-filtered) directory. */
export function broadcastDirectory(io: Server, campaignId: string): void {
  const dmView = buildDirectory(campaignId, true);
  const playerView = buildDirectory(campaignId, false);
  for (const socket of campaignSockets(io, campaignId)) {
    socket.emit(S2C.DIRECTORY, sdata(socket).role === 'dm' ? dmView : playerView);
  }
}
