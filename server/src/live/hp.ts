import type { Server } from 'socket.io';
import { S2C, conditionsOf, hasConcentrationAdvantage, num, roll, str, systemFor, type Character, type ImpactKind, type SheetData } from 'shared';
import { characters, chat, tokens } from '../db/repos.js';
import { campaignRoom, dmRoom, userRoom } from './hub.js';
import { syncMapVision } from './visionService.js';
import { applyAdv } from './handlers/chat.js';

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
 * Pure calculation half of applyHpDelta: works out the sheet patch (HP,
 * temp-HP absorption, unconscious/dead conditions, death-save reset) and any
 * concentration check an incoming hit would trigger, without writing or
 * broadcasting anything. Lets a caller preview the outcome — e.g. to build a
 * chat card's text — before the change is actually applied (which callers
 * now delay until the roll that determined it has finished animating).
 */
export function computeHpDelta(
  character: Character, delta: number,
): { patch: SheetData; note: string; concCheck: { spell: string; damage: number } | null } {
  const schema = systemFor(character.system);
  const { hp, maxHp } = schema.hp(character.sheet);
  const cap = maxHp > 0 ? maxHp : Math.max(hp, hp + delta);
  const patch: SheetData = {};
  let note = '';
  let concCheck: { spell: string; damage: number } | null = null;

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
      // others are simply downed. Concentration always ends.
      patch.conditions = withCondition(character.sheet, 'unconscious');
      patch.deathSuccesses = 0;
      patch.deathFailures = 0;
      if (str(character.sheet, 'concentration', '')) patch.concentration = '';
      note += ' — downed!';
    } else if (-delta > 0 && str(character.sheet, 'concentration', '') && character.system === 'dnd5e') {
      // Concentration: DC = max(10, half the damage taken). Auto-roll a CON save;
      // on a failure the spell ends. (Posted after persist so chat is ordered.)
      concCheck = { spell: str(character.sheet, 'concentration', ''), damage: -delta };
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
  return { patch, note, concCheck };
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
  const { patch, note: baseNote, concCheck } = computeHpDelta(character, delta);
  let note = baseNote;
  let updated = persistSheet(io, campaignId, character, patch);

  // Concentration save, after the HP change is persisted so events stay ordered.
  if (concCheck) {
    const dc = Math.max(10, Math.floor(concCheck.damage / 2));
    const sc = systemFor(updated.system).saveCheck(updated.sheet, 'con', dc);
    // War Caster: advantage on concentration saves.
    const expr = hasConcentrationAdvantage(updated.sheet) ? applyAdv(sc.expr, 'adv') : sc.expr;
    const br = roll(expr);
    const passed = br.total >= dc;
    if (!passed) updated = persistSheet(io, campaignId, updated, { concentration: '' });
    const text = `${updated.name} concentration (${concCheck.spell}) — CON save ${br.total} vs DC ${dc}: ${passed ? 'holds' : 'BROKEN'}`;
    const msg = chat.add(campaignId, { userId: null, fromName: 'System', kind: 'roll', text, roll: br, recipients: null });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
    if (!passed) note += ` — ${concCheck.spell} lost`;
  }
  return { character: updated, note };
}

/**
 * Broadcast a floating +/-HP number over a token, plus (when known) what kind
 * of hit landed and its damage type — the client picks a matching impact
 * animation and color from those two hints (see client/src/table/impactFx.tsx).
 */
export function floatHp(
  io: Server, campaignId: string, mapId: string, tokenId: string, delta: number,
  kind?: ImpactKind, damageType?: string,
): void {
  io.to(campaignRoom(campaignId)).emit(S2C.HP_FLOAT, { mapId, tokenId, delta, kind, damageType });
}
