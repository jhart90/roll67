import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canEditCharacter, num, roll, systemFor,
  type CreateCharacterPayload, type DeleteCharacterPayload, type LevelUpRollPayload,
  type SheetData, type UndoEntry, type UpdateCharacterPayload,
} from 'shared';
import type { Character, CreateNpcPayload, CreateRandomNpcPayload } from 'shared';
import { generateNpc, generateNpcFromModel, npcById } from 'shared';
import { campaigns, characters, chat, maps, tokens } from '../../db/repos.js';
import { placeCharacterToken } from './tokens.js';
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
    if (payload.initialClass) sheet.class = payload.initialClass;
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

  socket.on(C2S.CREATE_RANDOM_NPC, safe(socket, ({ count, modelId }: CreateRandomNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM generates NPCs.'); return; }
    const campaign = campaigns.byId(d.campaignId)!;
    // Modeling after a compendium NPC keeps names/flavor appropriate to its
    // type (a dragon doesn't get a townsfolk's name) while jittering its stats.
    let model: ReturnType<typeof npcById> | undefined;
    if (modelId) {
      model = npcById(modelId);
      if (!model) throw new Error('Unknown model NPC.');
      if (model.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
    }
    const n = Math.max(1, Math.min(10, count ?? 1));
    for (let i = 0; i < n; i++) {
      const gen = model ? generateNpcFromModel(model) : generateNpc(campaign.system);
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

  socket.on(C2S.UPDATE_CHARACTER, safe(socket, ({ characterId, patch, name, parentId, dropHex }: UpdateCharacterPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) return;
    if (!canEditCharacter(d.role, d.userId, character)) {
      emitError(socket, 'You cannot edit this character.');
      return;
    }
    // Reparenting in the world tree is DM-only and separate from sheet edits.
    if (parentId !== undefined && d.role === 'dm') {
      characters.setParent(characterId, parentId);
      // Dragging a character onto a map (or directly onto the map canvas,
      // which supplies dropHex) moves its token onto that map.
      if (parentId && maps.byId(parentId)?.campaignId === d.campaignId) {
        placeCharacterToken(io, d.campaignId, character, parentId, dropHex ?? null);
      }
    }
    applyCharacterPatch(io, d.campaignId, character, patch, name);
  }));

  socket.on(C2S.LEVEL_UP_ROLL, safe(socket, ({ characterId, patch, hitDie, conMod, avgHp, label }: LevelUpRollPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) return;
    if (!canEditCharacter(d.role, d.userId, character)) {
      emitError(socket, 'You cannot edit this character.');
      return;
    }
    // Roll the hit die (+CON) server-side, then adjust the patch's HP from the
    // average baseline it was built with.
    const dice = Math.max(2, Math.floor(hitDie) || 8);
    const cm = Math.floor(conMod) || 0;
    const breakdown = roll(`1d${dice}${cm >= 0 ? `+${cm}` : cm}`);
    const rolled = Math.max(1, breakdown.total);
    const delta = rolled - Math.floor(avgHp);
    const adjusted: SheetData = {
      ...patch,
      maxHp: num(patch as SheetData, 'maxHp', 0) + delta,
      hp: num(patch as SheetData, 'hp', 0) + delta,
    };
    // Snapshot the prior value of each changed field so the DM can undo the level-up.
    const prior = character.sheet as SheetData;
    const undo: UndoEntry[] = Object.keys(adjusted).map((key) => ({
      t: 'field', characterId: character.id, key, value: prior[key] ?? null,
    }));
    applyCharacterPatch(io, d.campaignId, character, adjusted);
    // Show the roll to everyone.
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text: String(label ?? '').slice(0, 120), roll: breakdown, recipients: null,
    }, undo);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }));
}

/** Persist a sheet patch, mirror HP/art to tokens, resync vision + directory. */
function applyCharacterPatch(io: Server, campaignId: string, character: Character, patch: SheetData, name?: string): void {
  const sheet = { ...character.sheet, ...patch };
  characters.update(character.id, name, sheet);
  const updated = characters.byId(character.id)!;
  emitCharacter(io, campaignId, updated);

  const schema = systemFor(updated.system);
  const hp = schema.hp(updated.sheet);
  const artId = typeof (patch as Record<string, unknown>).tokenImageAssetId === 'string'
    ? (patch as Record<string, string>).tokenImageAssetId
    : undefined;
  const touchedMaps = new Set<string>();
  for (const t of tokens.forCharacter(character.id)) {
    tokens.update(t.id, artId !== undefined ? { bar: hp, artAssetId: artId } : { bar: hp });
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(t.id)! });
    touchedMaps.add(t.mapId);
  }
  for (const mapId of touchedMaps) syncMapVision(io, campaignId, mapId);
  broadcastDirectory(io, campaignId);
}
