import type { Server } from 'socket.io';
import { S2C, systemFor, type Character } from 'shared';
import { characters, tokens } from '../db/repos.js';
import { campaignRoom, dmRoom, userRoom } from './hub.js';
import { syncMapVision } from './visionService.js';

/**
 * Write a new current-HP value to a character (clamped to 0..maxHp), mirror it
 * onto every token bar for that character, and re-sync vision on those maps.
 * The full sheet stays private (DM + owner); token bars reach anyone who can
 * see the token. Returns the updated character.
 */
export function setCharacterHp(io: Server, campaignId: string, character: Character, newHp: number): Character {
  const schema = systemFor(character.system);
  const { maxHp } = schema.hp(character.sheet);
  const cap = maxHp > 0 ? maxHp : Math.round(newHp);
  const clamped = Math.max(0, Math.min(cap, Math.round(newHp)));
  const sheet = { ...character.sheet, hp: clamped };
  characters.update(character.id, undefined, sheet);
  const updated = characters.byId(character.id)!;

  io.to(dmRoom(campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
  if (updated.ownerUserId) io.to(userRoom(updated.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });

  const hp = schema.hp(updated.sheet);
  const touched = new Set<string>();
  for (const t of tokens.forCharacter(character.id)) {
    tokens.update(t.id, { bar: hp });
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(t.id)! });
    touched.add(t.mapId);
  }
  for (const mapId of touched) syncMapVision(io, campaignId, mapId);
  return updated;
}

/** Broadcast a floating +/-HP animation over a token to everyone in the campaign. */
export function floatHp(io: Server, campaignId: string, mapId: string, tokenId: string, delta: number): void {
  io.to(campaignRoom(campaignId)).emit(S2C.HP_FLOAT, { mapId, tokenId, delta });
}
