import type { Server } from 'socket.io';
import { MAX_WOUNDS, S2C, addTally, isAbomination, isVehicle, rollOutOfControl, rollVehicleCrit, swadeCritFail, swadeToughness, bennyPurse as swadeBennyPurse, type BennyPurse, vehicleWoundCap, WRECK_DAMAGE, type DieRoll, conditionsOf, disruptionPatch, hasActivePowers, usesArcaneDevice, DEATHS_KEY, KILLS_KEY, dieSides, firstFreeHex, getCondition, hasConcentrationAdvantage, num, packHex, roll, rollInjuryTable, str, swadeDamageOutcome, swadeWoundCap, swadeHealOutcome, systemFor, traitExpr, type Character, type ImpactKind, type SheetCard, type SheetData } from 'shared';
import { campaigns, characters, chat, mapObjects, maps, tokens, worldFolders } from '../db/repos.js';
import { campaignRoom, dmRoom, userRoom } from './hub.js';
import { socketsSeeingHex, syncMapVision } from './visionService.js';
import { broadcastWorldFolders } from './handlers/world.js';
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

export function postStatusLine(io: Server, campaignId: string, text: string, threadId?: number): void {
  const msg = chat.add(campaignId, { userId: null, fromName: 'System', kind: 'system', text, roll: null, recipients: null, threadId });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

function postStatusChange(io: Server, campaignId: string, statusLine: string, cause: string): void {
  const combined = statusLine.replace(/[!.]?$/, '') + ` by ${cause}`;
  postStatusLine(io, campaignId, combined);
}

/**
 * A change of state, as a card.
 *
 * What a token IS right now decides what it may do next, so it is the one
 * thing in the log nobody can afford to skim past — and a grey sentence in a
 * column of grey sentences is exactly what gets skimmed past. Everything that
 * changed lands on ONE card, in the condition's own color, because being
 * Shaken and Prone and Distracted from the same blow is one event.
 */
/**
 * State changes waiting to be posted, keyed by who they happened to.
 *
 * One blow can leave someone Shaken AND Prone, and the rules apply those as
 * two separate calls a line apart. Three cards for one punch is worse than
 * the sentences they replaced, so everything landing on one person in the
 * same tick is collected here and posted as a single card once the stack
 * unwinds.
 */
const pendingState = new Map<string, { subject: string; gained: string[]; lost: string[]; causes: string[] }>();

export function postStateCard(
  io: Server, campaignId: string, subject: string,
  gained: string[], lost: string[], cause: string | null,
): void {
  if (gained.length === 0 && lost.length === 0) return;
  const key = `${campaignId}::${subject}`;
  const open = pendingState.get(key);
  if (open) {
    // Same person, same tick: fold it in rather than starting a second card.
    for (const id of gained) if (!open.gained.includes(id)) open.gained.push(id);
    for (const id of lost) if (!open.lost.includes(id)) open.lost.push(id);
    if (cause && !open.causes.includes(cause)) open.causes.push(cause);
    return;
  }
  pendingState.set(key, { subject, gained: [...gained], lost: [...lost], causes: cause ? [cause] : [] });
  queueMicrotask(() => {
    const batch = pendingState.get(key);
    pendingState.delete(key);
    if (batch) flushStateCard(io, campaignId, batch);
  });
}

function flushStateCard(
  io: Server, campaignId: string,
  batch: { subject: string; gained: string[]; lost: string[]; causes: string[] },
): void {
  const { subject, gained, lost } = batch;
  const cause = batch.causes.length ? batch.causes.join(', ') : null;
  const label = (id: string) => getCondition(id)?.label ?? id;
  const card: SheetCard = {
    name: `${subject}`,
    theme: gained.length > 0 ? 'card-bad' : 'card-good',
    chips: [
      ...gained.map((id) => ({
        text: label(id), tone: 'penalty',
        title: getCondition(id)?.desc ?? undefined,
      })),
      ...lost.map((id) => ({
        text: `no longer ${label(id)}`, tone: 'bonus',
        title: getCondition(id)?.desc ?? undefined,
      })),
    ],
    notes: cause ? [cause] : [],
  };
  const parts: string[] = [];
  if (gained.length) parts.push(`is now ${gained.map(label).join(', ')}`);
  if (lost.length) parts.push(`is no longer ${lost.map(label).join(', ')}`);
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `${subject} ${parts.join('; ')}${cause ? ` — ${cause}` : ''}`,
    card, roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/** Diff two condition-id lists and post a status-change pair for every
 *  condition that was added or removed. Used for manual sheet edits (toggling
 *  a condition checkbox), where -- unlike a spell or an HP-driven change --
 *  the cause is always the editing player/DM's name, not a game mechanic. */
export function postConditionDiff(
  io: Server, campaignId: string, characterName: string, before: string[], after: string[], actorName: string,
): void {
  postStateCard(
    io, campaignId, characterName,
    after.filter((id) => !before.includes(id)),
    before.filter((id) => !after.includes(id)),
    actorName,
  );
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
  /** False applies the condition without announcing it. Used when a bigger
   *  line is about to say the same thing better — being Shaken and then
   *  Incapacitated by one blow is one event, not three. */
  announce = true,
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
    if (announce) postStateCard(io, campaignId, target.name, [conditionId], [], sourceLabel);
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
  // Conditions ride the token for the same reason the HP bar does: a player
  // is never sent somebody else's sheet, and "that thing is Shaken" is public
  // at a table — it is the badge over its head, not a secret on a page.
  const conds = conditionsOf(updated.sheet);
  const touched = new Set<string>();
  for (const t of tokens.forCharacter(character.id)) {
    tokens.update(t.id, { bar: hp, conditions: conds });
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
  /** Who dealt it, for the line that announces a kill. Absent for damage with
   *  no author — falling, a trap, the DM adjusting a bar by hand. */
  attackerName?: string,
  /** What kind of damage this was. Only Invulnerability reads it here — the
   *  resist/immune arithmetic has already been applied by the caller — and an
   *  untyped hit is exactly the anonymous violence Invulnerability shrugs
   *  off, so leaving it out is the safe default rather than a gap. */
  damageType?: string,
): { character: Character; note: string } {
  // SWADE characters use the real damage ladder — Shaken and Wounds against
  // Toughness — never the HP pool. Every damage/heal site funnels through
  // here, so branching once covers single-target hits, both AoE paths and
  // heals alike.
  if (character.system === 'swade') {
    return delta < 0
      ? applySwadeDamage(io, campaignId, character, -delta, sourceLabel, attackerName, damageType)
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
  kind?: ImpactKind, damageType?: string, text?: string,
): void {
  io.to(campaignRoom(campaignId)).emit(S2C.HP_FLOAT, { mapId, tokenId, delta, kind, damageType, ...(text ? { text } : {}) });
}

/**
 * What a hit DID, in the two or three words that go over the token.
 *
 * SWADE damage is a comparison, not a subtraction — the number on the dice is
 * meaningless until it has met a Toughness — so the float says the verdict
 * rather than the arithmetic. Returns null for anything not on the SWADE
 * ladder, where the number IS the answer.
 */
export function swadeHitText(before: Character, after: Character): string | null {
  if (after.system !== 'swade') return null;
  const conds = conditionsOf(after.sheet);
  if (conds.includes('dead')) return 'Killed!';
  if (conds.includes('incapacitated')) return 'Incapacitated!';
  const gained = Math.max(0, num(after.sheet, 'wounds', 0) - num(before.sheet, 'wounds', 0));
  if (gained >= 2) return `${gained} Wounds!`;
  if (gained === 1) return 'Wounded!';
  const nowShaken = conds.includes('shaken') && !conditionsOf(before.sheet).includes('shaken');
  if (nowShaken) return 'Shaken!';
  return 'No effect';
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
    for (const s of socketsSeeingHex(io, campaignId, obj.mapId, obj.q, obj.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
  }
  broadcastWorldFolders(io, campaignId);
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

// ---------- SWADE Aim ----------

/**
 * A character mid-Aim: 'fresh' the turn they took the action (firing now
 * wastes it), 'ready' from the start of their next turn (the first ranged
 * attack collects the bonus; anything else loses it). Absent-but-condition-set
 * (e.g. a DM toggled the chip, or a restart) is treated as 'ready'.
 */
const aimStates = new Map<string, Map<string, 'fresh' | 'ready'>>();

export function setAimState(campaignId: string, characterId: string, state: 'fresh' | 'ready'): void {
  const per = aimStates.get(campaignId) ?? new Map<string, 'fresh' | 'ready'>();
  aimStates.set(campaignId, per);
  per.set(characterId, state);
}

export function aimStateFor(campaignId: string, characterId: string): 'fresh' | 'ready' {
  return aimStates.get(campaignId)?.get(characterId) ?? 'ready';
}

/** Drop the aim: clear the condition + state, and say why (null = consumed
 *  silently — the attack's own +Aim tag tells the story). */
export function breakAim(io: Server, campaignId: string, ch: Character, reason: string | null): void {
  aimStates.get(campaignId)?.delete(ch.id);
  if (!conditionsOf(ch.sheet).includes('aiming')) return;
  persistSheet(io, campaignId, ch, { conditions: conditionsOf(ch.sheet).filter((c) => c !== 'aiming') });
  if (reason) postStatusLine(io, campaignId, `🎯 ${ch.name} ${reason}`);
}

/**
 * A Smarts roll to hold your powers together after taking a knock. Failure
 * ends all of them at once.
 *
 * Arcane Devices are the exception the book names — the USER rolls to keep a
 * device working, so it is still a roll, just not the caster's problem.
 */
function rollDisruption(io: Server, campaignId: string, ch: Character, sourceLabel: string): void {
  if (ch.system !== 'swade' || !hasActivePowers(ch.sheet)) return;
  const br = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.smarts ?? 'd4'))));
  const held = br.total >= 4;
  const what = usesArcaneDevice(ch.sheet) ? 'keeps the device working' : 'keeps concentration';
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System',
    fromCharacter: ch.name, characterId: ch.id,
    kind: 'roll',
    text: `${ch.name} — Disruption (Smarts): ${held ? 'Holds' : 'Fails'} (TN 4)`,
    outcomeNote: held ? `${ch.name} ${what}.` : `Every power ${ch.name} had running ends.`,
    roll: { ...br, outcome: held ? 'success' as const : 'failure' as const },
    recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  if (!held) persistSheet(io, campaignId, ch, disruptionPatch());
}

/**
 * Write the incapacitation into both sheets' tallies: one to the attacker's
 * "dropped" list, one to the victim's "dropped by" list.
 *
 * Only recorded when there is an attacker to name — damage from a fall or a
 * trap has nobody to credit, and inventing one would make the ledger lie.
 * The attacker is looked up by NAME among this campaign's characters, since
 * that is all the damage path carries; if two characters share a name the
 * tally may land on the wrong one, which is a fair trade for not threading an
 * id through every damage site in the engine.
 */
function recordIncapacitation(
  io: Server, campaignId: string, attackerName: string | undefined, victim: Character,
): void {
  if (!attackerName) return;
  const fresh = characters.byId(victim.id);
  if (fresh) {
    persistSheet(io, campaignId, fresh, { [DEATHS_KEY]: addTally(fresh.sheet, DEATHS_KEY, attackerName) });
  }
  const attacker = characters.forCampaign(campaignId).find((c) => c.name === attackerName);
  if (attacker) {
    persistSheet(io, campaignId, attacker, { [KILLS_KEY]: addTally(attacker.sheet, KILLS_KEY, victim.name) });
  }
}

/**
 * Does this damage type appear in the creature's Environmental Weakness — the
 * one thing that gets through an Invulnerability? Sunlight for the vampire,
 * a stained-glass shard for the ancient god the cultists misguidedly raised.
 */
function namedWeakness(sheet: SheetData, damageType?: string): boolean {
  const t = (damageType ?? '').toLowerCase().trim();
  if (!t) return false;
  return str(sheet, 'vulnerable', '').toLowerCase().split(/[,;/]/).map((x) => x.trim()).includes(t);
}

/**
 * Was that a Critical Failure?
 *
 * A Wild Card's snake eyes answer themselves. An Extra's natural 1 does not:
 * the book asks for a d6 and only a 1 on it confirms the fumble. That roll
 * happens here so every site uses the same die, and it is announced whenever
 * it is called for — a 1 that does NOT blow up needs explaining just as much
 * as one that does, or the table thinks the fumble rule is broken.
 */
export function critFailFor(io: Server, campaignId: string, ch: Character, dice: DieRoll[]): boolean {
  const wildCard = ch.sheet.wildCard !== false;
  let confirm: number | null = null;
  const crit = swadeCritFail(dice, wildCard, () => {
    confirm = roll('1d6').total;
    return confirm;
  });
  if (confirm !== null) {
    postStatusLine(io, campaignId,
      `${ch.name} rolled a natural 1 — confirming d6: ${confirm}${crit ? ' — Critical Failure!' : ' — an ordinary failure.'}`);
  }
  return crit;
}

/** Vehicles whose driver still owes a maneuvering roll against going Out of
 *  Control, waiting on the DM's answer. */
const pendingOoc = new Map<string, { characterId: string; at: number }>();
export function takeOocOffer(characterId: string): boolean {
  const rec = pendingOoc.get(characterId);
  pendingOoc.delete(characterId);
  return !!rec && Date.now() - rec.at < 5 * 60_000;
}

/**
 * Damage to a MACHINE.
 *
 * A vehicle is never Shaken — there is no nerve in it to rattle. Instead:
 * any hit that reaches its Toughness threatens control (the driver owes a
 * maneuvering roll or the thing goes Out of Control — offered to the DM as
 * a prompt, since the engine does not yet know who is driving); each raise
 * is a Wound as usual; a hit that Wounds also rolls once on the Vehicle
 * Critical Hits table — the wheels, the engine, the crew inside; and past
 * its cap the vehicle is not Incapacitated but WRECKED.
 */
/**
 * A vehicle stops being a vehicle.
 *
 * Being inside a machine as it comes apart is violence like any other, so the
 * people aboard take it through the ordinary ladder — Toughness, Soak, the
 * Benny they were saving — rather than through some special rule that ignores
 * everything a character has. Riders are thrown clear onto the ground, which
 * is also the only thing that stops a wreck dragging them around the map.
 */
function wreckVehicle(io: Server, campaignId: string, vehicle: Character, cause?: string): void {
  postStatusLine(io, campaignId, `💥 ${vehicle.name} is WRECKED${cause ? ` by ${cause}` : ''}!`);
  for (const vt of tokens.forCharacter(vehicle.id)) {
    const riders = tokens.forMap(vt.mapId).filter((t) => t.mountedOn === vt.id);
    if (riders.length === 0) continue;
    postStatusLine(io, campaignId,
      `${riders.length} aboard ${vehicle.name} ${riders.length === 1 ? 'is' : 'are'} thrown clear as it goes — ${WRECK_DAMAGE} each.`);
    for (const rider of riders) {
      tokens.update(rider.id, { mountedOn: null });
      io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(rider.id)! });
      const ch = rider.characterId ? characters.byId(rider.characterId) : undefined;
      if (!ch) continue;
      applyHpDelta(io, campaignId, ch, -roll(WRECK_DAMAGE).total, `the wreck of ${vehicle.name}`);
      const after = characters.byId(ch.id);
      if (after) applyConditionTo(io, campaignId, after, 'prone', 'thrown clear of a wreck');
    }
    tokens.update(vt.id, { driverTokenId: null });
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(vt.id)! });
    syncMapVision(io, campaignId, vt.mapId);
  }
}

function applyVehicleDamage(
  io: Server, campaignId: string, character: Character, damage: number, sourceLabel?: string,
): { character: Character; note: string } {
  const toughness = swadeToughness(character.sheet);
  const margin = damage - toughness;
  if (margin < 0) {
    return { character, note: ` — no effect (${damage} vs Toughness ${toughness})` };
  }
  let cur = character;
  const bits: string[] = [];
  const woundsDealt = Math.floor(margin / 4);
  const cap = vehicleWoundCap(cur.sheet);
  if (woundsDealt > 0) {
    const woundsAfter = Math.min(num(cur.sheet, 'wounds', 0) + woundsDealt, cap + 1);
    cur = persistSheet(io, campaignId, cur, { wounds: woundsAfter });
    bits.push(`${woundsDealt} Wound${woundsDealt === 1 ? '' : 's'} (now ${Math.min(woundsAfter, cap)} of ${cap})`);
    // One Critical Hit per wounding hit — not one per Wound.
    const crit = rollVehicleCrit();
    bits.push(`Critical Hit: ${crit.label}`);
    if (crit.patchField) {
      cur = persistSheet(io, campaignId, cur, { [crit.patchField]: num(cur.sheet, crit.patchField, 0) + 1 });
    }
    postStatusLine(io, campaignId, `🔧 ${cur.name} — ${crit.label}: ${crit.effect}`);
    if (woundsAfter > cap) {
      cur = persistSheet(io, campaignId, cur, {
        conditions: [...conditionsOf(cur.sheet).filter((c) => c !== 'incapacitated'), 'incapacitated'],
      });
      wreckVehicle(io, campaignId, cur, sourceLabel);
      return { character: cur, note: ` — ${bits.join('; ')} — WRECKED (${damage} vs Toughness ${toughness})` };
    }
  } else {
    bits.push('no Wound');
  }
  // Control is threatened by ANY hit that reaches Toughness, wounding or not.
  pendingOoc.set(cur.id, { characterId: cur.id, at: Date.now() });
  io.to(dmRoom(campaignId)).emit(S2C.VEHICLE_OOC_PROMPT, { characterId: cur.id, name: cur.name });
  bits.push('the driver must hold it or go Out of Control');
  return { character: cur, note: ` — ${bits.join('; ')} (${damage} vs Toughness ${toughness})` };
}

/**
 * The DM's answer to the Out of Control prompt: either the driver held it
 * (skip), or the vehicle rolls on the table. Collision Wounds from the table
 * are applied DIRECTLY — the book is explicit that Out of Control damage
 * never triggers another Out of Control roll.
 */
export function resolveOutOfControl(io: Server, campaignId: string, ch: Character): void {
  const out = rollOutOfControl();
  let cur = ch;
  const cap = vehicleWoundCap(cur.sheet);
  postStatusLine(io, campaignId, `🌀 ${cur.name} goes Out of Control — ${out.label} (${out.roll}): ${out.effect}`);
  if (out.vehicleWounds > 0) {
    const after = Math.min(num(cur.sheet, 'wounds', 0) + out.vehicleWounds, cap + 1);
    cur = persistSheet(io, campaignId, cur, { wounds: after });
    if (after > cap) {
      cur = persistSheet(io, campaignId, cur, {
        conditions: [...conditionsOf(cur.sheet).filter((c) => c !== 'incapacitated'), 'incapacitated'],
      });
      wreckVehicle(io, campaignId, cur, 'the collision');
    }
  }
  for (let i = 0; i < out.crits; i++) {
    const crit = rollVehicleCrit(Math.random, { rerollCrew: out.label === 'Glitch' });
    if (crit.patchField) {
      cur = persistSheet(io, campaignId, cur, { [crit.patchField]: num(cur.sheet, crit.patchField, 0) + 1 });
    }
    postStatusLine(io, campaignId, `🔧 ${cur.name} — ${crit.label}: ${crit.effect}`);
  }
  if (out.condition) {
    // The jolt hits everyone aboard, not just the hull: the mount link knows
    // who is riding, and their sheets carry the condition like anyone else's.
    cur = (applyConditionTo(io, campaignId, cur, out.condition, 'going Out of Control'), characters.byId(cur.id) ?? cur);
    for (const tok of tokens.forCharacter(cur.id)) {
      for (const rider of tokens.forMap(tok.mapId).filter((t) => t.mountedOn === tok.id)) {
        const rch = rider.characterId ? characters.byId(rider.characterId) : undefined;
        if (rch) applyConditionTo(io, campaignId, rch, out.condition, 'the vehicle going Out of Control');
      }
    }
  }
}

/** Damage vs Toughness: no effect / Shaken / Wounds / Incapacitated. */
function applySwadeDamage(
  io: Server, campaignId: string, character: Character, damage: number, sourceLabel?: string,
  attackerName?: string, damageType?: string,
): { character: Character; note: string } {
  // A machine takes its hits on its own ladder — see applyVehicleDamage.
  if (isVehicle(character.sheet)) {
    return applyVehicleDamage(io, campaignId, character, damage, sourceLabel);
  }
  const derived = systemFor('swade').derive(character.sheet);
  const toughness = Number(derived.toughness) || 4;
  const wildCard = character.sheet.wildCard !== false;
  const out = swadeDamageOutcome(damage, toughness, {
    alreadyShaken: conditionsOf(character.sheet).includes('shaken'),
    wildCard,
    currentWounds: num(character.sheet, 'wounds', 0),
    maxWounds: swadeWoundCap({
      wildCard,
      size: num(character.sheet, 'size', 0),
      override: num(character.sheet, 'maxWoundsOverride', 0),
      resilient: str(character.sheet, 'resilient', ''),
    }),
    hardy: character.sheet.hardy === true,
    // Invulnerable to everything EXCEPT what its own Environmental Weakness
    // names — the field already says what gets through, so the ability needs
    // no second list of its own. A hit with no damage type at all cannot be
    // the named exception, so it never wounds one.
    invulnerable: character.sheet.invulnerable === true && !namedWeakness(character.sheet, damageType),
  });
  if (!out.shaken) return { character, note: ` — ${out.summary}` };

  let cur = character;
  // Disruption: a knock threatens every power this caster has running. Rolled
  // here, where Shaken and Wounds are both already decided, so one hit can't
  // ask for two rolls. It follows the CASTER, not the target of the power —
  // a mage whose enchantments sit on his allies still loses them when HE is
  // hurt (the book's own example).
  rollDisruption(io, campaignId, cur, sourceLabel ?? 'damage');
  cur = characters.byId(cur.id) ?? cur;
  if (out.woundsDealt > 0) {
    // Stamp WHEN these wounds were taken. The Healing skill only works
    // within the Golden Hour — the hour after the injury — and without a
    // mark on the sheet there is nothing for the clock to measure against.
    cur = persistSheet(io, campaignId, cur, {
      wounds: out.woundsAfter,
      woundsAtSec: campaigns.clockSeconds(campaignId),
    });
  }
  // One blow that Shakes, Wounds and drops someone used to narrate itself
  // three times over — "is now Shaken by X", "is now Incapacitated by X",
  // "is Incapacitated!". It is one event. When it ends the fight, the steps
  // go in quietly and a single line says what happened, and who did it.
  const down = out.incapacitated;
  applyConditionTo(io, campaignId, cur, 'shaken', sourceLabel ?? 'damage', undefined, !down);
  cur = characters.byId(cur.id) ?? cur;
  if (down) {
    applyConditionTo(io, campaignId, cur, 'incapacitated', sourceLabel ?? 'damage', undefined, false);
    cur = characters.byId(cur.id) ?? cur;
    // An Extra that drops is out of the fight: empty its bar so the token
    // reads as down. A Wild Card keeps its pool — Soak may yet stand it up.
    if (!wildCard) cur = persistSheet(io, campaignId, cur, { hp: 0 });
    // One card, like every other change of state — and no skull: a skull is
    // death, and being Incapacitated is being out of the fight. Plenty of
    // people get up again.
    const withWhat = sourceLabel ? ` with ${sourceLabel}` : '';
    postStateCard(io, campaignId, cur.name, ['incapacitated'], [],
      attackerName ? `${attackerName}${withWhat}` : (sourceLabel ?? null));
    recordIncapacitation(io, campaignId, attackerName, cur);
  }

  // Record the Soak while the wounds are fresh (any Wild Card with a Benny —
  // the DM soaks for their own Wild Cards through the incapacitation window).
  // What this character can actually pay with — a DM's Wild Card falls back
  // on the GM's pool, so a villain out of its own chips can still Soak.
  const bennies = bennyPurse(campaignId, cur).total;
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
export interface BennyRollRec {
  expr: string; total: number; label: string; at: number;
  /** A Critical Failure cannot be rerolled, even with a Benny — the book is
   *  explicit that it ends the attempt and must be accepted. Recorded with
   *  the roll so the Benny menu can refuse rather than take the chip. */
  critFail?: boolean;
  /** This trait roll was a Soak. Rerolling one is not just a better number:
   *  it takes MORE Wounds off the same attack, so the reroll has to know
   *  what the attack offered and what the first roll already removed. */
  soak?: { offerWounds: number; removed: number };
  /**
   * What the roll was actually measured against, and what to call it —
   * "Parry 6", "TN 4", "Toughness 8".
   *
   * A reroll is not a competition with the previous roll: it is the same
   * attempt made again, and whether it worked is whether it beat the number
   * it was always up against. Without this the card could only say "better
   * than last time", which is not a question anybody at the table has.
   */
  tn?: number;
  tnName?: string;
  /** Did the original clear that number? */
  hit?: boolean;
  /**
   * What still has to happen if a reroll turns this miss into a hit: the
   * damage, and everything that follows from it. Held as the closure the
   * attack already built, so the resolution the reroll earns is the SAME
   * resolution the first roll would have had — not a second implementation
   * of it that can drift.
   */
  onHit?: () => void;
}
export const lastBennyRolls = new Map<string, { trait?: BennyRollRec; damage?: BennyRollRec }>();
const BENNY_REROLL_TTL_MS = 5 * 60_000;

function freshBennyRoll(characterId: string, kind: 'trait' | 'damage'): BennyRollRec | null {
  const rec = lastBennyRolls.get(characterId)?.[kind];
  return rec && Date.now() - rec.at <= BENNY_REROLL_TTL_MS ? rec : null;
}

/** The purse rule (see shared/systems/swade), with the GM's pool looked up. */
export function bennyPurse(campaignId: string, ch: Character): BennyPurse {
  return swadeBennyPurse({
    sheet: ch.sheet,
    playerOwned: !!ch.ownerUserId,
    gmPool: campaigns.gmBennies(campaignId),
  });
}

/**
 * Spend one, from whichever purse should pay, and say so when it was the
 * pool. Returns the character as it now stands, or null when there was
 * nothing to spend — callers check the purse first, so null is a race rather
 * than an expected answer.
 *
 * `extra` is whatever the spend also does to the sheet (clearing Shaken, say)
 * and is applied either way, so a Benny paid for out of the pool still has
 * its effect.
 */
export function spendBenny(
  io: Server, campaignId: string, ch: Character, extra: SheetData = {},
): Character | null {
  const fresh = characters.byId(ch.id) ?? ch;
  const purse = bennyPurse(campaignId, fresh);
  if (purse.total <= 0) return null;
  if (purse.own > 0) return persistSheet(io, campaignId, fresh, { bennies: purse.own - 1, ...extra });
  const left = campaigns.setGmBennies(campaignId, purse.pool - 1);
  io.to(dmRoom(campaignId)).emit(S2C.GM_BENNIES, { count: left });
  postStatusLine(io, campaignId,
    `🪙 ${fresh.name} draws on the GM's pool — ${left} left in it.`);
  return Object.keys(extra).length > 0 ? persistSheet(io, campaignId, fresh, extra) : fresh;
}

/** Tell the owner which Benny reroll buttons are currently live. */
export function emitBennyState(io: Server, campaignId: string, ch: Character): void {
  const trait = freshBennyRoll(ch.id, 'trait');
  // A DM's own characters answer to the DM, and they can spend too — their
  // own hand if they are a Wild Card, the GM's pool either way.
  const room = ch.ownerUserId ? userRoom(ch.ownerUserId) : dmRoom(campaignId);
  io.to(room).emit(S2C.BENNY_STATE, {
    characterId: ch.id,
    // A Critical Failure cannot be rerolled, so the offer is withdrawn — but
    // the reason travels with it, or the menu just looks broken.
    canRerollTrait: !!trait && !trait.critFail,
    canRerollDamage: freshBennyRoll(ch.id, 'damage') !== null,
    ...(trait?.critFail ? { traitCritFail: true } : {}),
  });
}

export function recordBennyRoll(
  io: Server, campaignId: string, ch: Character, kind: 'trait' | 'damage',
  expr: string, total: number, label: string, critFail = false,
  /** The number this roll was up against, and what happens if a reroll now
   *  clears it. See BennyRollRec. */
  against?: { tn: number; tnName: string; hit: boolean; onHit?: () => void },
): void {
  if (ch.system !== 'swade') return;
  const rec = lastBennyRolls.get(ch.id) ?? {};
  rec[kind] = {
    expr, total, label, at: Date.now(),
    ...(critFail ? { critFail: true } : {}),
    ...(against ? { tn: against.tn, tnName: against.tnName, hit: against.hit, onHit: against.onHit } : {}),
  };
  lastBennyRolls.set(ch.id, rec);
  emitBennyState(io, campaignId, ch);
}

/**
 * Record a Soak as the trait roll a Benny may reroll. The book allows it in
 * so many words — "may spend Bennies as usual to reroll the Vigor check if
 * they aren't satisfied" — and it is the one reroll a player most wants,
 * because the alternative is lying there Incapacitated.
 */
export function recordSoakRoll(
  io: Server, campaignId: string, ch: Character,
  expr: string, total: number, offerWounds: number, removed: number,
): void {
  if (ch.system !== 'swade') return;
  const rec = lastBennyRolls.get(ch.id) ?? {};
  rec.trait = { expr, total, label: 'their Soak roll', at: Date.now(), soak: { offerWounds, removed } };
  lastBennyRolls.set(ch.id, rec);
  emitBennyState(io, campaignId, ch);
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
  // You cannot bleed what does not pump: constructs and undead go down and
  // stay down rather than dying on a failed Vigor roll a few rounds later.
  if (!ok && !isAbomination(cur.sheet)) {
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
  const { woundsHealed } = swadeHealOutcome(amount, num(character.sheet, 'wounds', 0));
  return applySwadeWoundHeal(io, campaignId, character, woundsHealed);
}

/**
 * Mend a specific number of Wounds — what a successful SWADE Healing roll
 * produces (one, or two on a raise). Also steadies the Shaken and stands a
 * Wild Card back up if the mending pulls them off the incapacitation line.
 *
 * `clearShaken` is false for mending that is not treatment: a regenerating
 * troll knits its flesh back together, but nobody has slapped it round the
 * face, so it is still Shaken and still has to shake that off itself.
 */
export function applySwadeWoundHeal(
  io: Server, campaignId: string, character: Character, woundsHealed: number,
  clearShaken = true,
): { character: Character; note: string } {
  const wounds = num(character.sheet, 'wounds', 0);
  woundsHealed = Math.max(0, Math.min(wounds, Math.floor(woundsHealed)));
  const woundsAfter = wounds - woundsHealed;
  const wasShaken = clearShaken && conditionsOf(character.sheet).includes('shaken');
  let cur = character;
  const patch: SheetData = {};
  if (woundsHealed > 0) patch.wounds = woundsAfter;
  if (wasShaken) patch.conditions = conditionsOf(cur.sheet).filter((c) => c !== 'shaken');
  // Healing below the incapacitation line stands a Wild Card back up.
  const healCap = swadeWoundCap({
    wildCard: cur.sheet.wildCard !== false,
    size: num(cur.sheet, 'size', 0),
    override: num(cur.sheet, 'maxWoundsOverride', 0),
    resilient: str(cur.sheet, 'resilient', ''),
  });
  if (woundsHealed > 0 && woundsAfter <= healCap && conditionsOf(cur.sheet).includes('incapacitated')) {
    patch.conditions = (Array.isArray(patch.conditions) ? patch.conditions as string[] : conditionsOf(cur.sheet))
      .filter((c) => c !== 'incapacitated' && (clearShaken ? c !== 'shaken' : true) && c !== 'bleeding');
  }
  if (Object.keys(patch).length > 0) cur = persistSheet(io, campaignId, cur, patch);
  const bits: string[] = [];
  if (woundsHealed > 0) bits.push(`heals ${woundsHealed} Wound${woundsHealed === 1 ? '' : 's'} (now ${woundsAfter})`);
  if (wasShaken) bits.push('no longer Shaken');
  return { character: cur, note: bits.length ? ` — ${bits.join(', ')}` : ' — already steady' };
}
