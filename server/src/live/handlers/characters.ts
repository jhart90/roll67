import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canEditCharacter, systemFor,
  type CreateCharacterPayload, type DeleteCharacterPayload, type UpdateCharacterPayload,
} from 'shared';
import type { Character, CreateNpcPayload, CreateRandomNpcPayload } from 'shared';
import { generateNpc, npcById } from 'shared';
import { campaigns, characters, tokens } from '../../db/repos.js';
import { campaignRoom, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { syncMapVision } from '../visionService.js';
import { broadcastDirectory } from '../directory.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

/** A character sheet is private to its owner and the DM. */
function emitCharacter(io: Server, campaignId: string, character: Character): void {
  io.to(dmRoom(campaignId)).emit(S2C.CHARACTER_UPSERTED, { character });
  if (character.ownerUserId) {
    io.to(userRoom(character.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character });
  }
}

export function registerCharacterHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.CREATE_CHARACTER, safe(socket, (payload: CreateCharacterPayload) => {
    const d = requireCampaign(socket);
    const campaign = campaigns.byId(d.campaignId)!;
    if (payload.system !== campaign.system) throw new Error('Character system must match the campaign.');
    // Players create characters they own; the DM can create NPCs (no owner)
    // or assign ownership to any member.
    let owner: string | null;
    if (d.role === 'dm') owner = payload.ownerUserId !== undefined ? payload.ownerUserId : null;
    else owner = d.userId;
    const name = payload.name?.trim() || 'Unnamed';
    const sheet = systemFor(payload.system).defaultSheet();
    const character = characters.create(d.campaignId, owner, name, payload.system, sheet);
    emitCharacter(io, d.campaignId, character);
    broadcastDirectory(io, d.campaignId);
  }));

  socket.on(C2S.CREATE_NPC, safe(socket, ({ libraryId, name }: CreateNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can add pre-built NPCs.');
      return;
    }
    const entry = npcById(libraryId);
    if (!entry) throw new Error('Unknown library NPC.');
    const campaign = campaigns.byId(d.campaignId)!;
    if (entry.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
    const character = characters.create(
      d.campaignId,
      null, // NPCs are DM-controlled
      name?.trim() || entry.name,
      entry.system,
      structuredClone(entry.sheet),
    );
    emitCharacter(io, d.campaignId, character);
  }));

  socket.on(C2S.CREATE_RANDOM_NPC, safe(socket, ({ count }: CreateRandomNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM generates NPCs.'); return; }
    const campaign = campaigns.byId(d.campaignId)!;
    const n = Math.max(1, Math.min(10, count ?? 1));
    for (let i = 0; i < n; i++) {
      const gen = generateNpc(campaign.system);
      const character = characters.create(d.campaignId, null, gen.name, campaign.system, gen.sheet);
      emitCharacter(io, d.campaignId, character);
    }
    broadcastDirectory(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_CHARACTER, safe(socket, ({ characterId }: DeleteCharacterPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) return;
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can delete characters.');
      return;
    }
    characters.delete(characterId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHARACTER_REMOVED, { characterId });
    broadcastDirectory(io, d.campaignId);
  }));

  socket.on(C2S.UPDATE_CHARACTER, safe(socket, ({ characterId, patch, name }: UpdateCharacterPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) return;
    if (!canEditCharacter(d.role, d.userId, character)) {
      emitError(socket, 'You cannot edit this character.');
      return;
    }
    const sheet = { ...character.sheet, ...patch };
    characters.update(characterId, name, sheet);
    const updated = characters.byId(characterId)!;
    emitCharacter(io, d.campaignId, updated);

    // Mirror HP onto this character's token bars on every map, and refresh
    // vision on those maps (sheet vision may change).
    const schema = systemFor(updated.system);
    const hp = schema.hp(updated.sheet);
    const touchedMaps = new Set<string>();
    for (const t of tokens.forCharacter(characterId)) {
      tokens.update(t.id, { bar: hp });
      const refreshed = tokens.byId(t.id)!;
      io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: refreshed });
      touchedMaps.add(t.mapId);
    }
    for (const mapId of touchedMaps) syncMapVision(io, d.campaignId, mapId);
    broadcastDirectory(io, d.campaignId);
  }));
}
