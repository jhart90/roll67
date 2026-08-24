import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canEditCharacter, conditionsOf, num, playerColorFor, roll, rows, str, systemFor,
  type CreateCharacterPayload, type CustomNpcView, type DeleteCharacterPayload,
  type DeleteCustomNpcPayload, type LevelUpRollPayload,
  type SaveToCompendiumPayload, type SheetData, type UndoEntry, type UpdateCharacterPayload,
} from 'shared';
import type { Character, CreateNpcPayload, CreateRandomNpcPayload, DmNotesGetPayload, DmNotesSetPayload, GameSystem, PrivateNotesGetPayload, PrivateNotesSetPayload, PublicSheetGetPayload, PublicSheetPayload, WorldOverridePayload } from 'shared';
import { generateNpc, generateNpcFromModel, nameplateFor, npcById, remapMacro, reorderMapsFor } from 'shared';
import { campaigns, characters, chat, customNpcs, dmNotes, macros, mapObjects, maps, privateNotes, tokens, worldVis } from '../../db/repos.js';
import { placeCharacterToken } from './tokens.js';
import { dropCarriedLootOnDeath } from './mapObjects.js';
import { clearConcentrationEffects, postConditionDiff } from '../hp.js';
import { campaignRoom, dmRoom, emitError, safe, scrubNonFinite, sdata, userRoom } from '../hub.js';
import { syncMapVision } from '../visionService.js';
import { broadcastDirectory } from '../directory.js';
import { rollGate } from '../locks.js';

/**
 * A player's keys are exactly the ones the DM issued — no more, no fewer.
 *
 * Every key row in their submitted inventory is discarded and the STORED key
 * rows are put back verbatim. Filtering their submission instead was the
 * obvious approach and the wrong one: a sheet edit sends the whole inventory,
 * so a rejected forgery took the real key down with it, and any harmless
 * client-side normalisation of a key row would silently destroy it. Keys are
 * DM property; players carry them.
 */
function withPlayerSafeKeys(character: Character, patch: SheetData): SheetData {
  if (!Array.isArray(patch.inventory)) return patch;
  const issued = rows(character.sheet, 'inventory').filter((r) => r.isKey === true);
  const withoutKeys = (patch.inventory as SheetData[]).filter((r) => r?.isKey !== true);
  return { ...patch, inventory: [...withoutKeys, ...issued] };
}

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

/**
 * Take the bestiary's per-creature ability text off a sheet about to be
 * spawned, so the caller can put it where it belongs.
 *
 * That prose — "Change Form: as an action… Invulnerability: can only be slain
 * by sunlight…" — is the one part of a stat block that is mechanics a player
 * should not simply read off a monster, and no sheet has had a field for it
 * since Notes was dropped. Riding along on the sheet it was dead data nothing
 * rendered; its home is the DM's own secret notes, a separate DM-gated store.
 *
 * Mutates the sheet, which is always a clone by the time it reaches here.
 */
function takeAbilityText(sheet: SheetData): string {
  const text = typeof sheet.notes === 'string' ? sheet.notes.trim() : '';
  delete sheet.notes;
  return text;
}

/** Seed a freshly spawned creature's DM notes with its ability text. */
function seedDmNotes(io: Server, campaignId: string, characterId: string, text: string): void {
  if (!text) return;
  dmNotes.set(campaignId, characterId, text);
  io.to(dmRoom(campaignId)).emit(S2C.DM_NOTES, { characterId, text });
}

export function registerCharacterHandlers(io: Server, socket: Socket): void {
  // DM world-tab curation: force-reveal or force-hide an entry for all
  // players regardless of what the party has actually seen.
  socket.on(C2S.WORLD_OVERRIDE, safe(socket, ({ kind, key, mode }: WorldOverridePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM curates the world tab.'); return; }
    if (!['map', 'token', 'character'].includes(kind) || !key) return;
    worldVis.setOverride(d.campaignId, kind, key, mode === 'clear' ? null : mode);
    broadcastDirectory(io, d.campaignId);
  }, 'WORLD_OVERRIDE'));

  // DM-only secret notes: read and write live in their own store and their
  // own DM-gated events — they never ride on the sheet, so no client bug can
  // ever show them to a player.
  socket.on(C2S.DM_NOTES_GET, safe(socket, ({ characterId }: DmNotesGetPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    socket.emit(S2C.DM_NOTES, { characterId, text: dmNotes.get(characterId) });
  }, 'DM_NOTES_GET'));

  socket.on(C2S.DM_NOTES_SET, safe(socket, ({ characterId, text }: DmNotesSetPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM keeps secret notes.'); return; }
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    dmNotes.set(d.campaignId, characterId, String(text ?? '').slice(0, 20000));
    // Echo to ALL DM sockets (a popped-out sheet window is its own socket).
    io.to(dmRoom(d.campaignId)).emit(S2C.DM_NOTES, { characterId, text: dmNotes.get(characterId) });
  }, 'DM_NOTES_SET'));

  // Per-player private notes on any character (the public sheet's scratchpad):
  // keyed by viewer + character, echoed only to that viewer's own sockets —
  // nobody else, DM included, ever receives them.
  socket.on(C2S.PRIVATE_NOTES_GET, safe(socket, ({ characterId }: PrivateNotesGetPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    socket.emit(S2C.PRIVATE_NOTES, { characterId, text: privateNotes.get(d.userId, characterId) });
  }, 'PRIVATE_NOTES_GET'));

  socket.on(C2S.PRIVATE_NOTES_SET, safe(socket, ({ characterId, text }: PrivateNotesSetPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    privateNotes.set(d.userId, d.campaignId, characterId, String(text ?? '').slice(0, 20000));
    io.to(userRoom(d.userId)).emit(S2C.PRIVATE_NOTES, { characterId, text: privateNotes.get(d.userId, characterId) });
  }, 'PRIVATE_NOTES_SET'));

  // The public-facing sheet: exactly what the nameplate already exposes,
  // plus portrait, token art, and the free-text bio sections — never stats,
  // gear, or anything mechanical. Any member of the campaign may look.
  socket.on(C2S.PUBLIC_SHEET_GET, safe(socket, ({ characterId }: PublicSheetGetPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    const tok = tokens.forCharacter(ch.id)[0];
    const plate = nameplateFor(ch, tok?.color ?? '#8899aa', tok?.artUrl ?? null);
    // Bio = the schema's own appearance/personality/backstory/bio sections,
    // so each system decides what counts as flavor text.
    const BIO_SECTIONS = new Set(['appearance', 'personality', 'backstory', 'bio', 'proficiencies']);
    const bio: PublicSheetPayload['bio'] = [];
    for (const tab of systemFor(ch.system).tabs) {
      for (const section of tab.sections) {
        if (section.kind !== 'fields' || !BIO_SECTIONS.has(section.id)) continue;
        const entries = (section.fields ?? [])
          .filter((f) => f.type === 'text' || f.type === 'textarea')
          .map((f) => ({ label: f.label, text: str(ch.sheet, f.id, '').trim() }))
          .filter((e) => e.text.length > 0);
        if (entries.length > 0) bio.push({ title: section.title ?? 'Bio', entries });
      }
    }
    const payload: PublicSheetPayload = {
      characterId: ch.id,
      name: ch.name,
      system: ch.system,
      color: plate.color,
      lines: plate.lines,
      portraitUrl: plate.portraitUrl,
      tokenImageUrl: str(ch.sheet, 'tokenImage', '').trim() || tok?.artUrl || null,
      detailImageUrl: str(ch.sheet, 'detailImage', '').trim() || null,
      bioText: str(ch.sheet, 'bioPublic', '').trim(),
      bio,
    };
    socket.emit(S2C.PUBLIC_SHEET, payload);
  }, 'PUBLIC_SHEET_GET'));

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
    // A guided creator (e.g. the SWADE character wizard) hands over a fully
    // assembled sheet — merged over the defaults, not replacing them, so any
    // field the wizard didn't touch still gets the system's normal default.
    if (payload.sheetPatch) Object.assign(sheet, payload.sheetPatch);
    // A character's color starts as their player's own color — the same one
    // their pill and dice wear — unless the creator explicitly picked one.
    if (typeof sheet.tokenColor !== 'string' && owner) {
      const m = campaigns.members(d.campaignId).find((x) => x.userId === owner);
      if (m) sheet.tokenColor = playerColorFor(m);
    }
    const character = characters.create(d.campaignId, owner, name, payload.system, sheet);
    emitCharacter(io, d.campaignId, character);
    // Drop the new character's token onto its owner's current map (visible
    // layer — placeCharacterToken only puts unowned NPCs on the GM layer).
    if (payload.placeToken && character.ownerUserId) {
      const mapId = campaigns.viewMapIdFor(d.campaignId, character.ownerUserId);
      if (mapId) placeCharacterToken(io, d.campaignId, character, mapId);
    }
    broadcastDirectory(io, d.campaignId);
  }, 'CREATE_CHARACTER'));

  socket.on(C2S.CREATE_NPC, safe(socket, ({ libraryId, name }: CreateNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can add pre-built NPCs.');
      return;
    }
    const campaign = campaigns.byId(d.campaignId)!;
    const entry = npcById(libraryId);
    if (entry) {
      if (entry.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
      const sheet = structuredClone(entry.sheet);
      const abilities = takeAbilityText(sheet);
      const character = characters.create(
        d.campaignId, null, name?.trim() || entry.name, entry.system, sheet,
      );
      seedDmNotes(io, d.campaignId, character.id, abilities);
      emitCharacter(io, d.campaignId, character);
      return;
    }
    const custom = customNpcs.byId(libraryId);
    if (custom) {
      if (custom.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
      const sheet = structuredClone(custom.sheet);
      const abilities = takeAbilityText(sheet);
      if (custom.artAssetId) (sheet as Record<string, unknown>).tokenImageAssetId = custom.artAssetId;
      if (custom.color) (sheet as Record<string, unknown>).tokenColor = custom.color;
      const character = characters.create(
        d.campaignId, null, name?.trim() || custom.name, custom.system, sheet,
      );
      seedDmNotes(io, d.campaignId, character.id, abilities);
      emitCharacter(io, d.campaignId, character);
      return;
    }
    throw new Error('Unknown library NPC.');
  }, 'CREATE_NPC'));

  socket.on(C2S.CREATE_RANDOM_NPC, safe(socket, ({ count, modelId }: CreateRandomNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM generates NPCs.'); return; }
    const campaign = campaigns.byId(d.campaignId)!;
    // Modeling after a compendium NPC keeps names/flavor appropriate to its
    // type (a dragon doesn't get a townsfolk's name) while jittering its stats.
    let model: ReturnType<typeof npcById> | undefined;
    if (modelId) {
      model = npcById(modelId);
      if (!model) {
        const custom = customNpcs.byId(modelId);
        if (!custom) throw new Error('Unknown model NPC.');
        if (custom.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
        model = { id: custom.id, system: custom.system, name: custom.name, category: custom.category, challenge: 0, challengeLabel: custom.challengeLabel || '—', ac: custom.ac, hp: custom.hp, sheet: custom.sheet };
      }
      if (model.system !== campaign.system) throw new Error('That NPC belongs to a different game system.');
    }
    const n = Math.max(1, Math.min(10, count ?? 1));
    for (let i = 0; i < n; i++) {
      const gen = model ? generateNpcFromModel(model) : generateNpc(campaign.system);
      // A jittered copy of a bestiary entry inherits its ability text, which
      // belongs in the DM's notes for the same reason the original's does.
      const abilities = takeAbilityText(gen.sheet);
      const character = characters.create(d.campaignId, null, gen.name, campaign.system, gen.sheet);
      seedDmNotes(io, d.campaignId, character.id, abilities);
      emitCharacter(io, d.campaignId, character);
    }
    broadcastDirectory(io, d.campaignId);
  }, 'CREATE_RANDOM_NPC'));

  socket.on(C2S.DELETE_CHARACTER, safe(socket, ({ characterId }: DeleteCharacterPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) return;
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can delete characters.');
      return;
    }
    const linkedTokens = tokens.forCharacter(characterId);
    const touchedMaps = new Set<string>();
    for (const t of linkedTokens) {
      tokens.delete(t.id);
      io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId: t.id });
      touchedMaps.add(t.mapId);
    }
    // Anything they were CARRYING goes with them, for the same reason their
    // tokens just did. It hangs off a plain text column with no foreign key,
    // so left behind it is a chest riding a token that no longer exists --
    // off the map, and reachable by nobody.
    for (const o of mapObjects.forCampaign(d.campaignId)) {
      if (o.linkedCharacterId !== characterId) continue;
      mapObjects.delete(o.id);
      io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId: o.id });
    }
    characters.delete(characterId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHARACTER_REMOVED, { characterId });
    for (const mapId of touchedMaps) syncMapVision(io, d.campaignId, mapId);
    broadcastDirectory(io, d.campaignId);
  }, 'DELETE_CHARACTER'));

  socket.on(C2S.UPDATE_CHARACTER, safe(socket, ({ characterId, patch, name, parentId, dropHex, ownerUserId }: UpdateCharacterPayload) => {
    const d = requireCampaign(socket);
    let character = characters.byId(characterId);
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
    // Reassigning control is DM-only. The previous owner stops receiving this
    // character's sheet, and vision resyncs since who owns its tokens affects
    // whose FOV they contribute to.
    if (ownerUserId !== undefined && d.role === 'dm') {
      const previousOwner = character.ownerUserId;
      characters.setOwner(characterId, ownerUserId);
      character = characters.byId(characterId)!;
      if (previousOwner && previousOwner !== ownerUserId) {
        io.to(userRoom(previousOwner)).emit(S2C.CHARACTER_REMOVED, { characterId });
      }
      const touchedMaps = new Set(tokens.forCharacter(characterId).map((t) => t.mapId));
      for (const mapId of touchedMaps) syncMapVision(io, d.campaignId, mapId);
      broadcastDirectory(io, d.campaignId);
    }
    // Keys are DM-issued and a player must not be able to mint or re-label
    // one: renaming a pebble to "Patch's Lab Key" would open Patch's lab. Any
    // key row in a PLAYER's update must already exist on the stored sheet,
    // unchanged and in no greater quantity — they can drop keys, never forge
    // or edit them. (The DM edits keys freely; that is what the Key Manager
    // is for.)
    const safePatch = d.role === 'dm' ? patch : withPlayerSafeKeys(character, patch);
    applyCharacterPatch(io, d.campaignId, character, safePatch, name, d.username);
  }, 'UPDATE_CHARACTER'));

  socket.on(C2S.LEVEL_UP_ROLL, safe(socket, ({ characterId, patch, hitDie, conMod, avgHp, label }: LevelUpRollPayload) => {
    if (!rollGate(socket)) return;
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
    // `|| 0` NaN-guards avgHp like hitDie/conMod above -- an unguarded NaN
    // here would flow into maxHp/hp below and persist NaN onto the sheet
    // (and from there onto every token bar broadcast).
    const delta = rolled - (Math.floor(avgHp) || 0);
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
    applyCharacterPatch(io, d.campaignId, character, adjusted, undefined, d.username);
    // Show the roll to everyone.
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text: String(label ?? '').slice(0, 120), roll: breakdown, recipients: null,
    }, undo);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'LEVEL_UP_ROLL'));

  socket.on(C2S.SAVE_TO_COMPENDIUM, safe(socket, ({ characterId }: SaveToCompendiumPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can save to the compendium.'); return; }
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    const campaign = campaigns.byId(d.campaignId)!;
    const schema = systemFor(campaign.system);
    const hp = schema.hp(character.sheet);
    const ac = typeof character.sheet.ac === 'number' ? character.sheet.ac : 10;
    const artAssetId = typeof character.sheet.tokenImageAssetId === 'string' ? character.sheet.tokenImageAssetId : null;
    const token = tokens.forCharacter(characterId)[0];
    const color = token?.color ?? null;
    // Remember the token's look too: shape and size ride the saved sheet
    // (the spawn path reads sheet.tokenShape/tokenSize when placing tokens),
    // so a 1.5-hex hexagon Training Dummy comes back exactly that.
    const sheetCopy = structuredClone(character.sheet) as SheetData;
    if (token?.shape) sheetCopy.tokenShape = token.shape;
    if (token?.size) sheetCopy.tokenSize = token.size;
    customNpcs.create(d.userId, campaign.system, character.name, ac, hp.maxHp, '', sheetCopy, color, artAssetId);
    emitCustomNpcs(socket, d.userId, campaign.system);
  }, 'SAVE_TO_COMPENDIUM'));

  socket.on(C2S.DELETE_CUSTOM_NPC, safe(socket, ({ customNpcId }: DeleteCustomNpcPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can manage the compendium.'); return; }
    const entry = customNpcs.byId(customNpcId);
    if (!entry || entry.userId !== d.userId) throw new Error('Unknown custom NPC.');
    customNpcs.delete(customNpcId);
    const campaign = campaigns.byId(d.campaignId!)!;
    emitCustomNpcs(socket, d.userId, campaign.system);
  }, 'DELETE_CUSTOM_NPC'));
}

function toCustomNpcView(d: ReturnType<typeof customNpcs.byId> & {}): CustomNpcView {
  return {
    id: d.id, system: d.system, name: d.name, category: d.category,
    challengeLabel: d.challengeLabel, ac: d.ac, hp: d.hp,
    sheet: d.sheet, color: d.color, artAssetId: d.artAssetId,
  };
}

export function emitCustomNpcs(socket: Socket, userId: string, system: string): void {
  const list = customNpcs.forUserSystem(userId, system as GameSystem).map(toCustomNpcView);
  socket.emit(S2C.CUSTOM_NPCS, { npcs: list });
}

/** Persist a sheet patch, mirror HP/art to tokens, resync vision + directory. */
/**
 * Move every pinned pill that pointed at a reordered row to that row's new
 * position, for every user who pinned it — a DM and a player can both have
 * the same weapon on their toolbar. Each affected user gets their list back
 * so the change is live, not something they discover by firing the wrong gun.
 */
function followReorder(
  io: Server, campaignId: string, characterId: string, reorders: Record<string, Map<number, number>>,
): void {
  const touchedUsers = new Set<string>();
  for (const m of macros.forCharacter(characterId)) {
    const next = remapMacro({ actionId: m.actionId, rollableId: m.rollableId }, reorders);
    if (!next) continue;
    macros.setBinding(m.id, next.actionId ?? null, next.rollableId ?? null);
    if (m.userId) touchedUsers.add(m.userId);
  }
  for (const userId of touchedUsers) {
    io.to(userRoom(userId)).emit(S2C.MACROS, { macros: macros.forUser(userId, campaignId) });
  }
}

function applyCharacterPatch(
  io: Server, campaignId: string, character: Character, patch: SheetData, name?: string, actorName?: string,
): void {
  // A manual concentration change (clearing the field on the sheet, or
  // typing a different spell) ends the old spell -- lift any conditions it
  // was maintaining on its targets before the new value lands.
  const prevConc = str(character.sheet, 'concentration', '');
  if (typeof patch.concentration === 'string' && patch.concentration !== prevConc && prevConc) {
    character = clearConcentrationEffects(io, campaignId, character);
  }
  // Captured AFTER the concentration cleanup above, so a manual edit that
  // both drops concentration AND ticks a condition checkbox in the same
  // patch doesn't double-post the conditions concentration already lifted.
  const beforeConditions = conditionsOf(character.sheet);
  // Pinned pills bind to a row's INDEX, so reordering cards would silently
  // repoint them — the knife's pill firing the rifle. Worked out against the
  // sheet as it stands, before the patch lands.
  const reorders = reorderMapsFor(character.sheet, patch);
  const sheet = { ...character.sheet, ...scrubNonFinite(patch) };
  characters.update(character.id, name, sheet);
  const updated = characters.byId(character.id)!;
  emitCharacter(io, campaignId, updated);
  // Sheet edits do not go through persistSheet, so the same alive-to-dead edge
  // has to be watched here too — otherwise ticking Dead by hand leaves the
  // loot on the body while every other route drops it.
  if (!beforeConditions.includes('dead') && conditionsOf(updated.sheet).includes('dead')) {
    dropCarriedLootOnDeath(io, campaignId, updated);
  }
  if (Object.keys(reorders).length > 0) followReorder(io, campaignId, character.id, reorders);

  if (Array.isArray(patch.conditions) && actorName) {
    postConditionDiff(io, campaignId, updated.name, beforeConditions, conditionsOf(updated.sheet), actorName);
  }

  const schema = systemFor(updated.system);
  const hp = schema.hp(updated.sheet);
  const artId = typeof (patch as Record<string, unknown>).tokenImageAssetId === 'string'
    ? (patch as Record<string, string>).tokenImageAssetId
    : undefined;
  // Token color lives on the SHEET now (the old right-click picker is gone),
  // so picking one there repaints every one of this character's tokens — and
  // with it their nameplate, which takes its color from the token.
  const rawColor = (patch as Record<string, unknown>).tokenColor;
  const color = typeof rawColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : undefined;
  const touchedMaps = new Set<string>();
  for (const t of tokens.forCharacter(character.id)) {
    const tokenPatch: Record<string, unknown> = artId !== undefined ? { bar: hp, artAssetId: artId } : { bar: hp };
    if (color !== undefined && t.color !== color) tokenPatch.color = color;
    if (name !== undefined && t.name !== updated.name) tokenPatch.name = updated.name;
    tokens.update(t.id, tokenPatch);
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(t.id)! });
    touchedMaps.add(t.mapId);
  }
  for (const mapId of touchedMaps) syncMapVision(io, campaignId, mapId);
  broadcastDirectory(io, campaignId);
}
