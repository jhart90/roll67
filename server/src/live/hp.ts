import type { Server } from 'socket.io';
import { MAX_WOUNDS, S2C, conditionsOf, dieSides, firstFreeHex, getCondition, hasConcentrationAdvantage, num, packHex, roll, rollInjuryTable, str, swadeDamageOutcome, swadeHealOutcome, systemFor, traitExpr, type Character, type ImpactKind, type SheetData } from 'shared';
import { characters, chat, mapObjects, maps, tokens, worldFolders } from '../db/repos.js';
import { campaignRoom, dmRoom, userRoom } from './hub.js';
import { syncMapVision } from './visionService.js';
import { applyAdv } from './handlers/chat.js';

/** A condition a concentration spell inflicted, recorded on the CASTER's
 *  sheet (`concEffects`) so ending concentration can undo it on the target. */
export interface ConcEffect {
  characterId: string;
  condition: string;
}

function concEffectsOf(sheet: SheetData): ConcEffect[] {
  const v = sheet.concEffects;
  return Array.isArray(v) ? (v as ConcEffect[]) : [];
}

export function postStatusLine(io: Server, campaignId: string, text: string): void {
  const msg = chat.add(campaignId, { userId: null, fromName: 'System', kind: 'system', text, roll: null, recipients: null });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

function postStatusChange(io: Server, campaignId: string, statusLine: string, cause: string): void {
  const combined = statusLine.replace(/[!.]?$/, '') + ` by ${cause}`;
  postStatusLine(io, campaignId, combined);
}

/** Diff two condition-id lists and post a status-change pair for every
 *  condition that was added or removed. Used for manual sheet edits (toggling
 *  a condition checkbox), where -- unlike a spell or an HP-driven change --
 *  the cause is always the editing player/DM's name, not a game mechanic. */
export function postConditionDiff(
  io: Server, campaignId: string, characterName: string, before: string[], after: string[], actorName: string,
): void {
  for (const id of after) {
    if (before.includes(id)) continue;
    const label = getCondition(id)?.label ?? id;
    postStatusLine(io, campaignId, `${characterName} is now ${label} by ${actorName}`);
  }
  for (const id of before) {
    if (after.includes(id)) continue;
    const label = getCondition(id)?.label ?? id;
    postStatusLine(io, campaignId, `${characterName} is no longer ${label} by ${actorName}`);
  }
}

/**
 * Inflict a status condition on a character (no-op if already active), post
 * the status chat line, and — when the source is a concentration spell —
 * record the link on the caster so ending concentration removes it again.
 * Returns the (possibly re-persisted) caster.
 */
export function applyConditionTo(
  io: Server, campaignId: string, target: Character, conditionId: string, sourceLabel: string,
  concentrationCaster?: Character,
): Character | undefined {
  const label = getCondition(conditionId)?.label ?? conditionId;
  let caster = concentrationCaster;
  // Re-read: the caller's copy may predate an earlier persist in the same tick.
  target = characters.byId(target.id) ?? target;
  if (!conditionsOf(target.sheet).includes(conditionId)) {
    const next = [...conditionsOf(target.sheet), conditionId];
    // SWADE: a Stunned character also falls Prone.
    if (conditionId === 'stunned' && target.system === 'swade' && !next.includes('prone')) next.push('prone');
    persistSheet(io, campaignId, target, { conditions: next });
    postStatusChange(io, campaignId, `${target.name} is now ${label}!`, sourceLabel);
  }
  if (caster) {
    const fresh = characters.byId(caster.id) ?? caster;
    const cur = concEffectsOf(fresh.sheet);
    if (!cur.some((e) => e.characterId === target.id && e.condition === conditionId)) {
      caster = persistSheet(io, campaignId, fresh, { concEffects: [...cur, { characterId: target.id, condition: conditionId }] });
    } else {
      caster = fresh;
    }
  }
  return caster;
}

/**
 * A caster's concentration is ending: remove every condition it inflicted
 * from its targets (posting the status lines) and clear the recorded links.
 * Does NOT itself clear the `concentration` field — callers fold that into
 * whatever patch ends it. Returns the re-read caster.
 */
export function clearConcentrationEffects(io: Server, campaignId: string, caster: Character): Character {
  const effects = concEffectsOf(caster.sheet);
  if (effects.length === 0) return caster;
  const spell = str(caster.sheet, 'concentration', '') || 'concentration';
  for (const e of effects) {
    const target = characters.byId(e.characterId);
    if (!target) continue;
    if (!conditionsOf(target.sheet).includes(e.condition)) continue;
    persistSheet(io, campaignId, target, { conditions: conditionsOf(target.sheet).filter((c) => c !== e.condition) });
    const label = getCondition(e.condition)?.label ?? e.condition;
    postStatusChange(io, campaignId, `${target.name} is no longer ${label}.`, `${spell} ending`);
  }
  return persistSheet(io, campaignId, characters.byId(caster.id) ?? caster, { concEffects: [] });
}

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
): { patch: SheetData; note: string; status: 'downed' | 'revived' | null; concCheck: { spell: string; damage: number } | null } {
  const schema = systemFor(character.system);
  const { hp, maxHp } = schema.hp(character.sheet);
  const cap = maxHp > 0 ? maxHp : Math.max(hp, hp + delta);
  const patch: SheetData = {};
  let note = '';
  let status: 'downed' | 'revived' | null = null;
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
      patch.stable = false;
      if (str(character.sheet, 'concentration', '')) patch.concentration = '';
      status = 'downed';
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
      patch.stable = false;
      status = 'revived';
    }
  }
  return { patch, note, status, concCheck };
}

/**
 * Apply an HP delta with temp-HP absorption (damage) and downed/wake handling.
 * Damage first drains Temp HP, then real HP; reaching 0 HP knocks a character
 * unconscious (5e) and resets death saves. Healing above 0 clears the
 * unconscious/dead conditions and death saves. Returns the updated character
 * plus a short human note (currently only "(12 temp absorbed)" — condition
 * changes like downed/revived are posted as their own chat message below,
 * rather than folded into whatever roll's text the caller is building.
 */
export function applyHpDelta(
  io: Server, campaignId: string, character: Character, delta: number, sourceLabel?: string,
): { character: Character; note: string } {
  // SWADE characters use the real damage ladder — Shaken and Wounds against
  // Toughness — never the HP pool. Every damage/heal site funnels through
  // here, so branching once covers single-target hits, both AoE paths and
  // heals alike.
  if (character.system === 'swade') {
    return delta < 0
      ? applySwadeDamage(io, campaignId, character, -delta, sourceLabel)
      : applySwadeHeal(io, campaignId, character, delta);
  }
  const { patch, note, status, concCheck } = computeHpDelta(character, delta);
  let updated = persistSheet(io, campaignId, character, patch);

  // Dropping to 0 ends concentration (the patch cleared the field); any
  // conditions that spell was maintaining end with it. Passed the ORIGINAL
  // character, whose in-memory sheet still holds the spell name + links.
  if (status === 'downed' && str(character.sheet, 'concentration', '')) {
    updated = clearConcentrationEffects(io, campaignId, { ...character, sheet: { ...character.sheet, ...patch, concentration: character.sheet.concentration } });
  }

  // A downed/revived status is its own game event -- post it as a separate
  // chat line (after the roll that caused it, since callers only ever apply
  // this once that roll's own dice have settled) instead of folding it into
  // the causal roll's text.
  if (status) {
    const text = status === 'downed' ? `${updated.name} is downed!` : `${updated.name} is back up!`;
    postStatusChange(io, campaignId, text, sourceLabel ?? (delta < 0 ? 'damage' : 'healing'));
  }

  // Concentration save, after the HP change is persisted so events stay ordered.
  if (concCheck) {
    const dc = Math.max(10, Math.floor(concCheck.damage / 2));
    const sc = systemFor(updated.system).saveCheck(updated.sheet, 'con', dc);
    // War Caster: advantage on concentration saves.
    const expr = hasConcentrationAdvantage(updated.sheet) ? applyAdv(sc.expr, 'adv') : sc.expr;
    const br = roll(expr);
    const passed = br.total >= dc;
    if (!passed) {
      // Broken concentration releases whatever conditions it was maintaining.
      updated = clearConcentrationEffects(io, campaignId, updated);
      updated = persistSheet(io, campaignId, updated, { concentration: '' });
    }
    const text = `${updated.name} concentration (${concCheck.spell}) — CON save ${br.total} vs DC ${dc}: ${passed ? 'holds' : 'BROKEN'}`;
    // The concentration save is the damaged caster's own roll — their stats.
    const msg = chat.add(campaignId, { userId: null, fromName: 'System', kind: 'roll', text, characterId: updated.id, roll: br, recipients: null });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
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

/**
 * When a character dies, drop any chest-display folders nested under them
 * as MapObject chests on adjacent hexes.
 */
export function dropCarriedLoot(io: Server, campaignId: string, characterId: string): void {
  const folders = worldFolders.forCampaign(campaignId);
  const carried = folders.filter((f) => f.parentId === characterId && f.displayKind === 'chest');
  if (carried.length === 0) return;

  const charTokens = tokens.forCharacter(characterId);
  if (charTokens.length === 0) return;

  for (const folder of carried) {
    const tok = charTokens[0];
    const map = maps.byId(tok.mapId);
    if (!map) continue;
    const existing = mapObjects.forMap(tok.mapId);
    const occupied = new Set(existing.map((o) => packHex({ q: o.q, r: o.r })));
    occupied.add(packHex({ q: tok.q, r: tok.r }));
    const hex = firstFreeHex({ q: tok.q, r: tok.r }, occupied, map.grid);
    const obj = mapObjects.create(tok.mapId, 'chest', folder.name, '', hex.q, hex.r, { worldFolderId: folder.id });
    worldFolders.update(folder.id, { parentId: tok.mapId });
    io.to(campaignRoom(campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
  }
  io.to(campaignRoom(campaignId)).emit(S2C.WORLD_FOLDERS, { folders: worldFolders.forCampaign(campaignId) });
}

// ---------- SWADE wound ladder ----------

/**
 * A Wild Card who just took wounds may spend a Benny to Soak them. The offer
 * is recorded here when the wounds land and consumed by the SOAK_ROLL
 * handler; stale offers (the player ignored it) simply expire.
 */
export const pendingSoaks = new Map<string, { wounds: number; at: number }>();
// Long enough for a player staring at the incapacitation window to decide.
const SOAK_OFFER_TTL_MS = 5 * 60_000;

/** Damage vs Toughness: no effect / Shaken / Wounds / Incapacitated. */
function applySwadeDamage(
  io: Server, campaignId: string, character: Character, damage: number, sourceLabel?: string,
): { character: Character; note: string } {
  const derived = systemFor('swade').derive(character.sheet);
  const toughness = Number(derived.toughness) || 4;
  const wildCard = character.sheet.wildCard !== false;
  const out = swadeDamageOutcome(damage, toughness, {
    alreadyShaken: conditionsOf(character.sheet).includes('shaken'),
    wildCard,
    currentWounds: num(character.sheet, 'wounds', 0),
  });
  if (!out.shaken) return { character, note: ` — ${out.summary}` };

  let cur = character;
  if (out.woundsDealt > 0) cur = persistSheet(io, campaignId, cur, { wounds: out.woundsAfter });
  applyConditionTo(io, campaignId, cur, 'shaken', sourceLabel ?? 'damage');
  cur = characters.byId(cur.id) ?? cur;
  if (out.incapacitated) {
    applyConditionTo(io, campaignId, cur, 'incapacitated', sourceLabel ?? 'damage');
    cur = characters.byId(cur.id) ?? cur;
    // An Extra that drops is out of the fight: empty its bar so the token
    // reads as down. A Wild Card keeps its pool — Soak may yet stand it up.
    if (!wildCard) cur = persistSheet(io, campaignId, cur, { hp: 0 });
    postStatusLine(io, campaignId, `${cur.name} is Incapacitated!`);
  }

  // Record the Soak while the wounds are fresh (any Wild Card with a Benny —
  // the DM soaks for their own Wild Cards through the incapacitation window).
  const bennies = num(cur.sheet, 'bennies', 0);
  const soakable = wildCard && out.woundsDealt > 0 && bennies > 0;
  if (soakable) pendingSoaks.set(cur.id, { wounds: out.woundsDealt, at: Date.now() });

  if (out.incapacitated && wildCard) {
    // A downed Wild Card's fate is a choice, not a timer: Soak the wounds
    // away (if they can) or face the Incapacitation Vigor roll. The window
    // goes to the owning player, or to the DM for their own Wild Cards.
    const room = cur.ownerUserId ? userRoom(cur.ownerUserId) : dmRoom(campaignId);
    io.to(room).emit(S2C.INCAP_PROMPT, { characterId: cur.id, name: cur.name, canSoak: soakable });
    postStatusLine(io, campaignId, `⚕️ ${cur.name} is down — waiting on their Incapacitation roll…`);
  } else if (soakable && cur.ownerUserId) {
    io.to(userRoom(cur.ownerUserId)).emit(S2C.SOAK_OFFER, {
      characterId: cur.id, name: cur.name, wounds: out.woundsDealt, bennies,
    });
  }
  return { character: cur, note: ` — ${out.summary}` };
}

/**
 * Last trait/damage roll per SWADE character — what "Reroll a trait test" and
 * "Reroll damage" Bennies re-roll. Records expire so a stale morning roll
 * can't be Benny'd back at the evening table.
 */
export interface BennyRollRec { expr: string; total: number; label: string; at: number }
export const lastBennyRolls = new Map<string, { trait?: BennyRollRec; damage?: BennyRollRec }>();
const BENNY_REROLL_TTL_MS = 5 * 60_000;

function freshBennyRoll(characterId: string, kind: 'trait' | 'damage'): BennyRollRec | null {
  const rec = lastBennyRolls.get(characterId)?.[kind];
  return rec && Date.now() - rec.at <= BENNY_REROLL_TTL_MS ? rec : null;
}

/** Tell the owner which Benny reroll buttons are currently live. */
export function emitBennyState(io: Server, ch: Character): void {
  if (!ch.ownerUserId) return;
  io.to(userRoom(ch.ownerUserId)).emit(S2C.BENNY_STATE, {
    characterId: ch.id,
    canRerollTrait: freshBennyRoll(ch.id, 'trait') !== null,
    canRerollDamage: freshBennyRoll(ch.id, 'damage') !== null,
  });
}

export function recordBennyRoll(
  io: Server, campaignId: string, ch: Character, kind: 'trait' | 'damage',
  expr: string, total: number, label: string,
): void {
  if (ch.system !== 'swade') return;
  const rec = lastBennyRolls.get(ch.id) ?? {};
  rec[kind] = { expr, total, label, at: Date.now() };
  lastBennyRolls.set(ch.id, rec);
  emitBennyState(io, ch);
}

/** The reroll a Benny buys, if the original is still fresh. */
export function takeBennyRoll(characterId: string, kind: 'trait' | 'damage'): BennyRollRec | null {
  return freshBennyRoll(characterId, kind);
}

/**
 * The Incapacitation roll: a downed Wild Card makes an immediate Vigor roll
 * and takes an Injury Table result — permanent on a failure (and they start
 * Bleeding Out), until healed on a success, 24 hours on a raise.
 */
export function resolveIncapacitation(io: Server, campaignId: string, ch: Character): void {
  const expr = traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4')));
  const br = roll(expr);
  // Critical Failure — every arm's first die shows a 1 — means the character
  // dies outright, no injury roll, no Bleeding Out to cling to.
  const firstByArm = new Map<number, number>();
  for (const die of br.dice) {
    const arm = die.arm ?? 0;
    if (!firstByArm.has(arm)) firstByArm.set(arm, die.value);
  }
  if (firstByArm.size >= 2 && [...firstByArm.values()].every((v) => v === 1)) {
    persistSheet(io, campaignId, ch, { hp: 0 });
    const msg = chat.add(campaignId, {
      userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
      text: `${ch.name} Incapacitated — Vigor roll: CRITICAL FAILURE.`,
      roll: { ...br, outcome: 'failure' as const }, recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
    postStatusLine(io, campaignId, `💀 ${ch.name} has died.`);
    return;
  }
  const ok = br.total >= 4;
  const raise = br.total >= 8;
  const injury = rollInjuryTable(() => roll('1d6').total);
  const duration = raise ? 'for 24 hours' : ok ? 'until all Wounds heal' : 'permanently';
  const prev = str(ch.sheet, 'injuries', '');
  let cur = persistSheet(io, campaignId, ch, {
    injuries: (prev ? `${prev}; ` : '') + `${injury.location} ${duration}`,
  });
  if (!ok) {
    applyConditionTo(io, campaignId, cur, 'bleeding', 'Incapacitation');
    cur = characters.byId(cur.id) ?? cur;
  }
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: cur.name, characterId: cur.id, kind: 'roll',
    text: `${cur.name} Incapacitated — Vigor roll ${raise ? '(raise)' : ok ? '(success)' : 'FAILED'}. `
      + `Injury: ${injury.location} — ${injury.effect} (${duration})${ok ? '' : ' — Bleeding Out!'}`,
    roll: { ...br, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/** Consume a soak offer if it is still fresh. */
export function takeSoakOffer(characterId: string): { wounds: number } | null {
  const offer = pendingSoaks.get(characterId);
  pendingSoaks.delete(characterId);
  if (!offer || Date.now() - offer.at > SOAK_OFFER_TTL_MS) return null;
  return { wounds: offer.wounds };
}

/** Healing steadies the Shaken and restores a wound per full 4 points. */
function applySwadeHeal(
  io: Server, campaignId: string, character: Character, amount: number,
): { character: Character; note: string } {
  const wounds = num(character.sheet, 'wounds', 0);
  const { woundsHealed, woundsAfter } = swadeHealOutcome(amount, wounds);
  const wasShaken = conditionsOf(character.sheet).includes('shaken');
  let cur = character;
  const patch: SheetData = {};
  if (woundsHealed > 0) patch.wounds = woundsAfter;
  if (wasShaken) patch.conditions = conditionsOf(cur.sheet).filter((c) => c !== 'shaken');
  // Healing below the incapacitation line stands a Wild Card back up.
  if (woundsHealed > 0 && woundsAfter <= MAX_WOUNDS && conditionsOf(cur.sheet).includes('incapacitated')) {
    patch.conditions = (Array.isArray(patch.conditions) ? patch.conditions as string[] : conditionsOf(cur.sheet))
      .filter((c) => c !== 'incapacitated' && c !== 'shaken' && c !== 'bleeding');
  }
  if (Object.keys(patch).length > 0) cur = persistSheet(io, campaignId, cur, patch);
  const bits: string[] = [];
  if (woundsHealed > 0) bits.push(`heals ${woundsHealed} Wound${woundsHealed === 1 ? '' : 's'} (now ${woundsAfter})`);
  if (wasShaken) bits.push('no longer Shaken');
  return { character: cur, note: bits.length ? ` — ${bits.join(', ')}` : ' — already steady' };
}
