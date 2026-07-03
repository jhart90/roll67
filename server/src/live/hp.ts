import type { Server } from 'socket.io';
import { S2C, conditionsOf, num, systemFor, type Character, type SheetData } from 'shared';
import { characters, tokens } from '../db/repos.js';
import { campaignRoom, dmRoom, userRoom } from './hub.js';
import { syncMapVision } from './visionService.js';

/**
 * Persist a sheet patch, emit the private character upsert (DM + owner), mirror
 * current HP onto every token bar for this character, and re-sync vision on the
 * touched maps. The full sheet stays private; token bars reach anyone who can
 * see the token. Returns the updated character.
 */
export function persistSheet(io: Server, campaignId: string, character: Character, patch: SheetData): Character {
  const sheet = { ...character.sheet, ...patch };
  characters.update(character.id, undefined, sheet);
  const updated = characters.byId(character.id)!;

  io.to(dmRoom(campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
  if (updated.ownerUserId) io.to(userRoom(updated.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });

  const hp = systemFor(updated.system).hp(updated.sheet);
  const touched = new Set<string>();
  for (const t of tokens.forCharacter(character.id)) {
    tokens.update(t.id, { bar: hp });
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(t.id)! });
    touched.add(t.mapId);
  }
  for (const mapId of touched) syncMapVision(io, campaignId, mapId);
  return updated;
}

/** Write a new current-HP value (clamped 0..maxHp). */
export function setCharacterHp(io: Server, campaignId: string, character: Character, newHp: number): Character {
  const { maxHp } = systemFor(character.system).hp(character.sheet);
  const cap = maxHp > 0 ? maxHp : Math.round(newHp);
  const clamped = Math.max(0, Math.min(cap, Math.round(newHp)));
  return persistSheet(io, campaignId, character, { hp: clamped });
}

function withoutConditions(sheet: SheetData, remove: string[]): string[] {
  return conditionsOf(sheet).filter((c) => !remove.includes(c));
}

function withCondition(sheet: SheetData, add: string): string[] {
  const cur = conditionsOf(sheet);
  return cur.includes(add) ? cur : [...cur, add];
}

/**
 * Apply an HP delta with temp-HP absorption (damage) and downed/wake handling.
 * Damage first drains Temp HP, then real HP; reaching 0 HP knocks a character
 * unconscious (5e) and resets death saves. Healing above 0 clears the
 * unconscious/dead conditions and death saves. Returns the updated character
 * plus a short human note ("(12 temp absorbed)", "— downed!", "— revived").
 */
export function applyHpDelta(
  io: Server, campaignId: string, character: Character, delta: number,
): { character: Character; note: string } {
  const schema = systemFor(character.system);
  const { hp, maxHp } = schema.hp(character.sheet);
  const cap = maxHp > 0 ? maxHp : Math.max(hp, hp + delta);
  const patch: SheetData = {};
  let note = '';

  if (delta < 0) {
    let amount = -delta;
    const temp = num(character.sheet, 'tempHp', 0);
    if (temp > 0) {
      const absorbed = Math.min(temp, amount);
      patch.tempHp = temp - absorbed;
      amount -= absorbed;
      if (absorbed > 0) note += ` (${absorbed} temp absorbed)`;
    }
    const newHp = Math.max(0, hp - amount);
    patch.hp = newHp;
    if (newHp === 0 && hp > 0) {
      // Dropped to 0. 5e characters fall unconscious and start death saves;
      // others are simply downed.
      patch.conditions = withCondition(character.sheet, 'unconscious');
      patch.deathSuccesses = 0;
      patch.deathFailures = 0;
      note += ' — downed!';
    }
  } else if (delta > 0) {
    const wasDown = hp <= 0;
    const newHp = Math.min(cap, hp + delta);
    patch.hp = newHp;
    if (wasDown && newHp > 0) {
      patch.conditions = withoutConditions(character.sheet, ['unconscious', 'dead']);
      patch.deathSuccesses = 0;
      patch.deathFailures = 0;
      note += ' — revived';
    }
  }

  const updated = persistSheet(io, campaignId, character, patch);
  return { character: updated, note };
}

/** Broadcast a floating +/-HP animation over a token to everyone in the campaign. */
export function floatHp(io: Server, campaignId: string, mapId: string, tokenId: string, delta: number): void {
  io.to(campaignRoom(campaignId)).emit(S2C.HP_FLOAT, { mapId, tokenId, delta });
}
