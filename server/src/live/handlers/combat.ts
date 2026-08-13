import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor, bestCastLevel, combatActions, critRange, hexDistance, hexToPixel, inBounds, num, rows, str, fmtMod,
  AMMO_BY_ROF, BENNY_FLIP_MS, MAX_WOUNDS, SECONDS_PER_ROUND, TIME_STEPS, restRecovery,
  CHASE_TRACK_DEFAULT, chaseIncrement, chaseAction, chaseRangeYards, changePosition, clampToTrack, speedBonus, canFlee, fleePenalty,
  opposedManeuver, ramDamage, boardOutcome, BOARD_MOD, EVADE_MOD, UNSTABLE_PLATFORM_MOD, FALL_FROM_VEHICLE_DAMAGE,
  bumpResult, chaseCritFailure, complicationFor, isComplicationCard, type ChaseTravel,
  isVehicle, maneuveringSkillFor, vehicleHandling, vehicleParry, SKILL_ATTR_SWADE, hasHeavyArmor, isAbomination, isConstruct, isUndead, sizeAttackMod, sizeAttackTag, swadeWoundCap, effectiveCover, coverGradeFor, COVER_LABEL, calledShotTag, clampCalledShotPenalty, dieSides, gangUpBonus, traitModWhy, reachableAlong, skillDie, soakSuccesses, swadeDamageOutcome, traitExpr, type GangUpCombatant, type MapDef, type PlayingCard,
  coverAdjustedDamage, hotPotatoPenalty, type BlastCandidate, type BlastResponsePayload,
  applyDamageDefenses, attackAdvantage, conditionCombat, conditionsOf, critDamageExpr, getCondition, rayBlocked, sightSegments,
  swnMod, isPsychicMishap, rollMishap, hasSavageAttacker, tokensInAoe, usableAmount,
  type AoeShape, type DieRoll, type SheetCard, type RollCalloutInfo, type BennyAwardPayload, type BennyUsePayload, type BleedRollPayload, type ShakenRollPayload, type StunRollPayload, type IncapRollPayload, type IncapDeathPayload, type CombatAimPayload, type CastAoePayload, type Character, type CombatActionPayload, type DeathSavePayload, type Hex, type ImpactKind,
  type InitAddPayload, type InitiativeEntry, type InitRemovePayload, type InitRollMapPayload, type InitUpdatePayload, type InitiativeState,
  type AdvanceTimePayload, type AftermathRollPayload, type ChaseStartPayload, type ChaseMovePayload, type ChaseActionPayload, type ChaseParticipant, type ChaseState, type HealingRollPayload, type VehicleOocRollPayload, type RequestSavePayload, type RollBreakdown, type SheetData, type Token, type UndoEntry, type UsePowerPayload,
  buildDeck, shuffleDeck, cardName, cardShort, compareCardEntries, swadeRangedArmor, swnReloadCheck, withRaiseDie,
  type InitCardCallPayload, type InitCardDrawPayload, type PendingCardDraw, type ReloadWeaponPayload,
  type InitRollCallPayload, type InitRollMinePayload, type PendingInitiative, type SoakRollPayload,
  swadeWoundsHealed, swadeRangeBand, swadeCritFail, swadeBennyMax,
  cardDrawPlan, chooseCard, quickRedraws, type DrawPlan, swadeStowed, sanitizeCard, type CombatAction,
  activationOutcome, backlashPatch, castingBlocker, swadeArcaneExpr, ACTIVATION_TN, FAILED_ACTIVATION_PP,
  durationRounds, durationLabel, tickPowers, toggleFor, type ActivePower,
  fearCheckFailure, fearCheckMod, fearTableRow, fearTableTotal, PANICKED_OUTCOME, type RequestFearPayload,
} from 'shared';
import { campaigns, characters, chat, initiative, maps, tokens } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { aimStateFor, applyConditionTo, critFailFor, applyHpDelta, applySwadeWoundHeal, breakAim, clearConcentrationEffects, computeHpDelta, dropCarriedLoot, floatHp, persistSheet, postStatusLine, recordBennyRoll, recordSoakRoll, resolveIncapacitation, resolveOutOfControl, takeOocOffer, setAimState, takeBennyRoll, takeSoakOffer } from '../hp.js';
import { socketsSeeingToken, syncMapVision } from '../visionService.js';
import { applyAdv } from './chat.js';
import { hasRunThisTurn, movedThisTurn, resetSwadeTurnMoves } from './tokens.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

// A save is always a single d20 roll; client/src/table/dice3d.ts settles a
// single die within ~1700ms (delay 0 + dur up to 1450-1700ms). Add a 1s pause
// on top per the requested "wait for the animation, pause a beat" pacing.
const SAVE_STEP_DELAY_MS = 2800;
/** How long the "who is rolling" banner holds. Shorter than the beat
 *  between saves, so it clears before the next name goes up. */
const CALLOUT_HOLD_MS = 2000;

// General form of the same pacing, for rolls with more than one die (e.g. a
// multi-die damage/heal roll): client/src/table/dice3d.ts staggers each die's
// start by 110ms and gives it a 1450-1700ms roll-in (capped at the 12 dice
// the overlay actually renders), so this is that roll's worst-case on-screen
// settle time plus the same 1s pause. Used to delay the moment a roll's HP
// effect (and the floating number over the token) actually lands until after
// its own dice have visibly finished — never before, or the token reacts
// before the player has seen why.
/**
 * How long the client will plausibly animate a roll, plus a beat. MUST stay
 * chain-aware: ace chains animate sequentially (each bonus die waits for its
 * predecessor to land, flash and sit readable), so a count-based estimate
 * undershoots a 3-die chain by seconds and fires impacts/HP while dice are
 * still mid-air. Constants mirror client dice3d.ts: 110 wave stagger, 1700
 * max throw, 1250 ace gap, 12-die display cap, 20s ceiling.
 */
function diceSettleDelayMs(dice: number | Array<{ ace?: boolean }>): number {
  if (typeof dice === 'number') {
    const n = Math.max(1, Math.min(dice, 12));
    return (n - 1) * 110 + 1700 + 1000;
  }
  const shown = dice.slice(0, 12);
  if (shown.length === 0) return 1000;
  const settle: number[] = [];
  let wave = 0;
  let latest = 0;
  shown.forEach((d, i) => {
    const cont = i > 0 && shown[i - 1].ace === true;
    const delay = cont ? settle[i - 1] + 1250 : (wave += i === 0 ? 0 : 110);
    settle[i] = delay + 1700;
    latest = Math.max(latest, settle[i]);
  });
  return Math.min(latest, 20000) + 1000;
}

// How long a ranged shot's travel animation takes on screen (see
// client/src/table/impactFx.tsx's Projectile). Scheduled to land exactly
// when the matching HP_FLOAT fires -- see emitProjectile's call site.
const PROJECTILE_FLIGHT_MS = 500;

/** A ranged attack's shot, timed to arrive right as its damage/heal lands
 *  (see the setTimeout math around this function's call site). */
function emitProjectile(
  io: Server, campaignId: string, mapId: string, fromTokenId: string, toTokenId: string, damageType?: string,
): void {
  io.to(campaignRoom(campaignId)).emit(S2C.PROJECTILE, { mapId, fromTokenId, toTokenId, damageType, flightMs: PROJECTILE_FLIGHT_MS });
}

/** An AoE spell's detonation, timed to play once its damage roll has settled
 *  (see call sites' setTimeout math). Point-target shapes (sphere/cylinder)
 *  get a projectile flight before the burst; self-origin shapes (cone) burst
 *  immediately with no travel time. */
function emitAoeBurst(
  io: Server, campaignId: string, mapId: string, shape: AoeShape, sizeFt: number, sizeHexes: number | undefined, widthFt: number | undefined,
  originHex: Hex, aimHex: Hex, damageType?: string,
): void {
  const flightMs = shape === 'sphere' || shape === 'cylinder' ? PROJECTILE_FLIGHT_MS : 0;
  io.to(campaignRoom(campaignId)).emit(S2C.AOE_BURST, { mapId, shape, sizeFt, sizeHexes, widthFt, originHex, aimHex, damageType, flightMs });
}

/** Players never receive hidden entries; the DM sees everything. The card
 *  deck's remaining contents never leave the server for ANYONE — clients get
 *  only the count (knowing the next card up would spoil the draw). */
/**
 * Stamp each entry with who controls it. Players only ever receive their own
 * character sheets, so they cannot resolve token → character → owner
 * themselves; the initiative window needs it for every combatant to show
 * "controlled by" and to decide who may end the current turn.
 */
function withOwners(campaignId: string, entries: InitiativeEntry[]): InitiativeEntry[] {
  const names = new Map(campaigns.members(campaignId).map((m) => [m.userId, m.username]));
  return entries.map((e) => {
    const tok = e.tokenId ? tokens.byId(e.tokenId) : undefined;
    const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
    const ownerUserId = ch?.ownerUserId ?? null;
    return {
      ...e,
      ownerUserId,
      ownerName: ownerUserId ? names.get(ownerUserId) ?? null : null,
      color: tok?.color ?? null,
    };
  });
}

function combatantChar(state: InitiativeState, idx: number): Character | undefined {
  const entry = state.entries[idx];
  const tok = entry?.tokenId ? tokens.byId(entry.tokenId) : undefined;
  return tok?.characterId ? characters.byId(tok.characterId) : undefined;
}

/** The powers currently running on a sheet, as the rules layer wants them. */
function activePowersOf(sheet: SheetData): ActivePower[] {
  return rows(sheet, 'activePowers')
    .map((r) => ({ name: str(r, 'name', ''), rounds: num(r, 'rounds', 0), upkeep: num(r, 'upkeep', 0) }))
    .filter((p) => p.name !== '' && p.rounds > 0);
}

/**
 * Casting a power whose duration is a count of rounds starts the clock. Only
 * round-based durations are filed here — 10 minutes or an hour is the table's
 * business, not the initiative loop's. Recasting a power already running
 * refreshes it rather than stacking a second copy, which is what the book's
 * "starting a new one ends the old" amounts to for a single power.
 */
function startPowerDuration(
  io: Server, campaignId: string, actor: Character,
  action: { label: string; duration?: string; ppCost?: number }, undo: UndoEntry[],
): Character {
  const total = durationRounds(action.duration);
  if (total === undefined) return actor;
  const name = action.label.trim();
  undo.push({ t: 'field', characterId: actor.id, key: 'activePowers', value: rows(actor.sheet, 'activePowers') });

  const kept = activePowersOf(actor.sheet).filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  const next = [...kept, { name, rounds: total, upkeep: action.ppCost ?? 1 }];
  const patch: SheetData = { activePowers: next };
  const toggle = toggleFor(name);
  if (toggle) {
    undo.push({ t: 'field', characterId: actor.id, key: toggle, value: actor.sheet[toggle] ?? false });
    patch[toggle] = true;
  }

  const out = persistSheet(io, campaignId, actor, patch);
  postStatusLine(io, campaignId, `${actor.name} holds ${name} — ${durationLabel(action.duration)}.`);
  return out;
}

/**
 * End of the caster's turn: every running power loses a round, and the ones
 * that hit zero drop off — clearing any sheet toggle they were driving so a
 * lapsed Armor stops quietly adding Toughness.
 */
function expirePowerDurations(io: Server, campaignId: string, ch: Character): Character {
  const active = activePowersOf(ch.sheet);
  if (active.length === 0) return ch;
  const { running, expired } = tickPowers(active);
  if (expired.length === 0 && running.length === active.length) return ch;

  const patch: SheetData = { activePowers: running };
  for (const p of expired) {
    const toggle = toggleFor(p.name);
    if (toggle) patch[toggle] = false;
  }
  const out = persistSheet(io, campaignId, ch, patch);
  for (const p of expired) postStatusLine(io, campaignId, `${ch.name}: ${p.name} runs out.`);
  return out;
}

/**
 * End of a SWADE combatant's turn: Vulnerable and Distracted expire — unless
 * a condition that inflicts them (Stunned, Bound, Entangled) is still active.
 */
function expireTurnConditions(io: Server, campaignId: string, ch: Character): void {
  ch = expirePowerDurations(io, campaignId, ch);
  let conds = conditionsOf(ch.sheet);
  // An aim held all the way through the follow-up turn is lost — the bonus
  // had to ride the FIRST action ('fresh' means the aim was taken THIS turn
  // and survives into the next one).
  if (conds.includes('aiming') && aimStateFor(campaignId, ch.id) !== 'fresh') {
    breakAim(io, campaignId, ch, 'lowers the weapon — the aim expires unused.');
    ch = characters.byId(ch.id) ?? ch;
    conds = conditionsOf(ch.sheet);
  }
  const drop: string[] = [];
  if (conds.includes('vulnerable') && !conds.includes('stunned')) drop.push('vulnerable');
  if (conds.includes('distracted') && !['bound', 'entangled', 'stunned'].some((c) => conds.includes(c))) drop.push('distracted');
  if (drop.length === 0) return;
  persistSheet(io, campaignId, ch, { conditions: conds.filter((c) => !drop.includes(c)) });
  for (const id of drop) {
    postStatusLine(io, campaignId, `${ch.name} is no longer ${getCondition(id)?.label ?? id}.`);
  }
}

/**
 * The Bleeding Out Vigor roll: die on a failure, hang on with a success,
 * stabilize on a raise. Returns false if the character died.
 */
function resolveBleedingOut(io: Server, campaignId: string, ch: Character): boolean {
  const b = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4'))));
  const ok = b.total >= 4;
  if (b.total >= 8) {
    persistSheet(io, campaignId, ch, { conditions: conditionsOf(ch.sheet).filter((c) => c !== 'bleeding') });
  } else if (!ok) {
    persistSheet(io, campaignId, ch, { hp: 0 });
  }
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
    text: b.total >= 8
      ? `${ch.name} stabilizes — Vigor roll (raise)`
      : ok
        ? `${ch.name} clings to life — Vigor roll`
        : `${ch.name} succumbs to their wounds — Vigor roll failed`,
    roll: { ...b, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  if (!ok) postStatusLine(io, campaignId, `💀 ${ch.name} has died.`);
  return ok;
}

/**
 * Start of a SWADE combatant's turn: Bleeding Out (Vigor or die), Stunned
 * (free Vigor to come to), then Shaken (Spirit to shake it off). Each one
 * prompts whoever runs the character — the roll is theirs to click.
 */
function startOfTurnRecovery(io: Server, campaignId: string, chIn: Character): void {
  let ch = chIn;
  const reread = () => { ch = characters.byId(ch.id) ?? ch; };
  // Defend's +4 Parry lasts exactly until this moment — their turn is back.
  if (conditionsOf(ch.sheet).includes('defending')) {
    persistSheet(io, campaignId, ch, { conditions: conditionsOf(ch.sheet).filter((c) => c !== 'defending') });
    postStatusLine(io, campaignId, `${ch.name} is no longer Defending.`);
    reread();
  }

  // Regeneration goes first, and before the Incapacitated gate below: a
  // regenerating creature heals whether or not it is down, and a roll good
  // enough to pull it back over the line stands it up in time to act.
  if (str(ch.sheet, 'regeneration', '') === 'fast' && num(ch.sheet, 'wounds', 0) > 0) {
    resolveFastRegeneration(io, campaignId, ch);
    reread();
  }

  // Bleeding Out: die on a failure, hang on with a success, stabilize on a
  // raise. A player-owned character gets the prompt and rolls it themself;
  // ownerless NPCs roll automatically.
  if (conditionsOf(ch.sheet).includes('bleeding')) {
    // Owned characters prompt their player; the DM's own tokens prompt the DM.
    const room = ch.ownerUserId ? userRoom(ch.ownerUserId) : dmRoom(campaignId);
    io.to(room).emit(S2C.BLEED_PROMPT, { characterId: ch.id, name: ch.name });
    postStatusLine(io, campaignId, `🩸 ${ch.name} is Bleeding Out — waiting on their Vigor roll…`);
    return;
  }
  // Down is down: no Stunned/Shaken recovery while Incapacitated.
  if (conditionsOf(ch.sheet).includes('incapacitated')) return;

  // An aim taken last turn ripens: the FIRST action this turn may collect it.
  if (conditionsOf(ch.sheet).includes('aiming')) setAimState(campaignId, ch.id, 'ready');

  // Stunned: whoever runs this character rolls the free Vigor themself —
  // same prompt pattern as Shaken and Bleeding Out, so every recovery roll
  // is the player's own click.
  if (conditionsOf(ch.sheet).includes('stunned')) {
    const room = ch.ownerUserId ? userRoom(ch.ownerUserId) : dmRoom(campaignId);
    io.to(room).emit(S2C.STUN_PROMPT, { characterId: ch.id, name: ch.name });
  }

  // Shaken: whoever runs this character rolls Spirit themself — the prompt
  // goes to the owning player, or to the DM's screen for their own tokens.
  if (conditionsOf(ch.sheet).includes('shaken')) {
    const room = ch.ownerUserId ? userRoom(ch.ownerUserId) : dmRoom(campaignId);
    io.to(room).emit(S2C.SHAKEN_PROMPT, { characterId: ch.id, name: ch.name });
  }
}

/**
 * SWADE venom.
 *
 * The bite has to actually tell — a hit that does not at least Shake never
 * delivers the poison, which is the rule that stops a venomous creature being
 * a save-or-die machine that ignores armour. Then the victim rolls Vigor,
 * modified by the strength of the poison, and pays for a failure.
 *
 * What failure costs is the creature's own line to state (the Hazards table
 * runs from a level of Fatigue to lethal), so the attack row carries it and
 * this only decides when to ask and what to do with the answer.
 */
function resolvePoison(
  io: Server, campaignId: string, target: Character,
  poison: { mod: number; effect: string; kind?: string }, sourceLabel: string,
): void {
  const fresh = characters.byId(target.id) ?? target;
  const br = roll(traitExpr(fresh.sheet, dieSides(String(fresh.sheet.vigor ?? 'd4')), poison.mod));
  const resisted = br.total >= 4;
  const effectWord = poison.effect === 'incapacitated' ? 'Incapacitated'
    : poison.effect === 'shaken' ? 'Shaken'
      : poison.effect === 'paralyzed' ? 'Paralysed'
        : 'a level of Fatigue';
  const label = poison.kind === 'infection' ? 'Infection' : 'Poison';
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'roll', characterId: fresh.id,
    text: `${fresh.name} — ${label} (Vigor${fmtMod(poison.mod)}) from ${sourceLabel}: ${resisted ? 'shrugs it off' : `takes ${effectWord}`}`,
    roll: { ...br, outcome: resisted ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  if (resisted) return;
  if (poison.effect === 'fatigue') {
    // Fatigue is a track, not a condition: two levels and they are out.
    const after = Math.min(2, num(fresh.sheet, 'fatigue', 0) + 1);
    persistSheet(io, campaignId, fresh, { fatigue: after });
    postStatusLine(io, campaignId, `${fresh.name} is Fatigued by ${label.toLowerCase()} (${after} of 2).`);
    if (after >= 2) applyConditionTo(io, campaignId, characters.byId(fresh.id) ?? fresh, 'incapacitated', label.toLowerCase());
    return;
  }
  // Paralysis also Stuns, per the book: rigid AND rattled.
  if (poison.effect === 'paralyzed') {
    applyConditionTo(io, campaignId, fresh, 'stunned', label.toLowerCase());
    applyConditionTo(io, campaignId, characters.byId(fresh.id) ?? fresh, 'paralyzed', label.toLowerCase());
    postStatusLine(io, campaignId, `${fresh.name} is Paralysed — no action of any kind, even speech, for 2d6 rounds.`);
    return;
  }
  applyConditionTo(io, campaignId, fresh, poison.effect === 'shaken' ? 'shaken' : 'incapacitated', label.toLowerCase());
}

/**
 * Fast Regeneration: a Vigor roll at the start of every turn knits a Wound
 * shut, two on a raise — and it happens even while Incapacitated, which is
 * the whole horror of the troll. It gets back up.
 *
 * Rolled rather than prompted: there is no decision in it, so a click would
 * only be a click. It does NOT clear Shaken — flesh closing over is not the
 * same as getting your wits back, and the creature still has to shake that
 * off on its own.
 *
 * What it cannot regenerate — fire for a troll, silver for a werewolf — is
 * the DM's to hold back. Nothing on a sheet records which Wound came from
 * what, so the engine cannot know, and pretending otherwise would be worse
 * than leaving it to the person who watched it happen.
 */
function resolveFastRegeneration(io: Server, campaignId: string, ch: Character): void {
  const br = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4'))));
  const healed = swadeWoundsHealed(br.total >= 4, br.total >= 8);
  const outcome = healed > 0
    ? `knits shut ${healed} Wound${healed === 1 ? '' : 's'}`
    : 'the flesh holds where it is';
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'roll', characterId: ch.id,
    text: `${ch.name} — Regeneration (Vigor): ${outcome}`,
    roll: { ...br, outcome: healed > 0 ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  if (healed > 0) applySwadeWoundHeal(io, campaignId, ch, healed, false);
}

/**
 * The Stunned recovery: Vigor vs 4 — success comes to (but Vulnerable and
 * Distracted until the end of their next turn); a raise clears those too.
 * Prone stays until they spend the Pace to stand.
 */
export function resolveStunRecovery(io: Server, campaignId: string, ch: Character): void {
  const b = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4'))));
  const ok = b.total >= 4;
  if (ok) {
    const raise = b.total >= 8;
    let conds = conditionsOf(ch.sheet).filter((c) => c !== 'stunned');
    conds = raise
      ? conds.filter((c) => c !== 'vulnerable' && c !== 'distracted')
      : [...new Set([...conds, 'vulnerable', 'distracted'])];
    persistSheet(io, campaignId, ch, { conditions: conds });
  }
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
    text: ok
      ? `${ch.name} is no longer Stunned${b.total >= 8 ? '' : ' (but Vulnerable and Distracted)'} — Vigor roll`
      : `${ch.name} is still Stunned — Vigor roll`,
    roll: { ...b, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/** The Shaken recovery: Spirit vs 4 — success stands them back up. */
export function resolveShakenRecovery(io: Server, campaignId: string, ch: Character): void {
  // A construct is +2 to come out of it: there is less of it to rattle.
  const b = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.spirit ?? 'd4')), isConstruct(ch.sheet) ? 2 : 0));
  const recovered = b.total >= 4;
  if (recovered) {
    persistSheet(io, campaignId, ch, { conditions: conditionsOf(ch.sheet).filter((c) => c !== 'shaken') });
  }
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
    text: recovered ? `${ch.name} shakes it off — Spirit roll` : `${ch.name} is still Shaken — Spirit roll`,
    callout: { what: 'shaking it off — Spirit', tone: 'recover' },
    roll: { ...b, outcome: recovered ? 'success' as const : 'failure' as const }, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/** SWADE Multi-Action tracking: actions taken this turn, per character. */
const swadeActionCounts = new Map<string, Map<string, number>>();

/** Count an action for Multi-Action purposes; returns the penalty it takes. */
function multiActionPenalty(campaignId: string, characterId: string): number {
  if (!initiative.get(campaignId).active) return 0;
  const per = swadeActionCounts.get(campaignId) ?? new Map<string, number>();
  swadeActionCounts.set(campaignId, per);
  const prior = per.get(characterId) ?? 0;
  per.set(characterId, prior + 1);
  return Math.min(2, prior) * -2;
}

/** Does this creature's Immunity list cover the damage type of an attack? */
function isImmuneTo(character: Character, damageType: string | undefined): boolean {
  if (!damageType) return false;
  return applyDamageDefenses(character.system, character.sheet, damageType, 1).amount === 0;
}

function bestSkillOf(sheet: SheetData, names: string[]): { name: string; sides: number } {
  let best = { name: names[0], sides: skillDie(sheet, names[0]) };
  for (const n of names) {
    const s = skillDie(sheet, n);
    if (s > best.sides) best = { name: n, sides: s };
  }
  return best;
}

/**
 * SWADE combat maneuvers — Touch Attack, Support, and the opposed trio
 * (Push, Grapple, Test). Opposed rolls pace like everything else: attacker's
 * card, then the defender's resistance once those dice settle, then effects.
 */
function resolveSwadeManeuver(
  io: Server, d: { campaignId: string; userId: string; username: string }, socket: Socket,
  kind: 'push' | 'grapple' | 'test' | 'support' | 'touch',
  actor: Character, targetChar: Character | undefined, src: Token, tgt: Token, map: MapDef,
): void {
  const campaignId = d.campaignId;
  if (!targetChar) { emitError(socket, 'That maneuver needs a character target.'); return; }
  const postRoll = (ch: Character, text: string, br: ReturnType<typeof roll>, ok: boolean | null) => {
    const msg = chat.add(campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: ch.name,
      characterId: ch.id, statsUserId: ch.ownerUserId, kind: 'roll', text,
      roll: ok === null ? br : { ...br, outcome: ok ? 'success' as const : 'failure' as const },
      recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  };
  const mapMod = multiActionPenalty(campaignId, actor.id);

  if (kind === 'touch') {
    const br = roll(traitExpr(actor.sheet, skillDie(actor.sheet, 'Fighting'), 2 + mapMod));
    const parry = Number(systemFor('swade').derive(targetChar.sheet).ac) || 2;
    const hit = br.total >= parry;
    postRoll(actor, `${actor.name} makes a touch attack on ${targetChar.name} — Fighting +2 vs Parry ${parry}: ${hit ? 'TOUCHED' : 'MISS'}`, br, hit);
    return;
  }
  if (kind === 'support') {
    const sk = bestSkillOf(actor.sheet, ['Athletics', 'Common Knowledge', 'Notice', 'Persuasion', 'Stealth']);
    const br = roll(traitExpr(actor.sheet, sk.sides, mapMod));
    const gain = br.total >= 8 ? 2 : br.total >= 4 ? 1 : 0;
    if (gain > 0) {
      persistSheet(io, campaignId, targetChar, { supportBonus: Math.min(4, num(targetChar.sheet, 'supportBonus', 0) + gain) });
    }
    postRoll(actor, `${actor.name} supports ${targetChar.name} (${sk.name}): ${gain > 0 ? `+${gain} on their next roll` : 'no help this time'}`, br, gain > 0);
    return;
  }

  // The opposed trio: attacker must score a success (4+) AND beat the
  // defender's total; beating it by 4+ is a raise.
  const spec = kind === 'push'
    ? { aLabel: 'Strength', aSides: dieSides(String(actor.sheet.strength ?? 'd4')), dLabel: 'Strength', dSides: dieSides(String(targetChar.sheet.strength ?? 'd4')) }
    : kind === 'grapple'
      ? { aLabel: 'Athletics', aSides: skillDie(actor.sheet, 'Athletics'), dLabel: 'Athletics', dSides: skillDie(targetChar.sheet, 'Athletics') }
      : (() => {
        // Fearless creatures cannot be Intimidated, but they CAN be Taunted —
        // ridicule draws their attention where fear finds nothing to grip. So
        // the Test drops Intimidation from the skills it would pick between
        // rather than failing outright.
        const fearless = targetChar.sheet.fearless === true;
        const sk = bestSkillOf(actor.sheet, fearless ? ['Taunt', 'Athletics'] : ['Taunt', 'Intimidation', 'Athletics']);
        if (fearless) postStatusLine(io, campaignId, `${targetChar.name} is Fearless — Intimidation finds nothing to grip; ${actor.name} tries ${sk.name} instead.`);
        const attr = SKILL_ATTR_SWADE[sk.name] ?? 'smarts';
        return { aLabel: sk.name, aSides: sk.sides, dLabel: attr[0].toUpperCase() + attr.slice(1), dSides: dieSides(String(targetChar.sheet[attr] ?? 'd4')) };
      })();
  const verb = kind === 'push' ? 'push' : kind === 'grapple' ? 'grapple' : 'rattle';
  const aBr = roll(traitExpr(actor.sheet, spec.aSides, mapMod));
  postRoll(actor, `${actor.name} tries to ${verb} ${targetChar.name} — ${spec.aLabel}`, aBr, null);

  setTimeout(() => {
    const freshTarget = characters.byId(targetChar.id);
    if (!freshTarget) return;
    const dBr = roll(traitExpr(freshTarget.sheet, spec.dSides));
    const success = aBr.total >= 4 && aBr.total > dBr.total;
    const raiseWin = success && aBr.total - dBr.total >= 4;
    postRoll(freshTarget, `${freshTarget.name} resists — ${spec.dLabel} ${dBr.total} vs ${aBr.total}`, dBr, !success);

    setTimeout(() => {
      const fresh = characters.byId(targetChar.id);
      if (!fresh) return;
      if (!success) {
        postStatusLine(io, campaignId, `${fresh.name} holds firm against ${actor.name}'s ${verb}.`);
        return;
      }
      if (kind === 'test') {
        applyConditionTo(io, campaignId, fresh, 'distracted', `${actor.name}'s Test`);
        if (raiseWin) applyConditionTo(io, campaignId, characters.byId(fresh.id) ?? fresh, 'shaken', `${actor.name}'s Test`);
        postStatusLine(io, campaignId, `${actor.name}'s Test rattles ${fresh.name}${raiseWin ? ' badly — Distracted and Shaken!' : ' — Distracted!'}`);
      } else if (kind === 'grapple') {
        applyConditionTo(io, campaignId, fresh, raiseWin ? 'bound' : 'entangled', `${actor.name}'s Grapple`);
        // The grappler is wide open while holding on.
        applyConditionTo(io, campaignId, characters.byId(actor.id) ?? actor, 'vulnerable', 'grappling');
        postStatusLine(io, campaignId, `${actor.name} grapples ${fresh.name} — ${raiseWin ? 'Bound' : 'Entangled'}!`);
      } else {
        // Push: knocked back 1 hex (2 and Prone on a raise), held up by walls.
        const live = tokens.byId(tgt.id);
        if (!live) return;
        let cur = { q: live.q, r: live.r };
        const steps = raiseWin ? 2 : 1;
        const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        for (let s = 0; s < steps; s++) {
          let bestHex = cur;
          let bestDist = hexDistance({ q: src.q, r: src.r }, cur);
          for (const [dq, dr] of DIRS) {
            const cand = { q: cur.q + dq, r: cur.r + dr };
            if (!inBounds(cand, map.grid)) continue;
            const dd = hexDistance({ q: src.q, r: src.r }, cand);
            if (dd > bestDist) { bestDist = dd; bestHex = cand; }
          }
          const stop = reachableAlong(cur, bestHex, { grid: map.grid, walls: map.walls, doors: map.doors });
          if (stop.q === cur.q && stop.r === cur.r) break;
          cur = stop;
        }
        if (cur.q !== live.q || cur.r !== live.r) {
          tokens.move(live.id, cur.q, cur.r);
          const moved = tokens.byId(live.id)!;
          for (const s of socketsSeeingToken(io, campaignId, moved)) {
            s.emit(S2C.TOKEN_MOVED, { tokenId: live.id, q: cur.q, r: cur.r });
          }
          syncMapVision(io, campaignId, live.mapId, { hexes: [{ q: live.q, r: live.r }, cur] });
        }
        if (raiseWin) applyConditionTo(io, campaignId, fresh, 'prone', `${actor.name}'s Push`);
        postStatusLine(io, campaignId, `${actor.name} shoves ${fresh.name} back${raiseWin ? ' hard — knocked Prone!' : '.'}`);
      }
    }, diceSettleDelayMs(dBr.dice));
  }, diceSettleDelayMs(aBr.dice));
}

/** SWADE bookkeeping at every turn handover, for both advance paths. */
function processTurnTransition(io: Server, campaignId: string, state: InitiativeState, prevIdx: number): void {
  finishTurnTransition(io, campaignId, state, combatantChar(state, prevIdx));
}

/** Same, but with the finished combatant already resolved — a round-wrap
 *  redeal re-sorts the entries, so indexes into the old order go stale. */
function finishTurnTransition(io: Server, campaignId: string, state: InitiativeState, prev: Character | undefined): void {
  resetSwadeTurnMoves(campaignId);
  // Change Position is once per turn, so a new turn hands it back — and with
  // it the turn's chase action. Evading and a steadied wheel are both "until
  // your next turn", so they lapse on the same edge.
  if (state.chase) {
    for (const p of state.chase.participants) {
      p.movedThisTurn = false;
      p.actedThisTurn = false;
      p.evading = false;
      p.steadied = false;
    }
  }
  swadeActionCounts.delete(campaignId);
  if (prev?.system === 'swade') expireTurnConditions(io, campaignId, prev);
  const ch = combatantChar(state, state.turnIdx);
  if (ch?.system === 'swade') startOfTurnRecovery(io, campaignId, ch);
  // …and whatever the Club they were dealt has waiting for them.
  resolveChaseComplication(io, campaignId, state);
}

/**
 * SWADE round 2+: deal everyone a fresh Action Card automatically — the
 * order reshuffles every round, per the book. The deck persists across
 * rounds and reshuffles only after a round in which a Joker was dealt.
 * Held combatants keep holding and draw no card.
 */
/**
 * One combatant's Action Card, with their Edges and Hindrances applied.
 *
 * Quick, Level Headed, Improved Level Headed and Hesitant all change the deal
 * rather than the card, so this is the single place that knows how: draw the
 * plan's worth of cards, let Quick throw back anything at or under a 5, act on
 * the best or worst as the plan says, and slide everything unused back under
 * the deck. Used by both the initial deal and the per-round redeal, because
 * SWADE redeals every round and the Edge has to fire every round with it.
 */
function drawActionCard(
  state: InitiativeState,
  sheet: SheetData | null,
): { card: PlayingCard; discarded: PlayingCard[]; plan: DrawPlan } {
  const plan = sheet ? cardDrawPlan(sheet) : { draw: 1, keep: 'best' as const, redrawAtOrBelow: 0, reasons: [] };
  const next = (): PlayingCard => {
    if (!state.deck || state.deck.length === 0) state.deck = shuffleDeck(buildDeck());
    return state.deck.shift()!;
  };
  const drawn: PlayingCard[] = [];
  for (let i = 0; i < plan.draw; i++) drawn.push(next());
  const discarded: PlayingCard[] = [];
  for (let i = 0; i < drawn.length; i++) {
    // Bounded: a pathological deck must not spin here forever.
    let guard = 0;
    while (quickRedraws(drawn[i], plan.redrawAtOrBelow) && guard++ < 20) {
      discarded.push(drawn[i]);
      drawn[i] = next();
    }
  }
  const card = chooseCard(drawn, plan.keep);
  for (const c of [...discarded, ...drawn]) if (c !== card) state.deck!.push(c);
  return { card, discarded, plan };
}

/** The sheet behind a token, when there is one. */
function sheetForToken(tokenId: string | null): SheetData | null {
  if (!tokenId) return null;
  const tok = tokens.byId(tokenId);
  const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
  return ch ? ch.sheet : null;
}

function redealRoundCards(io: Server, campaignId: string, state: InitiativeState): void {
  if (!state.active || !state.cardMode || state.entries.length === 0) return;
  if (state.jokerDealt) {
    state.deck = shuffleDeck(buildDeck());
    postStatusLine(io, campaignId, '🂠 A Joker was dealt last round — the action deck is reshuffled.');
  }
  state.jokerDealt = false;
  const dealt: Array<{ tokenId: string | null; name: string; card: PlayingCard; hidden: boolean }> = [];
  // Which sides drew a Joker this round — paid out after the whole deal, so
  // the Bennies land once the table can see every card.
  const jokerDraws: Array<{ name: string; playerSide: boolean; hidden: boolean }> = [];
  for (const entry of state.entries) {
    if (entry.held) continue;
    const { card } = drawActionCard(state, sheetForToken(entry.tokenId));
    if (card.rank === 15) {
      state.jokerDealt = true;
      jokerDraws.push({
        name: entry.name,
        playerSide: entry.tokenId ? isPlayerSideToken(entry.tokenId) : false,
        hidden: !!entry.hidden,
      });
    }
    state.drawCounter = (state.drawCounter ?? 0) + 1;
    entry.card = card;
    entry.value = card.rank;
    entry.drawSeq = state.drawCounter;
    dealt.push({ tokenId: entry.tokenId, name: entry.name, card, hidden: entry.hidden });
  }
  state.entries.sort(compareCardEntries);
  state.turnIdx = 0;
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `🂠 Round ${state.round} — new action cards are dealt.`,
    roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  // The table-wide reveal: face-down cards flipping in deal order. Hidden
  // combatants stay off screen; the DM reads theirs from the initiative list.
  io.to(campaignRoom(campaignId)).emit(S2C.ROUND_CARDS, {
    round: state.round,
    cards: dealt.filter((c) => !c.hidden).map(({ hidden: _h, ...rest }) => rest),
  });
  for (const j of jokerDraws) jokersWild(io, campaignId, j.name, j.playerSide, j.hidden);
  flagChaseComplications(io, campaignId, state);
}

export function initiativeViewFor(state: InitiativeState, isDm: boolean, campaignId: string): InitiativeState {
  const { deck, drawCounter, ...rest } = state;
  const view: InitiativeState = {
    ...rest,
    entries: withOwners(campaignId, rest.entries),
    ...(state.cardMode ? { deckRemaining: deck?.length ?? 0 } : {}),
  };
  if (isDm) return view;
  // A combatant the party cannot see must not announce itself on the chase
  // track either — the track is public, its hidden riders are not.
  const hiddenIds = new Set(view.entries.filter((e) => e.hidden).map((e) => e.id));
  return {
    ...view,
    entries: view.entries.filter((e) => !e.hidden),
    pendingDraws: view.pendingDraws?.filter((p) => !p.hidden),
    pendingRolls: view.pendingRolls?.filter((p) => !p.hidden),
    ...(view.chase ? {
      chase: { ...view.chase, participants: view.chase.participants.filter((p) => !hiddenIds.has(p.entryId)) },
    } : {}),
  };
}

export function broadcastInitiative(io: Server, campaignId: string): void {
  const state = initiative.get(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    socket.emit(S2C.INITIATIVE, { state: initiativeViewFor(state, d.role === 'dm', campaignId) });
  }
}

interface GroupSaveSpec {
  campaignId: string;
  userId: string;
  username: string;
  tokenIds: string[];
  saveId: string;
  dc: number;
  damageExpr?: string;
  onSave: 'half' | 'negate';
  damageType?: string;
  label?: string;
  // Set only when this save was triggered by an AoE spell template (not the
  // DM's manual "call for save" tool) -- lets postDamage broadcast the
  // burst/ripple animation once the damage roll settles.
  aoeVisual?: { mapId: string; shape: AoeShape; sizeFt: number; sizeHexes?: number; widthFt?: number; originHex: Hex; aimHex: Hex };
  /** Condition inflicted on each character target that FAILS its save. */
  appliesCondition?: string;
  /** SWADE Evasion: the save is an Agility dive at −2. */
  evasion?: boolean;
  /** SWADE Group Roll: one roll decides the whole mob (see runGroupSave). */
  group?: boolean;
  /** SWADE Covering: somebody threw themselves on the grenade. They take
   *  double damage and never get to dive clear (they are diving the other
   *  way); their Toughness comes off everyone else's damage. */
  cover?: { tokenId: string; name: string; toughness: number };
  /** When the source spell is concentration: the caster to record the
   *  inflicted conditions on, so ending concentration lifts them. */
  concentrationCasterId?: string;
  /** Who set this off, so a kill is attributed to them and not to the spell. */
  attackerName?: string;
  /**
   * The "casting" card this whole resolution belongs to. Every reversible
   * effect — damage, wounds, conditions — is appended to that message, so
   * Hide & Undo on the one card the DM can actually point at rewinds the
   * entire power rather than one roll out of the middle of it.
   */
  leadMessageId?: number;
}

/**
 * Roll each target's save one at a time — each posts as its own red/green
 * chat card, paced by the dice-settle delay — then (if there's a damage
 * expression) roll damage once and apply it per target based on their own
 * pass/fail. Shared by the DM's manual "call for save" tool and an AoE spell
 * cast once its template is locked in. Returns false (nothing posted) if
 * none of the given token ids resolve to a real token.
 */
/**
 * The card an area attack leads with: what is being used, by whom, before a
 * single die is thrown.
 *
 * Built from the action rather than the sheet row so it says what is actually
 * about to happen — the damage as modified, the template as aimed. It carries
 * the undo for the whole resolution, which is why it has to exist even when
 * the power is dull to look at: the DM needs one thing to right-click.
 */
/**
 * The arcane skill roll every SWADE power is cast with.
 *
 * The book gives one procedure for all of them: pick a target in Range, roll
 * the arcane skill, and under 4 the power does not activate. Two paths reach
 * this — a single-target power and an area template — and both used to skip
 * it: the area one simply dropped its template, and a resisted one went
 * straight to the defender's roll. Neither asked the caster to do anything.
 *
 * Returns null when the power does not go off, having already posted the card
 * and taken the one Power Point a failure costs. The caller stops there.
 */
/** Who is owed a natural healing roll, waiting on the GM's yes. */
const pendingNaturalHealing = new Map<string, string[]>();

/**
 * Natural Healing: a Vigor roll that mends a Wound, two on a raise, and a
 * Critical Failure makes things worse. Rolled only when the GM says so — a
 * week of downtime should not fire a dozen dice the moment the clock moves.
 */
function runNaturalHealing(io: Server, campaignId: string, shouldRoll: boolean): void {
  const ids = pendingNaturalHealing.get(campaignId) ?? [];
  pendingNaturalHealing.delete(campaignId);
  if (!shouldRoll || ids.length === 0) return;
  const clock = campaigns.clockSeconds(campaignId);
  const lines: string[] = [];
  for (const id of ids) {
    const ch = characters.byId(id);
    if (!ch || num(ch.sheet, 'wounds', 0) <= 0) continue;
    const br = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4'))));
    const crit = critFailFor(io, campaignId, ch, br.dice);
    const wounds = num(ch.sheet, 'wounds', 0);
    // A Critical Failure is the wound going bad: infection, blood loss, the
    // injury aggravated. One step the wrong way.
    const next = crit ? wounds + 1 : br.total >= 8 ? wounds - 2 : br.total >= 4 ? wounds - 1 : wounds;
    persistSheet(io, campaignId, ch, {
      wounds: Math.max(0, next),
      lastNaturalHealSec: clock,
      // Mending resets the clock the Golden Hour runs on: what is left is a
      // fresh state of the body, not the same hour-old injury.
      ...(next < wounds ? { woundsAtSec: clock } : {}),
    });
    lines.push(crit ? `${ch.name} worsens (${br.total} — Critical Failure)`
      : next < wounds ? `${ch.name} mends ${wounds - next} (${br.total})`
        : `${ch.name} holds steady (${br.total})`);
  }
  postStatusLine(io, campaignId, `🌿 Natural healing — ${lines.join('; ')}.`);
}

/** "Day 3 · 14:22" — the in-world clock as the table reads it. */
function clockLabel(seconds: number): string {
  const day = Math.floor(seconds / 86_400) + 1;
  const hh = String(Math.floor((seconds % 86_400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}

/**
 * What the passing of time does to everyone's sheet.
 *
 * Every rule here answers the same question at a different magnitude — how
 * much passed, and what has that mended or cost — so they live together and
 * each decides for itself whether this passage is enough to matter to it.
 * Anything that wants DICE is not here: rolls the GM did not ask for are
 * noise, and those arrive as prompts (see the Aftermath prompt for the shape).
 *
 * Returns the lines for the report card, in the order they happened.
 */
function applyTimePassage(io: Server, campaignId: string, seconds: number, clockAfter: number): string[] {
  const notes: string[] = [];
  const hours = Math.floor(seconds / 3600);
  const rounds = Math.floor(seconds / SECONDS_PER_ROUND);
  const swadeChars = characters.forCampaign(campaignId).filter((c) => c.system === 'swade');

  for (const ch of swadeChars) {
    let cur = characters.byId(ch.id) ?? ch;

    // Running powers burn down in rounds, whatever the scale — an hour is
    // simply more rounds than any Duration survives.
    const active = activePowersOf(cur.sheet);
    if (active.length > 0) {
      const longest = Math.max(...active.map((p) => p.rounds));
      if (rounds >= longest) {
        // Everything lapses at once rather than looping a thousand ticks.
        const patch: SheetData = { activePowers: [] };
        for (const p of active) {
          const toggle = toggleFor(p.name);
          if (toggle) patch[toggle] = false;
        }
        cur = persistSheet(io, campaignId, cur, patch);
        notes.push(`${cur.name}: ${active.map((p) => p.name).join(', ')} run out.`);
      } else {
        for (let i = 0; i < rounds; i++) cur = expirePowerDurations(io, campaignId, cur);
      }
    }

    // The turn-scoped states are over the moment anything else happens; out
    // of combat there is no turn to end, so any passage of time ends them.
    const fleeting = conditionsOf(cur.sheet).filter((c) => ['aiming', 'defending', 'distracted', 'vulnerable'].includes(c));
    if (fleeting.length > 0) {
      cur = persistSheet(io, campaignId, cur, {
        conditions: conditionsOf(cur.sheet).filter((c) => !fleeting.includes(c)),
      });
    }

    if (hours > 0) {
      // Power Points come back at five an hour of rest. restRecovery has been
      // sitting in the rules module without a caller since it was written —
      // there was simply no clock to hang it on.
      const regained = restRecovery(cur.sheet, hours);
      if (regained > 0) {
        cur = persistSheet(io, campaignId, cur, { pp: num(cur.sheet, 'pp', 0) + regained });
        notes.push(`${cur.name} recovers ${regained} Power Point${regained === 1 ? '' : 's'}.`);
      }
      // The Golden Hour closing is worth announcing: it is the moment the
      // party's medic stops being able to help and the question becomes who
      // can cast, or who can wait five days.
      const woundedAt = num(cur.sheet, 'woundsAtSec', -1);
      if (woundedAt >= 0 && num(cur.sheet, 'wounds', 0) > 0
        && clockAfter - woundedAt >= 3600 && clockAfter - woundedAt - seconds < 3600) {
        notes.push(`The Golden Hour has closed on ${cur.name}'s wounds — only magic or natural healing now.`);
      }
      // An hour's rest clears ordinary Fatigue. Anything with a source that
      // outlasts an hour — poison still in the blood, a disease — is the GM's
      // to re-apply, which is the same call the book leaves them.
      const fatigue = num(cur.sheet, 'fatigue', 0);
      if (fatigue > 0) {
        cur = persistSheet(io, campaignId, cur, { fatigue: 0 });
        notes.push(`${cur.name} shakes off ${fatigue} level${fatigue === 1 ? '' : 's'} of Fatigue.`);
      }
    }
  }
  // A day or more: natural healing comes due every five days, and anything
  // that regenerates slowly gets its once-a-day roll. Both are DICE, so this
  // only reports who is owed one — the GM is asked before anything is rolled.
  if (seconds >= 86_400) {
    const owed = swadeChars.filter((c) => {
      if (num(c.sheet, 'wounds', 0) <= 0) return false;
      if (str(c.sheet, 'regeneration', '') === 'slow') return true;
      const last = num(c.sheet, 'lastNaturalHealSec', num(c.sheet, 'woundsAtSec', 0));
      return clockAfter - last >= 5 * 86_400;
    });
    if (owed.length > 0) {
      pendingNaturalHealing.set(campaignId, owed.map((c) => c.id));
      io.to(dmRoom(campaignId)).emit(S2C.HEALING_PROMPT, { names: owed.map((c) => c.name) });
      notes.push(`${owed.map((c) => c.name).join(', ')} ${owed.length === 1 ? 'is' : 'are'} due a natural healing roll.`);
    }
  }
  return notes;
}

/**
 * Aftermath: what became of the Extras left lying there.
 *
 * When the fighting stops, every Incapacitated Extra makes a Vigor roll.
 * Success and they pull through — to be patched up, taken prisoner, or
 * released, which is where the interesting problems start. Failure and the
 * fight killed them after all.
 *
 * Wild Cards are not here: they have their own Incapacitation roll and their
 * own Bleeding Out clock, both of which happen during the fight. This is the
 * roll nobody makes at a real table because it is a dozen dice for nameless
 * mooks — which is exactly the kind of bookkeeping a VTT should do for free.
 */
function downedExtras(campaignId: string) {
  return characters.forCampaign(campaignId).filter((c) => c.system === 'swade'
    && c.sheet.wildCard === false
    && conditionsOf(c.sheet).includes('incapacitated')
    && !conditionsOf(c.sheet).includes('dead'));
}

/** Ask the DM whether the fallen get their roll. Nothing happens until they say. */
function offerAftermath(io: Server, campaignId: string): void {
  const downed = downedExtras(campaignId);
  if (downed.length === 0) return;
  io.to(dmRoom(campaignId)).emit(S2C.AFTERMATH_PROMPT, { names: downed.map((c) => c.name) });
}

function aftermathForExtras(io: Server, campaignId: string, shouldRoll: boolean): void {
  const downed = downedExtras(campaignId);
  if (downed.length === 0) return;
  const survivors: string[] = [];
  const lost: string[] = [];
  for (const ch of downed) {
    // Skipped: the wounds finish what they started, no dice.
    const survived = shouldRoll && roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4')))).total >= 4;
    if (survived) {
      survivors.push(ch.name);
    } else {
      lost.push(ch.name);
      persistSheet(io, campaignId, ch, { conditions: [...conditionsOf(ch.sheet), 'dead'] });
    }
  }
  // One card for the lot. A dozen separate roll cards for nameless Extras is
  // the bookkeeping this is meant to spare the table, not perform for them.
  const card: SheetCard = {
    name: '⚔️ Aftermath',
    theme: lost.length > survivors.length ? 'card-bad' : 'card-info',
    chips: [
      { text: `${downed.length} Extra${downed.length === 1 ? '' : 's'} down`, tone: 'qty' },
      ...(survivors.length ? [{ text: `${survivors.length} pulled through`, tone: 'bonus' }] : []),
      ...(lost.length ? [{ text: `${lost.length} died of their wounds`, tone: 'penalty' }] : []),
    ],
    notes: [
      ...(survivors.length ? [`Survived, and need seeing to — or guarding: ${survivors.join(', ')}.`] : []),
      ...(lost.length ? [`Did not: ${lost.join(', ')}.`] : []),
      shouldRoll
        ? 'Each Incapacitated Extra rolled Vigor once the fighting stopped.'
        : 'The DM waved the rolls: none of the fallen were going to get up.',
    ],
  };
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `⚔️ Aftermath — ${survivors.length} of ${downed.length} downed Extras pulled through.`,
    card, roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/**
 * Joker's Wild.
 *
 * A Joker is not just a good card. When a player character draws one, EVERY
 * player character takes a Benny — the table's luck turns together, which is
 * why the rule exists and why it lands better as a moment than as a bonus.
 * When the other side draws one, the GM's pool takes one and every enemy Wild
 * Card takes one, so a villain's Joker is felt the same way from the far side
 * of the screen.
 *
 * The draw itself already grants the +2 and the free placement in the round;
 * this is only the Bennies.
 */
function jokersWild(
  io: Server, campaignId: string, drawerName: string, drawnByPlayerSide: boolean, hidden = false,
): void {
  const all = characters.forCampaign(campaignId).filter((c) => c.system === 'swade');
  // Who the chips go to. Heroes share a Joker between them; the other side
  // pays its Wild Cards and the GM's pool.
  const paid = drawnByPlayerSide
    ? all.filter((c) => c.ownerUserId)
    // Extras hold no Bennies, so there is nobody else on that side to pay.
    : all.filter((c) => !c.ownerUserId && c.sheet.wildCard !== false);
  for (const ch of paid) {
    persistSheet(io, campaignId, ch, { bennies: num(ch.sheet, 'bennies', 0) + 1 });
  }
  const pool = drawnByPlayerSide ? null : campaigns.setGmBennies(campaignId, campaigns.gmBennies(campaignId) + 1);

  // One card, everything a Joker means. It is the best thing that can happen
  // to a combatant in SWADE and it changes four separate things at once — a
  // one-line "Joker!" leaves three of them for somebody to remember.
  const card: SheetCard = {
    name: `🃏 Joker — ${drawerName}`,
    theme: drawnByPlayerSide ? 'card-good' : 'card-bad',
    chips: [
      { text: 'Acts anywhere in the round', tone: 'skill' },
      { text: '+2 to every Trait roll', tone: 'bonus' },
      { text: '+2 to damage', tone: 'damage' },
      ...(paid.length ? [{ text: `+1 Benny × ${paid.length}`, tone: 'bonus' }] : []),
      ...(pool !== null ? [{ text: `GM pool: ${pool}`, tone: 'qty' }] : []),
    ],
    notes: [
      drawnByPlayerSide
        ? `Joker's Wild — every hero takes a Benny${paid.length ? `: ${paid.map((c) => c.name).join(', ')}.` : '.'}`
        : `Joker's Wild for the other side — a Benny to the GM's pool${paid.length ? `, and one to ${paid.map((c) => c.name).join(', ')}.` : '.'}`,
      `${drawerName} may act at any point in the round, interrupting anyone, and carries +2 on every Trait roll and damage roll until the round ends.`,
      'The action deck is reshuffled at the end of this round.',
    ],
  };
  const flat = [...card.chips.map((c) => c.text), ...card.notes].join(' · ');
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `🃏 ${card.name}: ${flat}`,
    card, roll: null, recipients: null,
  });
  // A combatant the party cannot see must not announce itself by name. The
  // Bennies are still paid — the DM reads the card, the players find out when
  // the thing acts out of turn.
  io.to(hidden ? dmRoom(campaignId) : campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/** Whose side is this combatant on? Owned by a player = the heroes' side. */
function isPlayerSideToken(tokenId: string): boolean {
  const tok = tokens.byId(tokenId);
  const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
  return !!ch?.ownerUserId;
}

/**
 * Put a Soak result on the sheet: the Wounds it took back, the Shaken it
 * clears when it soaks the lot, and standing up again if that brought the
 * character under their Wound cap.
 *
 * `alreadyRemoved` is what an earlier roll on this SAME attack already took
 * off, so a Benny reroll applies only the difference — soaking twice for the
 * same two Wounds would heal four.
 */
function applySoakResult(
  io: Server, campaignId: string, ch: Character,
  offerWounds: number, total: number, alreadyRemoved: number, benniesLeft?: number,
): { removed: number; woundsAfter: number } {
  const fresh = characters.byId(ch.id) ?? ch;
  const removed = Math.max(alreadyRemoved, Math.min(offerWounds, soakSuccesses(total)));
  const extra = removed - alreadyRemoved;
  const woundsAfter = Math.max(0, num(fresh.sheet, 'wounds', 0) - extra);
  const patch: Record<string, unknown> = {};
  if (benniesLeft !== undefined) patch.bennies = benniesLeft;
  if (extra > 0) patch.wounds = woundsAfter;
  let conds = conditionsOf(fresh.sheet);
  if (removed === offerWounds && removed > 0) conds = conds.filter((c) => c !== 'shaken');
  // Soaking back under the cap stands you up again — the cap, not a flat 3,
  // or a Huge creature would stay down at 4 Wounds it can actually carry.
  const soakCap = swadeWoundCap({
    wildCard: fresh.sheet.wildCard !== false,
    size: num(fresh.sheet, 'size', 0),
    override: num(fresh.sheet, 'maxWoundsOverride', 0),
    resilient: str(fresh.sheet, 'resilient', ''),
  });
  if (woundsAfter <= soakCap) conds = conds.filter((c) => c !== 'incapacitated' && c !== 'bleeding');
  patch.conditions = conds;
  persistSheet(io, campaignId, fresh, patch);
  return { removed, woundsAfter };
}

/** What each Benny buys, as the subheading the coin reveals. */
const BENNY_REASON: Record<string, string> = {
  'recover-shaken': 'to Recover from Shaken',
  'reroll-trait': 'to reroll a Trait test',
  'reroll-damage': 'to reroll damage',
  'soak': 'to Soak Wounds',
  'redraw-card': 'to draw a new Action Card',
  'regain-pp': 'to regain 5 Power Points',
  'influence': 'to influence the story',
};

/**
 * Flip the coin on every screen. The landing face is chosen here, not per
 * client — everyone is watching the same coin, and two people seeing it land
 * differently would give away that the flip is decoration.
 */
function flipBenny(io: Server, campaignId: string, name: string, reason: string): void {
  io.to(campaignRoom(campaignId)).emit(S2C.BENNY_FLIP, {
    name, reason, face: Math.random() < 0.5 ? 'benny' : 'csb',
  });
}

function activatePower(
  io: Server, campaignId: string, userId: string, username: string, socket: Socket,
  actor: Character, action: CombatAction, undo: UndoEntry[], threadId?: number,
): { actor: Character; raise: boolean } | null {
  const cost = Math.max(0, action.ppCost ?? 0);
  const blocked = castingBlocker(conditionsOf(actor.sheet));
  if (blocked) { emitError(socket, `${actor.name}: ${blocked}`); return null; }

  const pp = num(actor.sheet, 'pp', 0);
  if (pp < Math.min(cost, FAILED_ACTIVATION_PP) || (cost > 0 && pp < FAILED_ACTIVATION_PP)) {
    emitError(socket, `Not enough Power Points (${pp} left).`);
    return null;
  }
  // Shorting is not offered by the UI yet, so a cast always pays in full —
  // but the outcome maths already handles a short cast, so wiring a chooser
  // in later needs nothing here to change.
  const paid = Math.min(pp, cost);
  if (cost > 0 && paid < cost && paid < FAILED_ACTIVATION_PP) {
    emitError(socket, `Not enough Power Points (${pp} left, ${action.label} costs ${cost}).`);
    return null;
  }

  const expr = swadeArcaneExpr(actor.sheet);
  if (!expr) { emitError(socket, `${actor.name} has no arcane skill set.`); return null; }
  const br = roll(expr);
  const out = activationOutcome({
    confirmCritFail: () => roll('1d6').total,
    total: br.total, dice: br.dice, wildCard: actor.sheet.wildCard !== false, cost, paid,
  });

  undo.push({ t: 'field', characterId: actor.id, key: 'pp', value: pp });
  const patch: SheetData = { pp: Math.max(0, pp - out.ppSpent) };
  if (out.backlash) {
    // Backlash takes a level of Fatigue AND drops every power already running,
    // so both of those have to be recoverable too.
    undo.push(
      { t: 'field', characterId: actor.id, key: 'fatigue', value: num(actor.sheet, 'fatigue', 0) },
      { t: 'field', characterId: actor.id, key: 'activePowers', value: rows(actor.sheet, 'activePowers') },
    );
    Object.assign(patch, backlashPatch(actor.sheet));
  }
  const updated = persistSheet(io, campaignId, actor, patch);

  const msg = chat.add(campaignId, {
    userId, fromName: username,
    fromCharacter: actor.name, characterId: actor.id,
    kind: 'roll',
    text: `${actor.name} — ${action.label}: ${out.activated ? (out.verdict === 'raise' ? 'Activated with a raise' : 'Activated') : out.verdict === 'backlash' ? 'BACKLASH' : 'Failed to activate'} (TN ${ACTIVATION_TN})`,
    outcomeNote: `${out.summary} ${out.ppSpent} PP spent.`,
    roll: { ...br, outcome: out.activated ? 'success' as const : 'failure' as const },
    recipients: null,
    threadId,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });

  if (out.backlash) {
    postStatusLine(io, campaignId, `${actor.name} suffers Backlash — a level of Fatigue, and every power they had running ends.`, threadId);
  }
  return out.activated ? { actor: updated, raise: out.verdict === 'raise' } : null;
}

function postCastCard(
  io: Server, campaignId: string, userId: string, username: string,
  actor: Character, action: CombatAction, label: string, ppSpent: number,
): number {
  const chips: { text: string; tone: string }[] = [];
  if (action.aoe) {
    const size = action.aoe.sizeHexes ? `${action.aoe.sizeHexes} tiles` : `${action.aoe.sizeFt} ft`;
    chips.push({ text: `${action.aoe.shape} ${size}`, tone: 'range' });
  }
  if (usableAmount(action.amountExpr)) chips.push({ text: action.amountExpr, tone: 'damage' });
  if (action.damageType) chips.push({ text: action.damageType, tone: 'plain' });
  if (action.rangeFt > 0) chips.push({ text: `Range ${action.rangeFt} ft`, tone: 'range' });
  if (ppSpent > 0) chips.push({ text: `${ppSpent} PP`, tone: 'use' });
  if (action.saveId) chips.push({ text: `resisted by ${action.saveId}`, tone: 'skill' });
  if (action.appliesCondition) chips.push({ text: getCondition(action.appliesCondition)?.label ?? action.appliesCondition, tone: 'severity' });

  const card = sanitizeCard({ name: label, chips, notes: [] });
  const msg = chat.add(campaignId, {
    userId, fromName: username,
    fromCharacter: actor.name, characterId: actor.id,
    kind: 'say',
    text: `${actor.name} is using power: ${label}`,
    outcomeNote: `${actor.name} is using power:`,
    card,
    roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  return msg.id;
}

function runGroupSave(io: Server, spec: GroupSaveSpec): boolean {
  const targets: { tok: Token; ch: Character | undefined; sc: { expr: string; threshold: number; label: string } }[] = [];
  let touchedMap: string | null = null;
  for (const tid of spec.tokenIds) {
    const tok = tokens.byId(tid);
    if (!tok) continue;
    touchedMap = tok.mapId;
    const ch = tok.characterId ? characters.byId(tok.characterId) : undefined;
    const sc = ch ? systemFor(ch.system).saveCheck(ch.sheet, spec.saveId, spec.dc) : { expr: '1d20', threshold: spec.dc, label: spec.saveId };
    // Evasion is a desperate dive: the Agility roll takes −2.
    if (spec.evasion && ch) sc.expr = `${sc.expr}-2`;
    targets.push({ tok, ch, sc });
  }
  if (targets.length === 0) return false;

  const hasDamage = !!spec.damageExpr && usableAmount(spec.damageExpr);
  const results: { tok: Token; ch: Character | undefined; passed: boolean }[] = [];

  /**
   * The Group Roll: one Trait die and a Wild Die stand for a whole mob of
   * like Extras, and that one result is every one of their results.
   *
   * The Wild Die is the point. A group of Extras rolling together is treated
   * as a single competent actor rather than eight separate chances to fumble
   * — which is both faster and kinder to them, and is why the book offers it.
   * So the expression is forced into `best(trait, 1d6!)` even though not one
   * of them would roll a Wild Die alone.
   */
  const groupExpr = (expr: string): string =>
    expr.startsWith('best(') ? expr : expr.replace(/^1d(\d+)!/, 'best(1d$1!, 1d6!)');

  // Inflict the spec's condition on every character target that failed its
  // save (skipped for bare tokens: no sheet to carry a condition). Runs at
  // damage-apply time for damaging saves, or after the final save card for
  // condition-only ones.
  const applyConditions = (): void => {
    if (!spec.appliesCondition) return;
    for (const { ch, passed } of results) {
      if (passed || !ch) continue;
      const fresh = characters.byId(ch.id);
      if (!fresh) continue;
      if (spec.leadMessageId) {
        chat.appendUndo(spec.leadMessageId, [
          { t: 'field', characterId: fresh.id, key: 'conditions', value: conditionsOf(fresh.sheet) },
        ]);
      }
      applyConditionTo(
        io, spec.campaignId, fresh, spec.appliesCondition, spec.label ?? 'a spell',
        spec.concentrationCasterId ? characters.byId(spec.concentrationCasterId) : undefined,
      );
    }
  };

  const finish = (): void => {
    if (touchedMap) syncMapVision(io, spec.campaignId, touchedMap);
    const header = `${spec.label?.trim() || 'Saving throw'} — ${targets[0].sc.label}${spec.damageExpr ? ` DC ${spec.dc}` : ''}`;
    io.to(campaignRoom(spec.campaignId)).emit(S2C.TABLE_RESULT, { text: header, color: '#c98a3c' });
  };

  const postDamage = (): void => {
    const dmg = roll(spec.damageExpr!);
    const base = Math.max(0, dmg.total);
    const undo: UndoEntry[] = [];
    /** Sheet values as they stand before anything lands (see below). */
    const preState: UndoEntry[] = [];
    // Figure out who takes what now (for undo + the card), but hold off on
    // actually touching anyone's HP until this roll's own dice have settled.
    const applications: Array<() => void> = [];
    for (const { tok, ch, passed } of results) {
      let amt = passed ? (spec.onSave === 'half' ? Math.floor(base / 2) : 0) : base;
      // The covering body soaks its own Toughness out of the blast before
      // anyone else's resistances get a say.
      if (spec.cover) {
        amt = coverAdjustedDamage(amt, {
          isCoverer: tok.id === spec.cover.tokenId,
          coverToughness: spec.cover.toughness,
        });
      }
      if (ch && spec.damageType) amt = applyDamageDefenses(ch.system, ch.sheet, spec.damageType, amt).amount;
      if (amt <= 0) continue;
      if (!ch && !tok.bar) continue;
      undo.push(ch ? { t: 'hp', characterId: ch.id, delta: -amt } : { t: 'hp', tokenId: tok.id, delta: -amt });
      // Wounds and conditions live on the sheet, so the ONLY way back is the
      // value they held before this landed. Captured now, while it is still
      // true — by apply time the damage has already rewritten it.
      if (ch) preState.push(
        { t: 'field', characterId: ch.id, key: 'wounds', value: num(ch.sheet, 'wounds', 0) },
        { t: 'field', characterId: ch.id, key: 'conditions', value: conditionsOf(ch.sheet) },
      );
      applications.push(() => {
        if (ch) {
          const fresh = characters.byId(ch.id);
          if (fresh) {
            // The note carries the arithmetic — "10 vs Toughness 6 — Shaken".
            // A single-target hit shows it on its own card; an area attack has
            // no per-target card to put it on, so it goes out as its own line.
            // Without this the log jumps from one damage roll straight to
            // "X is Incapacitated" with nothing saying why.
            const { note } = applyHpDelta(io, spec.campaignId, fresh, -amt, spec.label ?? 'a saving throw', spec.attackerName, spec.damageType);
            const said = note.replace(/^\s*—\s*/, '').trim();
            if (said) postStatusLine(io, spec.campaignId, `${fresh.name}: ${said}`, spec.leadMessageId);
          }
        } else {
          const live = tokens.byId(tok.id);
          if (live?.bar) {
            const nh = Math.max(0, live.bar.hp - amt);
            tokens.update(tok.id, { bar: { hp: nh, maxHp: live.bar.maxHp } });
            io.to(dmRoom(spec.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
          }
        }
        floatHp(io, spec.campaignId, tok.mapId, tok.id, -amt, 'aoe', spec.damageType);
      });
    }
    // With a lead card the effects belong to IT, not to the damage roll:
    // undoing half a power is worse than not being able to undo it at all.
    const all = [...preState, ...undo];
    if (spec.leadMessageId && all.length > 0) chat.appendUndo(spec.leadMessageId, all);
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${spec.label?.trim() || 'Saving throw'} — damage`, roll: dmg, recipients: null,
      threadId: spec.leadMessageId,
    }, !spec.leadMessageId && undo.length > 0 ? undo : undefined);
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });
    const settleMs = diceSettleDelayMs(dmg.dice);
    setTimeout(() => {
      for (const apply of applications) apply();
      applyConditions();
      finish();
    }, settleMs);
    if (spec.aoeVisual) {
      const v = spec.aoeVisual;
      const flightMs = v.shape === 'sphere' || v.shape === 'cylinder' ? PROJECTILE_FLIGHT_MS : 0;
      setTimeout(() => emitAoeBurst(io, spec.campaignId, v.mapId, v.shape, v.sizeFt, v.sizeHexes, v.widthFt, v.originHex, v.aimHex, spec.damageType),
        Math.max(0, settleMs - flightMs));
    }
  };

  /**
   * One roll for the whole mob, posted as one card. Everything downstream —
   * damage, conditions, the undo trail — runs exactly as it does for
   * individual saves; only the number of dice changed.
   */
  const postGroupSave = (): void => {
    const { sc } = targets[0];
    const expr = groupExpr(sc.expr);
    const br = roll(expr);
    const passed = br.total >= sc.threshold;
    for (const { tok, ch } of targets) results.push({ tok, ch, passed });
    const who = `${targets.length} × ${targets[0].tok.name}`;
    io.to(campaignRoom(spec.campaignId)).emit(S2C.ROLL_CALLOUT, {
      name: who,
      what: spec.evasion ? 'roll as a group to evade!' : `roll ${sc.label} as a group!`,
      holdMs: CALLOUT_HOLD_MS,
    });
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${who} — group ${sc.label}: ${passed ? 'Success' : 'Failure'} (DC ${sc.threshold})`
        + ' — one roll, with a Wild Die, stands for all of them',
      callout: { what: `${sc.label} — group roll`, tone: 'save' },
      characterId: targets[0].ch?.id ?? null,
      roll: { ...br, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
      threadId: spec.leadMessageId,
    });
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });
    if (hasDamage) setTimeout(postDamage, SAVE_STEP_DELAY_MS);
    else setTimeout(() => { applyConditions(); finish(); }, diceSettleDelayMs(1));
  };

  const postSave = (i: number): void => {
    const { tok, ch, sc } = targets[i];
    // Whoever threw themselves on the grenade rolls nothing: they are not
    // trying to get clear of the blast, they are holding it down. Counted as
    // a failure so the full (then doubled) damage lands on them.
    if (spec.cover && tok.id === spec.cover.tokenId) {
      results.push({ tok, ch, passed: false });
      const msg = chat.add(spec.campaignId, {
        userId: spec.userId, fromName: spec.username, kind: 'system',
        text: `🛡️ ${tok.name} throws themselves onto ${spec.label?.trim() || 'the blast'} — no dive, double damage, and Toughness ${spec.cover.toughness} comes off everyone else's.`,
        characterId: ch?.id ?? null,
        roll: null, recipients: null,
      });
      io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });
      if (i + 1 < targets.length) setTimeout(() => postSave(i + 1), SAVE_STEP_DELAY_MS);
      else if (hasDamage) setTimeout(postDamage, SAVE_STEP_DELAY_MS);
      else setTimeout(() => { applyConditions(); finish(); }, diceSettleDelayMs(1));
      return;
    }
    const br = roll(sc.expr);
    const passed = br.total >= sc.threshold;
    results.push({ tok, ch, passed });
    // Say whose roll this is on everyone's screen. A group save posts one card
    // at a time with a long beat between them; without this the table watches
    // results appear with no idea who is up or what they are rolling for.
    io.to(campaignRoom(spec.campaignId)).emit(S2C.ROLL_CALLOUT, {
      name: tok.name,
      what: spec.evasion ? 'is rolling to evade!' : `is rolling ${sc.label}!`,
      holdMs: CALLOUT_HOLD_MS,
    });
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${tok.name} — ${sc.label}: ${passed ? 'Success' : 'Failure'} (DC ${sc.threshold})`,
      callout: { what: spec.evasion ? `${sc.label} — Evasion` : `${sc.label} — ${spec.label?.trim() || 'save'}`, tone: 'save' },
      // The save is the TARGET's roll — their stats, not the caster's.
      characterId: ch?.id ?? null, statsUserId: ch?.ownerUserId ?? null,
      roll: { ...br, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
      threadId: spec.leadMessageId,
    });
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });

    if (i + 1 < targets.length) setTimeout(() => postSave(i + 1), SAVE_STEP_DELAY_MS);
    else if (hasDamage) setTimeout(postDamage, SAVE_STEP_DELAY_MS);
    else {
      // Condition-only save (no damage roll follows): let the last save's
      // die settle, then inflict conditions on the failures and wrap up.
      setTimeout(() => {
        applyConditions();
        finish();
      }, diceSettleDelayMs(1));
    }
  };

  // A group roll needs at least two of them to be a group; one Extra alone
  // just rolls, and the covering-body case is a per-target story.
  if (spec.group && targets.length > 1 && !spec.cover) postGroupSave();
  else postSave(0);
  return true;
}

// ---------- Fear checks and the Fear Table ----------

interface GroupFearSpec extends RequestFearPayload {
  campaignId: string;
  userId: string;
  username: string;
}

/**
 * DM "call for a Fear check": every listed token makes a Spirit roll at the
 * creature's Fear penalty, one at a time, each posting its own chat card and
 * waiting for the dice to settle before the next. A failure costs whatever
 * the source calls for, and the ones the book sends to the Fear Table roll a
 * d20 there — a second card, with the row's own text and its conditions
 * applied.
 *
 * Two rows are deliberately left for the table to finish: the Adrenaline
 * Surge's Joker (initiative is already dealt) and the Heart Attack's Vigor
 * roll, which branches into dying in 2d6 rounds. Both post what the book says
 * and leave the call to the DM rather than guessing.
 */
function runGroupFear(io: Server, spec: GroupFearSpec): boolean {
  const targets: { tok: Token; ch: Character }[] = [];
  for (const tid of spec.tokenIds) {
    const tok = tokens.byId(tid);
    const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
    // Fear lands on a mind. A bare token has no Spirit to roll and no sheet to
    // carry what a failure does, so it is skipped rather than faked.
    if (tok && ch && ch.system === 'swade') targets.push({ tok, ch });
  }
  if (targets.length === 0) return false;

  const what = spec.label?.trim() || 'Fear';
  const post = (
    text: string, br: ReturnType<typeof roll> | null, ch: Character,
    outcome?: 'success' | 'failure', callout?: RollCalloutInfo,
  ) => {
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: br ? 'roll' : 'system', text,
      characterId: ch.id, statsUserId: ch.ownerUserId ?? null,
      roll: br ? { ...br, ...(outcome ? { outcome } : {}) } : null, recipients: null,
      ...(callout ? { callout } : {}),
    });
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });
  };

  /** Roll the d20, post the row, and apply what it carries. */
  const rollTable = (ch: Character, criticalFailure: boolean, then: () => void): void => {
    const d20 = roll('1d20');
    const total = fearTableTotal(d20.total, spec.fearPenalty, spec.source, criticalFailure);
    let row = fearTableRow(total);
    const fresh0 = characters.byId(ch.id) ?? ch;
    // "If he already has it, he's Panicked instead."
    if (row.id === 'frightened' && hasHindrance(fresh0.sheet, 'Hesitant')) row = PANICKED_OUTCOME;

    const bonus = total - d20.total;
    const bonusText = bonus > 0 ? ` (${d20.total} +${bonus})` : '';
    post(`${ch.name} — Fear Table ${total}${bonusText}: ${row.label}`, d20, ch);

    setTimeout(() => {
      const fresh = characters.byId(ch.id);
      if (fresh) {
        for (const c of row.conditions ?? []) applyConditionTo(io, spec.campaignId, fresh, c, what);
        if (row.hindrance) addFearHindrance(io, spec.campaignId, row.hindrance, row.id);
      }
      postStatusLine(io, spec.campaignId, `${ch.name}: ${row.label} — ${row.effect}`);
      then();
    }, diceSettleDelayMs(1));
  };

  const step = (i: number): void => {
    if (i >= targets.length) return;
    const next = () => { if (i + 1 < targets.length) setTimeout(() => step(i + 1), SAVE_STEP_DELAY_MS); };
    const { ch } = targets[i]!;
    // Fearless creatures do not roll. Skipping the roll rather than rolling
    // and discarding it matters at the table: the mindless thing walking into
    // the horror is supposed to be conspicuous, and a chat line saying so is
    // how the players learn what they are dealing with.
    if (ch.sheet.fearless === true) {
      postStatusLine(io, spec.campaignId, `${ch.name} is Fearless — no ${what} check.`);
      next();
      return;
    }
    const wildCard = ch.sheet.wildCard !== false;
    // Spirit is an attribute, not a skill — same roll the Shaken recovery makes.
    const expr = traitExpr(ch.sheet, dieSides(String(ch.sheet.spirit ?? 'd4')), fearCheckMod(spec.fearPenalty));
    const br = roll(expr);
    const passed = br.total >= 4;
    const critFail = critFailFor(io, spec.campaignId, ch, br.dice);

    post(
      `${ch.name} — ${what} check (Spirit${fmtMod(fearCheckMod(spec.fearPenalty))}): ${passed ? 'Success' : critFail ? 'Critical Failure' : 'Failure'}`,
      br, ch, passed ? 'success' : 'failure', { what: `${what} check — Spirit`, tone: 'fear' },
    );

    if (passed) { next(); return; }

    const fail = fearCheckFailure(spec.source, critFail, wildCard);
    setTimeout(() => {
      const fresh = characters.byId(ch.id);
      if (fresh) {
        for (const c of fail.conditions) applyConditionTo(io, spec.campaignId, fresh, c, what);
        if (fail.fatigue > 0) {
          const live = characters.byId(ch.id)!;
          persistSheet(io, spec.campaignId, live, { fatigue: Math.min(2, num(live.sheet, 'fatigue', 0) + fail.fatigue) });
        }
      }
      postStatusLine(io, spec.campaignId, `${ch.name} fails the ${what} check — ${fail.summary}`);
      if (fail.rollsTable) rollTable(ch, critFail, next);
      else next();
    }, diceSettleDelayMs(1));
  };

  step(0);
  return true;
}

/** Does the sheet already carry this Hindrance? */
function hasHindrance(sheet: SheetData, name: string): boolean {
  return rows(sheet, 'hindrances').some((r) => str(r, 'name', '').trim().toLowerCase() === name.toLowerCase());
}

/**
 * The Fear Table's Hindrances are handed to the DM as a chat line rather than
 * written onto the sheet. Frightened's Hesitant lasts only "the remainder of
 * the encounter", and a Phobia has to be *about* something — neither is the
 * engine's to decide.
 */
function addFearHindrance(io: Server, campaignId: string, hindrance: string, rowId: string): void {
  const why = rowId === 'frightened'
    ? 'for the remainder of the encounter'
    : 'permanently — name the trauma it attaches to';
  postStatusLine(io, campaignId, `DM: add the ${hindrance} Hindrance ${why}.`);
}

// ---------- Grenades: the parked blast ----------

/**
 * What the people standing in a blast managed to change about it before it
 * went off. An empty object is "nobody did anything" — the blast resolves
 * exactly as it would have without the offer.
 */
interface BlastMod {
  /** Hot Potato: thrown back, so the template re-centres here. */
  aimHex?: Hex;
  /** A fumbled catch adds the raise die, as a hand detonation does. */
  damageExpr?: string;
  /** Covering: who smothered it, and the Toughness they soak up. */
  cover?: { tokenId: string; name: string; toughness: number };
}

interface PendingBlast {
  id: string;
  campaignId: string;
  label: string;
  throwerName: string;
  /** Where a successful throw-back sends it: back at the thrower. */
  throwerHex: Hex;
  /** The blast's damage as it stands, so a fumbled catch can add the raise die. */
  damageExpr: string;
  /** Everyone still entitled to answer, by token id. */
  candidates: Map<string, BlastCandidate>;
  /** Shut the moment anyone acts — the grenade is one physical object, so
   *  the first person to grab it or lie on it settles it for everybody. */
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  resume: (mod: BlastMod) => void;
}

/**
 * How long the blast hangs there waiting for an answer. Long enough for a
 * player to read the prompt and decide, short enough that a table doesn't
 * stall on somebody who wandered off — the fuse runs out and it just goes off.
 */
const BLAST_GRACE_MS = 15_000;

const pendingBlasts = new Map<string, PendingBlast>();

/**
 * Close the window and hand back whether THIS caller is the one who gets to
 * resolve it. Everyone who loses the race gets false and must do nothing:
 * the alternative is two people resolving the same grenade, which would
 * apply the damage twice.
 */
function claimBlast(io: Server, pb: PendingBlast): boolean {
  if (pb.settled) return false;
  pb.settled = true;
  clearTimeout(pb.timer);
  pendingBlasts.delete(pb.id);
  io.to(campaignRoom(pb.campaignId)).emit(S2C.BLAST_OFFER_CLOSED, { blastId: pb.id });
  return true;
}

interface BlastOfferSpec {
  io: Server;
  campaignId: string;
  label: string;
  /** Who threw it — named in the prompt, and where a throw-back lands. */
  throwerName: string;
  throwerHex: Hex;
  aoe: NonNullable<ReturnType<typeof combatActions>[number]['aoe']>;
  originHex: Hex;
  aimHex: Hex;
  map: MapDef;
  srcPx: ReturnType<typeof hexToPixel>;
  sightSegs: ReturnType<typeof sightSegments>;
  damageExpr: string;
  resume: (mod: BlastMod) => void;
}

/**
 * Offer Hot Potato / Covering to everyone caught in a freshly landed grenade.
 * Returns false — having done nothing at all — when there is nobody in the
 * blast who can answer (bare tokens with no sheet, an empty template), so the
 * caller resolves immediately instead of stalling on a prompt nobody can see.
 */
function offerBlastChoice(spec: BlastOfferSpec): boolean {
  const { io, campaignId, map } = spec;
  const caught = tokensInAoe(spec.aoe, spec.originHex, spec.aimHex, map.grid, tokens.forMap(map.id))
    .filter((tid) => {
      const t = tokens.byId(tid);
      return !!t && !rayBlocked(spec.srcPx, hexToPixel({ q: t.q, r: t.r }, map.grid), spec.sightSegs);
    });

  const state = initiative.get(campaignId);
  const candidates = new Map<string, BlastCandidate>();
  // Who gets asked, grouped by the person who answers: a player for their own
  // character, the DM for everyone else's.
  const byResponder = new Map<string | null, BlastCandidate[]>();
  for (const tid of caught) {
    const tok = tokens.byId(tid);
    if (!tok?.characterId) continue;
    const ch = characters.byId(tok.characterId);
    if (!ch || ch.campaignId !== campaignId) continue;
    // Someone already down is in no position to catch anything or choose to
    // land on it — they are simply in the blast.
    if (conditionsOf(ch.sheet).includes('incapacitated')) continue;
    const onHold = state.entries.some((e) => e.tokenId === tok.id && e.held === true);
    const cand: BlastCandidate = {
      characterId: ch.id, tokenId: tok.id, name: tok.name,
      potatoMod: hotPotatoPenalty(onHold), onHold,
    };
    candidates.set(tok.id, cand);
    const responder = ch.ownerUserId ?? null;
    const list = byResponder.get(responder);
    if (list) list.push(cand);
    else byResponder.set(responder, [cand]);
  }
  if (candidates.size === 0) return false;

  const blastId = newId();
  const canCover = usableAmount(spec.damageExpr);
  const pb: PendingBlast = {
    id: blastId, campaignId, label: spec.label,
    throwerName: spec.throwerName, throwerHex: spec.throwerHex, damageExpr: spec.damageExpr,
    candidates, settled: false, resume: spec.resume,
    timer: setTimeout(() => {
      const live = pendingBlasts.get(blastId);
      // The fuse ran out — nobody moved, and it goes off where it landed.
      if (live && claimBlast(io, live)) live.resume({});
    }, BLAST_GRACE_MS),
  };
  pendingBlasts.set(blastId, pb);

  for (const [responder, list] of byResponder) {
    const payload = {
      blastId, label: spec.label, throwerName: spec.throwerName, graceMs: BLAST_GRACE_MS,
      canCover, candidates: list,
    };
    if (responder) io.to(userRoom(responder)).emit(S2C.BLAST_OFFER, payload);
    else io.to(dmRoom(campaignId)).emit(S2C.BLAST_OFFER, payload);
  }
  return true;
}

/**
 * Commit Effort to activate a psychic power and roll its discipline's 2d6
 * activation check: snake-eyes is a mishap (system strain, backlash damage,
 * or drawing unwanted attention), posted as its own chat line. Effort is
 * spent either way. Shared by targeted power actions (COMBAT_ACTION) and
 * untargeted/utility powers (USE_POWER). Returns null (after emitting the
 * error) if there isn't enough Effort left.
 */
function activatePsychicPower(
  io: Server, campaignId: string, d: { userId: string; username: string },
  socket: Socket, actor: Character, cost: number, disciplineId: string, label: string,
): { actor: Character; undo: UndoEntry } | null {
  const effortMax = Number(systemFor(actor.system).derive(actor.sheet).effortMax) || 0;
  const committed = num(actor.sheet, 'effortCommitted', 0);
  if (committed + cost > effortMax) {
    emitError(socket, `Not enough Effort (${Math.max(0, effortMax - committed)} available, need ${cost}).`);
    return null;
  }
  const actorPatch: SheetData = { effortCommitted: committed + cost };
  const undo: UndoEntry = { t: 'field', characterId: actor.id, key: 'effortCommitted', value: committed };

  const disciplineSkill = rows(actor.sheet, 'skills').find((sk) => str(sk, 'name', '') === disciplineId);
  const skillLvl = disciplineSkill ? num(disciplineSkill, 'level', 0) : 0;
  const skillAttr = disciplineSkill ? str(disciplineSkill, 'attr', 'int') : 'int';
  const checkMod = skillLvl + swnMod(num(actor.sheet, skillAttr, 10));
  const checkRoll = roll(`2d6${fmtMod(checkMod)}`);
  const d6s = checkRoll.dice.filter((x) => x.sides === 6).map((x) => x.value);
  if (isPsychicMishap(d6s)) {
    const mishap = rollMishap();
    if (mishap.systemStrain) actorPatch.systemStrain = num(actor.sheet, 'systemStrain', 0) + mishap.systemStrain;
    const updated = persistSheet(io, campaignId, actor, actorPatch);
    const mishapMsg = chat.add(campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `⚡ Mishap! ${updated.name}'s ${label} check (${checkRoll.total}) snake-eyes — ${mishap.text}.${mishap.torched ? ' 🔥 Torched.' : ''}`,
      roll: checkRoll, recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg: mishapMsg });
    if (mishap.selfDamage) {
      // The backlash damage is its own roll (1d6, distinct from the 2d6
      // activation check above) -- gets its own card, posted only once the
      // activation check's own dice have had time to settle, same pacing as
      // any other roll-then-roll sequence.
      setTimeout(() => {
        const fresh = characters.byId(updated.id);
        if (!fresh) return;
        const dmgRoll = roll(mishap.selfDamage);
        const dmg = Math.max(0, dmgRoll.total);
        const { character: afterChar, note } = applyHpDelta(io, campaignId, fresh, -dmg, `${label} mishap`);
        const { hp, maxHp } = systemFor(afterChar.system).hp(afterChar.sheet);
        const dmgMsg = chat.add(campaignId, {
          userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll',
          text: `${afterChar.name} takes ${dmg} backlash damage (${afterChar.name} ${hp}/${maxHp})${note}`.replace(/\s+/g, ' ').trim(),
          roll: dmgRoll, recipients: null,
        });
        io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg: dmgMsg });
        for (const t of tokens.forCharacter(afterChar.id)) floatHp(io, campaignId, t.mapId, t.id, -dmg);
      }, diceSettleDelayMs(checkRoll.dice));
    }
    return { actor: updated, undo };
  }
  return { actor: persistSheet(io, campaignId, actor, actorPatch), undo };
}

// ---------- chases ----------

/**
 * The machine a token is aboard: what it is mounted on, or itself when the
 * token IS the machine. Everything a chase asks about a participant — the
 * skill they manoeuvre with, the Handling under them, what a ram costs them —
 * comes off this one answer.
 */
function vehicleUnder(tok: Token | null | undefined): Character | null {
  if (!tok) return null;
  const mount = tok.mountedOn ? tokens.byId(tok.mountedOn) : null;
  const mountCh = mount?.characterId ? characters.byId(mount.characterId) : undefined;
  if (mountCh && isVehicle(mountCh.sheet)) return mountCh;
  const own = tok.characterId ? characters.byId(tok.characterId) : undefined;
  return own && isVehicle(own.sheet) ? own : null;
}

/**
 * Whoever has the wheel of a vehicle token: the rider the DM named, or the
 * first one aboard when nobody has been named. SOMETHING has to answer for
 * the vehicle's Parry and its control rolls, and "the first one on" is both
 * stable and usually right — the driver gets in first. A named driver who has
 * since fallen off is ignored rather than obeyed.
 */
function driverOf(vehicleTokenId: string, mapId: string): Character | null {
  const vehicle = tokens.byId(vehicleTokenId);
  const riders = tokens.forMap(mapId).filter((t) => t.mountedOn === vehicleTokenId);
  const named = vehicle?.driverTokenId ? riders.find((t) => t.id === vehicle.driverTokenId) : undefined;
  const rider = named ?? riders[0];
  const ch = rider?.characterId ? characters.byId(rider.characterId) : undefined;
  return ch ?? null;
}

/**
 * A vehicle's Parry: 2 + half its driver's maneuvering die. Empty, it is 2 —
 * a parked car is a barn door, which is exactly right.
 */
function vehicleParryOf(vehicleTok: Token, vehicleChar: Character): number {
  const driver = driverOf(vehicleTok.id, vehicleTok.mapId);
  const skill = maneuveringSkillFor(vehicleChar.sheet);
  return vehicleParry(driver ? skillDie(driver.sheet, skill) : 0);
}

/**
 * Everything that rides a maneuvering roll no matter what it is for: the
 * Handling of the machine under them, and the Speed Bonus for having the
 * better one. Change Position, Force, Ram, Hold Steady and Flee all roll the
 * same skill against the same conditions, so they all come through here.
 */
function maneuverMods(
  chase: ChaseState, me: ChaseParticipant, ch: Character | undefined,
): { mod: number; tags: string[] } {
  const tags: string[] = [];
  let mod = 0;
  const tok = me.tokenId ? tokens.byId(me.tokenId) : null;
  const vehicle = vehicleUnder(tok) ?? (ch && isVehicle(ch.sheet) ? ch : null);
  if (vehicle) {
    const h = vehicleHandling(vehicle.sheet);
    if (h !== 0) { mod += h; tags.push(`${h > 0 ? '+' : ''}${h} Handling`); }
  }
  const bonus = speedBonus(me.topSpeed, chase.participants.filter((p) => p !== me).map((p) => p.topSpeed));
  if (bonus > 0) { mod += bonus; tags.push(`+${bonus} Speed`); }
  return { mod, tags };
}

/** How a participant is travelling, which decides what a disaster looks like. */
function travelOf(p: ChaseParticipant): ChaseTravel {
  const tok = p.tokenId ? tokens.byId(p.tokenId) : null;
  if (vehicleUnder(tok)) return 'vehicle';
  return tok?.mountedOn ? 'mounted' : 'foot';
}

/**
 * A Bump: knocked back cards, and out of the chase entirely if that carries
 * them off the back of the track. The chase does not wait for anybody.
 */
function bumpParticipant(
  io: Server, campaignId: string, chase: ChaseState, p: ChaseParticipant, cards: number, why: string,
): void {
  if (cards <= 0) return;
  const out = bumpResult(p.cardIdx, cards);
  p.cardIdx = out.cardIdx;
  if (out.leftBehind) {
    chase.participants = chase.participants.filter((x) => x !== p);
    postStatusLine(io, campaignId, `🏁 ${p.name} is bumped off the back of the track — ${why}, and the chase leaves them behind.`);
    return;
  }
  postStatusLine(io, campaignId,
    `${p.name} is bumped back ${cards} Chase Card${cards === 1 ? '' : 's'} — ${why}.`);
}

/**
 * A Critical Failure while manoeuvring, routed by what they are travelling in:
 * a vehicle goes Out of Control, a rider fights to stay on, and someone on
 * their own two feet goes down. All three lose ground.
 */
function runChaseCritFailure(
  io: Server, campaignId: string, chase: ChaseState, p: ChaseParticipant, ch: Character | undefined,
): void {
  const travel = travelOf(p);
  const out = chaseCritFailure(travel);
  postStatusLine(io, campaignId, `💀 Critical Failure — ${p.name}: ${out.label}.`);
  bumpParticipant(io, campaignId, chase, p, out.bumpCards, 'a Critical Failure');
  const tok = p.tokenId ? tokens.byId(p.tokenId) : null;
  if (out.outOfControl) {
    const vehicle = vehicleUnder(tok);
    if (vehicle) resolveOutOfControl(io, campaignId, vehicle);
    return;
  }
  if (out.ridingCheck && ch) {
    const br = roll(traitExpr(ch.sheet, skillDie(ch.sheet, 'Riding')));
    const stayed = br.total >= 4;
    postStatusLine(io, campaignId, `${p.name} grabs for the reins — Riding ${br.total} vs 4: ${stayed ? 'stays on.' : 'is thrown!'}`);
    if (!stayed && tok) {
      const mount = tok.mountedOn ? tokens.byId(tok.mountedOn) : null;
      tokens.update(tok.id, { mountedOn: null });
      if (mount?.driverTokenId === tok.id) tokens.update(mount.id, { driverTokenId: null });
      const off = tokens.byId(tok.id)!;
      io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: off });
      applyConditionTo(io, campaignId, characters.byId(ch.id) ?? ch, 'prone', 'thrown from the saddle');
      chase.participants = chase.participants.filter((x) => x !== p);
      postStatusLine(io, campaignId, `${p.name} is out of the chase, on the ground and watching it go.`);
    }
    return;
  }
  if (out.prone && ch) applyConditionTo(io, campaignId, characters.byId(ch.id) ?? ch, 'prone', 'went down at a run');
}

/**
 * A Club in the Action Card hand is a Complication: something has gone wrong
 * — an obstacle, a stall, mud — and how bad it is comes off the CHASE card
 * they happen to be standing on. Flagged as the cards are dealt so the table
 * can see it coming, and rolled for when their turn arrives.
 */
function flagChaseComplications(io: Server, campaignId: string, state: InitiativeState): void {
  const chase = state.chase;
  if (!chase) return;
  for (const p of chase.participants) {
    const entry = state.entries.find((e) => e.id === p.entryId);
    if (!isComplicationCard(entry?.card)) { delete p.complication; continue; }
    const standing = chase.track[p.cardIdx];
    if (!standing) { delete p.complication; continue; }
    p.complication = complicationFor(standing);
    if (!entry?.hidden) {
      postStatusLine(io, campaignId, `♣️ ${p.name} draws a Complication — ${p.complication.label}.`);
    }
  }
}

/**
 * The Complication itself, rolled at the start of the turn it is hanging over.
 * A maneuvering roll at whatever the chase card underneath them is worth:
 * make it and it was nothing, miss it and you lose ground — and on the two
 * black suits, missing it is a Critical Failure outright.
 */
function resolveChaseComplication(io: Server, campaignId: string, state: InitiativeState): void {
  const chase = state.chase;
  if (!chase) return;
  const entry = state.entries[state.turnIdx];
  const p = entry ? chase.participants.find((x) => x.entryId === entry.id) : undefined;
  const comp = p?.complication;
  if (!p || !comp) return;
  delete p.complication;
  const tok = p.tokenId ? tokens.byId(p.tokenId) : null;
  const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
  const sheet = ch?.sheet ?? {};
  const mods = maneuverMods(chase, p, ch);
  const br = roll(traitExpr(sheet, skillDie(sheet, p.maneuverSkill), mods.mod + comp.mod));
  const ok = br.total >= 4;
  const tags = [...mods.tags, comp.label];
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: ch?.name ?? p.name, characterId: ch?.id ?? null,
    kind: 'roll',
    text: `♣️ ${p.name} — ${p.maneuverSkill} against a Complication [${tags.join(', ')}]: `
      + (ok ? 'drives through it.' : 'caught by it.'),
    roll: { ...br, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
    callout: { what: `${p.maneuverSkill} — Complication`, tone: 'trait' },
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  if (ok) return;
  // The consequence waits for the dice that dealt it to land.
  setTimeout(() => {
    const live = initiative.get(campaignId);
    const chaseNow = live.chase;
    const pNow = chaseNow?.participants.find((x) => x.entryId === p.entryId);
    if (!chaseNow || !pNow) return;
    bumpParticipant(io, campaignId, chaseNow, pNow, comp.bumpCards, 'a Complication');
    const critical = comp.failureIsCritical
      || (ch ? swadeCritFail(br.dice, ch.sheet.wildCard !== false) : false);
    if (critical) runChaseCritFailure(io, campaignId, chaseNow, pNow, ch ? characters.byId(ch.id) ?? ch : undefined);
    initiative.set(campaignId, live);
    broadcastInitiative(io, campaignId);
  }, diceSettleDelayMs(br.dice));
}

/** The Toughness a collision meets: a hull's plated number, or a body's. */
function collisionToughness(ch: Character | null): number {
  if (!ch) return 4;
  return isVehicle(ch.sheet)
    ? num(ch.sheet, 'vehicleToughness', 8)
    : Number(systemFor(ch.system).derive(ch.sheet).toughness) || num(ch.sheet, 'toughness', 4);
}

/**
 * What a running chase has to say about an attack between two of the people
 * in it. Null when no chase is on, or when either end of the attack is not
 * part of it — a bystander shooting at a passing car is an ordinary shot at
 * an ordinary distance.
 *
 * The gap is the whole point: in a chase the TRACK is the distance, not the
 * map. Two cars a card apart are as far apart as that chase says they are,
 * however close their tokens happen to be sitting on the scenery.
 */
function chaseAttackContext(campaignId: string, srcTokenId: string, tgtTokenId: string): {
  gapCards: number; yards: number; targetEvading: boolean;
} | null {
  const chase = initiative.get(campaignId).chase;
  if (!chase) return null;
  const a = chase.participants.find((p) => p.tokenId === srcTokenId);
  const b = chase.participants.find((p) => p.tokenId === tgtTokenId);
  if (!a || !b) return null;
  return {
    gapCards: Math.abs(a.cardIdx - b.cardIdx),
    yards: chaseRangeYards(a, b, chase.incrementId),
    targetEvading: b.evading === true,
  };
}

/**
 * What the chase costs the SHOOTER, whoever they are shooting at. Kept apart
 * from the pair above because both of these follow the attacker out of the
 * chase: someone hanging off a speeding car is on a poor firing platform even
 * when the thing they are shooting at is standing still on the pavement.
 */
function chaseSelfContext(campaignId: string, srcTokenId: string): { evading: boolean; unstable: boolean } {
  const chase = initiative.get(campaignId).chase;
  const me = chase?.participants.find((p) => p.tokenId === srcTokenId);
  if (!me) return { evading: false, unstable: false };
  // Unstable Platform: shooting from a moving vehicle is a poor idea unless
  // its driver has spent the turn on nothing but keeping it smooth.
  return {
    evading: me.evading === true,
    unstable: !!vehicleUnder(tokens.byId(srcTokenId)) && !me.steadied,
  };
}

export function registerCombatHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.COMBAT_ACTION, safe(socket, (p: CombatActionPayload) => {
    const d = requireCampaign(socket);
    const actorMaybe = characters.byId(p.characterId);
    if (!actorMaybe || actorMaybe.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actorMaybe.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    // Declared as a fully non-optional Character (rather than relying on the
    // guard's narrowing) because `resolveDamage` below is a closure that may
    // run inside a later setTimeout — narrowing from a guard doesn't survive
    // into a closure over a reassignable `let`.
    let actor: Character = actorMaybe;
    const action = combatActions(actor).find((a) => a.id === p.actionId);
    if (!action) { emitError(socket, 'That action is no longer available.'); return; }

    // SWADE: the shooter picks how many rounds this attack fires (1..RoF);
    // default is the weapon's full RoF. Drives Recoil, burst hits, and ammo.
    const effRof = actor.system === 'swade'
      ? Math.max(1, Math.min(action.rof ?? 1, Math.round(p.rof ?? (action.rof ?? 1))))
      : 1;

    // Weapons that track ammo (SWN's optional "Ammo left" column) can't fire empty.
    if (action.source === 'attack') {
      const atkRow = rows(actor.sheet, 'attacks')[action.index];
      // A weapon that isn't in hand isn't an option. Re-derived from the live
      // sheet rather than trusted from the payload, and checked here so a
      // macro can't reach past the greyed-out button in the action pane.
      if (actor.system === 'swade' && atkRow && swadeStowed(atkRow)) {
        emitError(socket, `${action.label} isn't in hand — tick Wielded on its card first.`);
        return;
      }
      // SWADE burst fire needs its full round count in the magazine.
      if (actor.system === 'swade' && atkRow && num(atkRow, 'ammo', -1) >= 0) {
        const need = AMMO_BY_ROF[Math.min(6, effRof)];
        if (num(atkRow, 'ammo', 0) < need) {
          emitError(socket, `${action.label} needs ${need} round${need === 1 ? '' : 's'} at RoF ${effRof} — only ${num(atkRow, 'ammo', 0)} left. Reload or fire slower.`);
          return;
        }
      }
      if (atkRow && num(atkRow, 'ammo', -1) === 0) {
        emitError(socket, `${action.label} is out of ammo.`);
        return;
      }
    }

    const src = tokens.byId(p.sourceTokenId);
    const tgt = tokens.byId(p.targetTokenId);
    if (!src || !tgt) { emitError(socket, 'Pick a target on the map.'); return; }
    if (d.role !== 'dm' && src.characterId !== actor.id) { emitError(socket, 'That is not your token.'); return; }
    if (tgt.mapId !== src.mapId) { emitError(socket, 'Target is on a different map.'); return; }
    const map = maps.byId(src.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');

    // Range: convert the action's feet to hexes for this map's scale.
    const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
    const rangeHexes = action.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(action.rangeFt / feetPerHex));
    // In a chase the TRACK is the distance. Both ends of the attack have to be
    // in it — a bystander shooting at a passing car is an ordinary shot — and
    // then the yards between their Chase Cards stand in for the map, which is
    // what lets a chase run over any scenery at any scale.
    const chaseCtx = chaseAttackContext(d.campaignId, src.id, tgt.id);
    const chaseSelf = chaseSelfContext(d.campaignId, src.id);
    const dist = chaseCtx
      ? Math.max(0, Math.round((chaseCtx.yards * 3) / feetPerHex))
      : hexDistance({ q: src.q, r: src.r }, { q: tgt.q, r: tgt.r });
    // Melee in a chase reaches exactly one card: your own. Everything else is
    // out of arm's reach however the tokens happen to be parked.
    if (chaseCtx && !action.ranged && chaseCtx.gapCards > 0) {
      emitError(socket, `${tgt.name} is ${chaseCtx.yards} yards up the chase — ${chaseCtx.gapCards} Chase Card${chaseCtx.gapCards === 1 ? '' : 's'} away. Close the gap first.`);
      return;
    }
    const effectiveRange = rangeHexes + (tgt.size >= 3 ? 1 : 0);
    // SWADE range bands: the listed range is Short; Medium (−2) reaches 2×
    // and Long (−4) reaches 4×. Other systems keep the hard single limit — and
    // so does anything flagged hardRange, whose listed reach IS its maximum.
    const swadeBands = actor.system === 'swade' && action.ranged && rangeHexes > 1 && !action.hardRange;

    // Wound-mending gear is aimed at the people who track Wounds. Checked here
    // and not only in the targeting ring, because the ring is the client's.
    if (action.wildCardOnly) {
      const tgtChar = tgt.characterId ? characters.byId(tgt.characterId) : undefined;
      if (!tgtChar || tgtChar.sheet.wildCard === false) {
        emitError(socket, `${tgt.name} is an Extra — ${action.label} only works on Wild Cards.`);
        return;
      }
    }
    // One shared band model (swadeRange.ts) so the shooter's on-screen ruler
    // and this penalty can never disagree. A big target is a hex easier to
    // reach, so measure against a slightly shortened distance.
    const bandOpts = { aiming: p.adv === 'adv', thrown: action.thrown === true };
    const effDist = Math.max(0, dist - (tgt.size >= 3 ? 1 : 0));
    const reading = swadeBands ? swadeRangeBand(effDist, rangeHexes, bandOpts) : null;
    if (swadeBands && reading && !reading.reachable) {
      emitError(socket, `${tgt.name} is out of range — ${dist} tiles (${dist * feetPerHex} ft). ${reading.reason ?? ''}`.trim());
      return;
    }
    if (!swadeBands && dist > effectiveRange) {
      emitError(socket, `${tgt.name} is out of range (${dist * feetPerHex} ft > ${action.rangeFt} ft).`);
      return;
    }
    const rangeBandMod = reading?.penalty ?? 0;
    // Line of sight: a wall or closed door blocks targeting entirely, the
    // same raycast FOV already uses — never trust the client's own guess.
    const srcPx = hexToPixel({ q: src.q, r: src.r }, map.grid);
    const tgtPx = hexToPixel({ q: tgt.q, r: tgt.r }, map.grid);
    const sightSegs = sightSegments(map.walls, map.doors, srcPx);
    if (rayBlocked(srcPx, tgtPx, sightSegs)) {
      emitError(socket, `${tgt.name} is out of sight (blocked by a wall or door).`);
      return;
    }
    // SWADE cover grades: the center is clear (checked above), so sample four
    // points around the target hex — each blocked edge deepens the penalty
    // (Light −2, Medium −4, Heavy −6).
    let coverPenalty = 0;
    if (actor.system === 'swade') {
      const nb = hexToPixel({ q: tgt.q + 1, r: tgt.r }, map.grid);
      const rad = 0.4 * Math.hypot(nb.x - tgtPx.x, nb.y - tgtPx.y);
      const blocked = [
        { x: tgtPx.x + rad, y: tgtPx.y }, { x: tgtPx.x - rad, y: tgtPx.y },
        { x: tgtPx.x, y: tgtPx.y + rad }, { x: tgtPx.x, y: tgtPx.y - rad },
      ].filter((pt) => rayBlocked(srcPx, pt, sightSegs)).length;
      coverPenalty = blocked === 0 ? 0 : blocked === 1 ? -2 : blocked === 2 ? -4 : -6;
    }

    const targetChar = tgt.characterId ? characters.byId(tgt.characterId) : undefined;
    // The map and the sheet can BOTH be right about cover, and neither
    // corrects the other: the map sees walls, the sheet knows about the bar
    // he is crouched behind. The target keeps whichever protects them more.
    let coverSource: 'map' | 'sheet' | 'both' = 'map';
    let coverGrade = coverGradeFor(coverPenalty);
    if (actor.system === 'swade' && targetChar) {
      const eff = effectiveCover(coverPenalty, targetChar.sheet);
      coverPenalty = eff.penalty;
      coverGrade = eff.grade;
      coverSource = eff.source;
    }

    // Conditions gate the action and shift advantage.
    const attackerConditions = conditionsOf(actor.sheet);
    if (conditionCombat(attackerConditions).incapacitated) {
      emitError(socket, `${actor.name} is incapacitated and can't act.`);
      return;
    }
    // Stunned (both 5e and SWADE) means no actions until it clears.
    if (attackerConditions.includes('stunned')) {
      emitError(socket, `${actor.name} is stunned and can't act.`);
      return;
    }
    // SWADE Shaken: free actions and movement only — no attacks or powers.
    if (actor.system === 'swade' && attackerConditions.includes('shaken')) {
      emitError(socket, `${actor.name} is Shaken — only free actions until they recover.`);
      return;
    }
    const targetConditions = targetChar ? conditionsOf(targetChar.sheet) : [];
    // SWADE bonuses that carry into the damage roll (Wild Attack, Joker, The
    // Drop) accumulate here; wildAttack also marks the attacker Vulnerable.
    let dmgBonus = 0;
    let wildAttack = false;

    // SWADE Aim: a full previous turn spent drawing a bead pays out on the
    // FIRST action of this turn — a ranged attack collects the bonus; doing
    // anything else (or firing in the same turn the aim was taken) loses it.
    let aimBonusActive = false;
    if (actor.system === 'swade' && attackerConditions.includes('aiming')) {
      const st = aimStateFor(d.campaignId, actor.id);
      if (st === 'fresh') {
        breakAim(io, d.campaignId, actor, 'fires early — the aim is wasted.');
      } else if (action.ranged) {
        aimBonusActive = true;
        breakAim(io, d.campaignId, actor, null); // consumed — the +Aim tag tells the story
      } else {
        breakAim(io, d.campaignId, actor, 'acts — the aim is lost (the first action wasn’t a ranged shot).');
      }
      actor = characters.byId(actor.id) ?? actor;
    }

    // SWADE combat maneuvers replace the whole attack/damage pipeline.
    if (action.maneuver && actor.system === 'swade') {
      resolveSwadeManeuver(io, d, socket, action.maneuver, actor, targetChar, src, tgt, map);
      return;
    }

    // Casting a spell spends a slot (leveled) and sets concentration on the
    // caster before resolving the effect.
    const undo: UndoEntry[] = [];
    if (action.source === 'spell') {
      const actorPatch: SheetData = {};
      if (action.slotLevel) {
        // Upcast: spend the lowest available slot AT OR ABOVE the spell's own
        // level, not just an exact-level slot -- a 3rd-level spell can still
        // be cast off a 4th/5th-level slot once 3rd-level slots run dry.
        const castLevel = bestCastLevel(actor.sheet, action.slotLevel);
        if (castLevel === null) {
          emitError(socket, `No level-${action.slotLevel}+ spell slot available.`);
          return;
        }
        actorPatch[`slotsUsed${castLevel}`] = num(actor.sheet, `slotsUsed${castLevel}`, 0) + 1;
        undo.push({ t: 'slot', characterId: actor.id, level: castLevel });
      }
      if (action.concentration && action.spellName) {
        undo.push({ t: 'field', characterId: actor.id, key: 'concentration', value: actor.sheet.concentration ?? '' });
        // Starting new concentration ends the old spell -- including any
        // conditions it was maintaining on its targets.
        actor = clearConcentrationEffects(io, d.campaignId, actor);
        actorPatch.concentration = action.spellName;
      }
      if (Object.keys(actorPatch).length > 0) actor = persistSheet(io, d.campaignId, actor, actorPatch);
    }

    // Activating a SWN psychic power commits Effort up front and rolls the
    // discipline's activation check (see activatePsychicPower). SWADE powers
    // instead spend Power Points, like a spell slot.
    if (action.source === 'power' && action.disciplineId) {
      const result = activatePsychicPower(io, d.campaignId, d, socket, actor, action.effortCost ?? 1, action.disciplineId ?? '', action.label);
      if (!result) return;
      actor = result.actor;
      undo.push(result.undo);
    } else if (action.source === 'power' && actor.system === 'swade') {
      // Roll to activate BEFORE anything else happens. A failure ends the
      // action here, having cost the one Power Point the book charges for it.
      const act = activatePower(io, d.campaignId, d.userId, d.username, socket, actor, action, undo);
      if (!act) return;
      actor = startPowerDuration(io, d.campaignId, act.actor, action, undo);
    } else if (action.source === 'power' && action.ppCost) {
      const pp = num(actor.sheet, 'pp', 0);
      if (pp < action.ppCost) {
        emitError(socket, `Not enough Power Points (${pp} left, ${action.label} costs ${action.ppCost}).`);
        return;
      }
      undo.push({ t: 'field', characterId: actor.id, key: 'pp', value: pp });
      actor = persistSheet(io, d.campaignId, actor, { pp: pp - action.ppCost });
    }

    // To-hit (weapons/spell attacks). Nat 20 always hits, nat 1 always misses;
    // otherwise compare to the target's AC. Every attack roll -- to-hit or
    // save -- posts its own chat card immediately, and (on a hit, or a save
    // that doesn't fully negate) the damage roll follows as a separate card
    // only once that first roll's own dice animation has had time to settle.
    let hit = true;
    let crit = false;
    let raise = false;
    let saveScale = 1;
    let attackBreakdown: ReturnType<typeof roll> | null = null;
    let attackCritFail = false;
    let hitLabel = '';
    // The attack card shows this under the dice instead of in its headline.
    let attackOutcome = '';
    let deferredSave: { total: number; threshold: number; label: string; passed: boolean } | null = null;
    if (action.saveId && action.effect === 'damage') {
      // Monster stat-block attacks (breath weapons, etc.) bake in a fixed DC
      // rather than deriving one from the actor's spellcasting stat.
      const casterDc = action.fixedDc || Math.round(Number(systemFor(actor.system).derive(actor.sheet).spellDc)) || 10;
      const sc = targetChar
        ? systemFor(targetChar.system).saveCheck(targetChar.sheet, action.saveId, casterDc)
        : { expr: '1d20', threshold: casterDc, label: `${action.saveId.toUpperCase()} save` };
      attackBreakdown = roll(sc.expr);
      const passed = attackBreakdown.total >= sc.threshold;
      saveScale = passed ? (action.onSave === 'negate' ? 0 : 0.5) : 1;
      // 5e's threshold is always the caster's DC; SWN's is target-number based
      // (ignores the caster's DC entirely) — showing sc.threshold is correct
      // for both instead of hard-coding "vs DC" around the 5e-only casterDc.
      deferredSave = { total: attackBreakdown.total, threshold: sc.threshold, label: sc.label, passed };
    } else if (action.attackExpr) {
      // Net advantage folds the roller's choice with attacker/target
      // conditions. On 1d20 systems that becomes advantage/disadvantage
      // dice; on SWADE trait rolls it becomes the book's flat ±2 (Vulnerable
      // grants +2 to hit its bearer, Distracted takes −2 on its own rolls).
      const isD20 = action.attackExpr.toLowerCase().startsWith('1d20');
      const netAdv = attackAdvantage(p.adv ?? null, attackerConditions, targetConditions, action.ranged);
      let expr = action.attackExpr;
      let advTag = '';
      if (isD20) {
        expr = applyAdv(expr, netAdv);
        advTag = netAdv === 'adv' ? ' [adv]' : netAdv === 'dis' ? ' [dis]' : '';
      } else if (actor.system === 'swade') {
        // SWADE folds situation into flat modifiers, not adv/dis dice. The
        // attacker's own Distracted −2 is already baked into the trait
        // expression, so only positional and target-side effects apply here.
        let mod = 0;
        const tags: string[] = [];
        // A healer works against the patient's own condition: their Wound
        // levels come off the Healing roll. It cannot be baked into the
        // expression the sheet builds — that is written before anyone has
        // been picked to treat — so it lands here, where the patient is
        // known. Without it, patching up a dying casualty was as easy as
        // dressing a scratch.
        if (action.healsWounds && targetChar?.system === 'swade') {
          const hurt = Math.min(3, Math.max(0, num(targetChar.sheet, 'wounds', 0)));
          if (hurt > 0) {
            mod -= hurt;
            tags.push(`−${hurt} patient's Wounds`);
          }
        }
        // The adv slot is repurposed: melee 'adv' is a Wild Attack (+2 to
        // hit AND damage, but you're Vulnerable), ranged 'adv' is Aim (+2).
        if (p.adv === 'adv' && !action.ranged) {
          mod += 2; dmgBonus += 2; wildAttack = true; tags.push('+2 Wild Attack');
        } else if (p.adv === 'dis') { mod -= 2; tags.push('−2'); }
        if (rangeBandMod) { mod += rangeBandMod; tags.push(`${rangeBandMod} ${reading?.label ?? 'range'}`); }
        if (coverPenalty) {
          mod += coverPenalty;
          const via = coverSource === 'both' ? '' : coverSource === 'sheet' ? ', on their sheet' : ', from the map';
          tags.push(`${coverPenalty} ${COVER_LABEL[coverGrade]}${via} (armor +${-coverPenalty})`);
        }
        // Illumination: Dim −2, Dark −4 — unless the target stands in light
        // (a map light's or a carried torch's bright radius washes it out;
        // a dim radius still leaves −2).
        if (map.grid.lighting !== 'light') {
          const nb2 = hexToPixel({ q: tgt.q + 1, r: tgt.r }, map.grid);
          const hexStep = Math.hypot(nb2.x - tgtPx.x, nb2.y - tgtPx.y);
          let lit: 'bright' | 'dim' | 'none' = 'none';
          for (const L of map.lights) {
            const dHex = Math.hypot(L.x - tgtPx.x, L.y - tgtPx.y) / hexStep;
            if (dHex <= L.brightRadius) { lit = 'bright'; break; }
            if (dHex <= L.dimRadius) lit = 'dim';
          }
          if (lit !== 'bright') {
            for (const t of tokens.forMap(src.mapId)) {
              if (!t.light) continue;
              const px = hexToPixel({ q: t.q, r: t.r }, map.grid);
              const dHex = Math.hypot(px.x - tgtPx.x, px.y - tgtPx.y) / hexStep;
              if (dHex <= t.light.bright) { lit = 'bright'; break; }
              if (dHex <= t.light.dim) lit = 'dim';
            }
          }
          const base = map.grid.lighting === 'dim' ? -2 : map.grid.lighting === 'dark' ? -4 : -6;
          let illum = lit === 'bright' ? 0 : lit === 'dim' ? -2 : base;
          const illumWord = illum === -2 ? 'Dim light' : illum === -4 ? 'Darkness' : 'Pitch darkness';
          // Low Light Vision ignores Dim and Dark outright — but not Pitch
          // Darkness, where there is no light left to make the most of.
          if (illum < 0 && illum > -6 && actor.sheet.lowLightVision === true) {
            tags.push(`${illum} ${illumWord} ignored (Low Light Vision)`);
            illum = 0;
          } else if (illum < 0 && actor.sheet.infravision === true) {
            // Infravision sees heat rather than light, so it halves the
            // penalty — against something that gives off heat. A construct
            // does not, which is exactly the clever trick the book invites
            // players to pull with cold mud and a heat-filtering suit.
            const warm = !targetChar || !(targetChar.system === 'swade' && isAbomination(targetChar.sheet));
            if (warm) {
              const halved = Math.ceil(illum / 2); // −4 → −2, −6 → −3
              tags.push(`${halved} ${illumWord}, halved by Infravision`);
              illum = halved;
            } else {
              tags.push(`${illum} ${illumWord} (Infravision finds no warmth here)`);
            }
          } else if (illum) {
            tags.push(`${illum} ${illumWord}`);
          }
          mod += illum;
        }
        // Aim (earned by spending last turn on the 🎯 Aim action): negate up
        // to 4 points of range/cover penalties, else +2 flat.
        if (aimBonusActive) {
          const offset = Math.min(4, -(rangeBandMod + coverPenalty));
          if (offset > 0) { mod += offset; tags.push(`+${offset} Aim`); }
          else { mod += 2; tags.push('+2 Aim'); }
        }
        // Automatic fire: RoF 2+ takes −2 Recoil; a raise lands extra hits.
        if (effRof >= 2) { mod -= 2; tags.push(`−2 Recoil (RoF ${effRof})`); }
        // Firing in melee: nothing bigger than a pistol when a foe is adjacent.
        if (action.ranged && action.rangeFt > 90) {
          const mySide = actor.ownerUserId ? 'pc' : 'npc';
          const adjacentFoe = tokens.forMap(src.mapId).some((t) => {
            if (t.id === src.id || !t.characterId) return false;
            if (hexDistance({ q: t.q, r: t.r }, { q: src.q, r: src.r }) !== 1) return false;
            const c = characters.byId(t.characterId);
            return !!c && (c.ownerUserId ? 'pc' : 'npc') !== mySide
              && !conditionsOf(c.sheet).includes('incapacitated');
          });
          if (adjacentFoe) {
            emitError(socket, `${action.label} is too big to fire with a foe in reach — pistols only in melee.`);
            return;
          }
        }
        // Bigger targets are easier to hit (Large +2, Huge +4).
        if (tgt.size === 2) { mod += 2; tags.push('+2 Size'); }
        else if (tgt.size >= 3) { mod += 4; tags.push('+4 Size'); }
        // Joker: the real +2 to trait rolls and damage, not just card text.
        const initState = initiative.get(d.campaignId);
        const myEntry = initState.active ? initState.entries.find((e) => (e.tokenId ? tokens.byId(e.tokenId)?.characterId : undefined) === actor.id) : undefined;
        if (myEntry?.card?.rank === 15) { mod += 2; dmgBonus += 2; tags.push('+2 Joker'); }
        // Multi-Action: −2 per extra action this turn (−4 max).
        const map2 = multiActionPenalty(d.campaignId, actor.id);
        if (map2) { mod += map2; tags.push(`${map2} Multi-Action`); }
        // Running die spent this turn: −2 to everything else.
        if (hasRunThisTurn(d.campaignId, src.id)) { mod -= 2; tags.push('−2 Ran'); }
        // A Support roll banked for this character: spend it now.
        const support = num(actor.sheet, 'supportBonus', 0);
        if (support > 0) {
          mod += support; tags.push(`+${support} Support`);
          actor = persistSheet(io, d.campaignId, actor, { supportBonus: 0 });
        }
        if (!action.ranged && attackerConditions.includes('prone')) { mod -= 2; tags.push('−2 Prone'); }
        // Gang Up: melee only. Sides split PC (player-owned) vs NPC; a
        // bystander too hurt to threaten anyone doesn't count for either.
        if (!action.ranged && targetChar) {
          const mySide = actor.ownerUserId ? 'pc' : 'npc';
          const others = tokens.forMap(src.mapId).flatMap((t): GangUpCombatant[] => {
            if (t.id === src.id || t.id === tgt.id || !t.characterId) return [];
            const c = characters.byId(t.characterId);
            if (!c) return [];
            const cond = conditionsOf(c.sheet);
            const canFight = !cond.includes('incapacitated') && !cond.includes('stunned') && !cond.includes('bleeding');
            return [{
              hex: { q: t.q, r: t.r },
              side: (c.ownerUserId ? 'pc' : 'npc') === mySide ? 'attacker' : 'defender',
              canFight,
            }];
          });
          const gang = gangUpBonus({ q: src.q, r: src.r }, { q: tgt.q, r: tgt.r }, others);
          if (gang > 0) { mod += gang; tags.push(`+${gang} Gang Up`); }
        }
        // Scale: the smaller creature adds the difference, the larger
        // subtracts it. A fly swatting at a dragon is easy; the dragon
        // swatting back at the fly is not.
        // A Called Shot uses the Scale of the PART instead of the creature's,
        // so the two never both apply — the book is explicit that the modifier
        // depends on "the Scale of the target itself, not the creature it's
        // part of". Stacking them charged the attacker twice for one Scale.
        const rawScale = p.calledShot ? 0 : sizeAttackMod(num(actor.sheet, 'size', 0), num(targetChar?.sheet ?? {}, 'size', 0));
        // Swat: a creature that has learned to deal with things smaller than
        // itself ignores up to 4 points of the Scale penalty — but only with
        // the attacks its own description names, which is why it is a flag on
        // the weapon row rather than on the creature.
        const swatted = action.swat === true && rawScale < 0 ? Math.min(4, -rawScale) : 0;
        const scaleMod = rawScale + swatted;
        if (scaleMod) {
          mod += scaleMod;
          tags.push(sizeAttackTag(num(actor.sheet, 'size', 0), num(targetChar?.sheet ?? {}, 'size', 0))!);
        }
        if (swatted) tags.push(`+${swatted} Swat`);
        // Called Shot: the Scale of the PART being aimed at, which the client
        // worked out from the defender's own Size once a target was picked —
        // a Huge creature's head is a bigger thing to hit than a person's.
        // Re-clamped here so a hand-typed modifier cannot invent one.
        if (p.calledShot) {
          const csPen = clampCalledShotPenalty(Number(p.calledShot.penalty) || 0);
          // A Called Shot pays a to-hit penalty for extra damage to a vital
          // spot. A skeleton has no vitals: the penalty still applies (the eye
          // socket is still a small target) but the bonus does not, which is
          // the book's way of saying stop aiming for its heart.
          const noVitals = !!targetChar && targetChar.system === 'swade' && isAbomination(targetChar.sheet);
          const csDmg = noVitals ? 0 : Math.max(0, Math.min(8, Math.floor(Number(p.calledShot.damageBonus) || 0)));
          const csLabel = String(p.calledShot.label || 'Called Shot').slice(0, 40);
          mod += csPen;
          dmgBonus += csDmg;
          tags.push(calledShotTag(csLabel, csPen) + (noVitals && Number(p.calledShot.damageBonus) > 0 ? ' (no vitals — no bonus damage)' : ''));
        }
        if (targetConditions.includes('stunned')) { mod += 4; dmgBonus += 4; tags.push('+4 The Drop'); }
        else if (targetConditions.includes('vulnerable') || targetConditions.includes('bound')) { mod += 2; tags.push('+2 Vulnerable'); }
        if (action.ranged && targetConditions.includes('prone')) { mod -= 2; tags.push('−2 vs Prone'); }
        // Chase: evasive driving cuts both ways, and a moving vehicle is a
        // poor firing platform unless its driver spent the turn steadying it.
        if (chaseCtx?.targetEvading) { mod += EVADE_MOD; tags.push('−2 target is Evading'); }
        if (chaseSelf.evading) { mod += EVADE_MOD; tags.push('−2 Evading'); }
        if (action.ranged && chaseSelf.unstable) { mod += UNSTABLE_PLATFORM_MOD; tags.push('−2 Unstable Platform'); }
        if (mod) expr = mod > 0 ? `${expr}+${mod}` : `${expr}${mod}`;
        if (tags.length) advTag = ` [${tags.join(', ')}]`;
      } else if (netAdv) {
        expr = `${expr}${netAdv === 'adv' ? '+2' : '-2'}`;
        advTag = netAdv === 'adv' ? ' [+2]' : ' [−2]';
      }
      attackBreakdown = roll(expr);
      if (actor.system === 'swade') {
        // Decided once, here: the Benny menu must know whether this roll is
        // rerollable at all, and a Critical Failure never is.
        attackCritFail = critFailFor(io, d.campaignId, actor, attackBreakdown.dice);
        recordBennyRoll(io, d.campaignId, actor, 'trait', expr, attackBreakdown.total, `their ${action.label} roll`, attackCritFail);
        // Itemize every flat modifier for the chat tooltip: sheet-borne
        // penalties plus the situational tags computed above.
        attackBreakdown.modWhy = [
          ...traitModWhy(actor.sheet),
          ...advTag.replace(/^\s*\[/, '').replace(/\]\s*$/, '').split(', ').filter(Boolean),
        ];
      }
      // A Wild Attack leaves you open whether it lands or not.
      if (wildAttack) {
        applyConditionTo(io, d.campaignId, characters.byId(actor.id) ?? actor, 'vulnerable', 'Wild Attack');
        actor = characters.byId(actor.id) ?? actor;
      }
      const d20s = attackBreakdown.dice.filter((x) => x.sides === 20 && x.kept);
      // Champion Improved Critical lowers the crit threshold (19, or 18 at 15).
      const critAt = critRange(actor.sheet);
      crit = d20s.some((x) => x.value >= critAt && x.value !== 1);
      const nat1 = d20s.some((x) => x.value === 1);
      // Prefer the derived AC (folds in toggles like Dual Wielder's +1) over
      // the raw sheet field, which stays the DM/player's manually-typed base.
      // SWADE: melee attacks (and powers with a fixed TN) work as before —
      // but by the book a RANGED attack beats a flat TN 4 (range/cover/etc.
      // already applied as penalties above), NOT the target's Parry. The one
      // exception is a point-blank shot at a foe within melee reach, which
      // faces Parry like a melee swing. A raise is still beating the number
      // by 4+.
      const swadeRangedTn = actor.system === 'swade' && action.ranged && action.fixedTn == null && dist > 1;
      // A machine has no Fighting of its own, so its Parry is 2 + half the die
      // its driver manoeuvres with. Without this a vehicle had no target
      // number at all and every swing at one landed automatically.
      const vehicleTn = targetChar && targetChar.system === 'swade' && isVehicle(targetChar.sheet)
        ? vehicleParryOf(tgt, targetChar) : null;
      const ac = action.fixedTn
        ?? (swadeRangedTn ? 4
          : vehicleTn
          ?? (targetChar ? Number(systemFor(targetChar.system).derive(targetChar.sheet).ac) || num(targetChar.sheet, 'ac', 0) : 0));
      hit = nat1 ? false : crit ? true : ac > 0 ? attackBreakdown.total >= ac : true;
      raise = hit && actor.system === 'swade' && ac > 0 && attackBreakdown.total >= ac + 4;
      // Say WHY it landed or didn't. A bare HIT/MISS makes the engine look
      // arbitrary — especially in SWADE, where a weapon beats Parry but a
      // power beats a flat TN, and the two numbers look nothing alike.
      const targetSystem = targetChar?.system ?? actor.system;
      const acName = action.fixedTn ? 'TN' : swadeRangedTn ? 'TN' : targetSystem === 'swade' ? 'Parry' : 'AC';
      const why = nat1 ? 'natural 1 always misses'
        : crit ? `natural ${critAt}+ always hits`
          : ac > 0 ? `vs ${acName} ${ac}`
            : 'no target number to beat';
      const landed = action.healsWounds
        ? (hit ? (raise ? 'SUCCESS with a RAISE — mends 2 Wounds' : 'SUCCESS — mends 1 Wound') : 'FAILED — no Wounds mended')
        : `${hit ? 'HIT' : 'MISS'}${crit ? ' (crit!)' : ''}${raise ? ' (raise!)' : ''}`;
      attackOutcome = `${landed} — ${why}${raise ? `, beat it by ${attackBreakdown.total - ac}` : ''}`;
      hitLabel = ` — attack ${attackBreakdown.total}${advTag} · ${attackOutcome}`;
    }

    // Consume a used item (decrement the actor's inventory row) and/or ammo
    // on an attack that tracks it. Runs whether the attack hits or misses --
    // a missed shot still spends the arrow -- so a miss (which now skips
    // resolveDamage entirely, see below) calls this directly instead.
    const consumeAmmoAndItem = (): void => {
      if (action.consumesItem && action.source === 'item') {
        const fresh = characters.byId(actor.id) ?? actor;
        const inv = Array.isArray(fresh.sheet.inventory) ? [...(fresh.sheet.inventory as SheetData[])] : [];
        const row = inv[action.index];
        if (row) {
          inv[action.index] = { ...row, qty: Math.max(0, num(row, 'qty', 1) - 1) };
          const sheet = { ...fresh.sheet, inventory: inv };
          characters.update(actor.id, undefined, sheet);
          const updatedActor = characters.byId(actor.id)!;
          io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
          if (updatedActor.ownerUserId) io.to(userRoom(updatedActor.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
          undo.push({ t: 'item', characterId: actor.id, index: action.index });
        }
      }

      if (action.source === 'attack') {
        const fresh = characters.byId(actor.id) ?? actor;
        const atks = Array.isArray(fresh.sheet.attacks) ? [...(fresh.sheet.attacks as SheetData[])] : [];
        const row = atks[action.index];
        const ammo = row ? num(row, 'ammo', -1) : -1;
        if (row && ammo > 0) {
          const before = atks.map((r) => ({ ...r }));
          const spend = actor.system === 'swade' ? AMMO_BY_ROF[Math.min(6, effRof)] : 1;
          atks[action.index] = { ...row, ammo: Math.max(0, ammo - spend) };
          const sheet = { ...fresh.sheet, attacks: atks };
          characters.update(actor.id, undefined, sheet);
          const updatedActor = characters.byId(actor.id)!;
          io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
          if (updatedActor.ownerUserId) io.to(userRoom(updatedActor.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
          undo.push({ t: 'field', characterId: actor.id, key: 'attacks', value: before });
        }
      }
    };

    // Status-condition rider: inflicted on the target character (bare tokens
    // have no sheet to carry a condition) once the causal roll has settled.
    // Save-based spells apply it on a FAILED save; to-hit attacks on a hit
    // (optionally gated by the rider's own save, e.g. ghoul claws' DC 10
    // CON); roll-less spells (Invisibility) apply it unconditionally.
    const conditionId = targetChar ? action.appliesCondition : undefined;
    const applyCondition = (): void => {
      if (!conditionId || !targetChar) return;
      const fresh = characters.byId(targetChar.id);
      if (!fresh) return;
      // Immunity stops the Stun as well as the damage: a creature born in
      // fire is not knocked senseless by a fireball either. Only Stun — an
      // immunity says nothing about being tangled in a net that happens to
      // be on fire.
      if (conditionId === 'stunned' && isImmuneTo(fresh, action.damageType)) {
        postStatusLine(io, d.campaignId, `${fresh.name} is immune to ${action.damageType} — no Stun.`);
        return;
      }
      const casterAfter = applyConditionTo(
        io, d.campaignId, fresh, conditionId, action.spellName ?? action.label,
        action.concentration ? (characters.byId(actor.id) ?? actor) : undefined,
      );
      if (casterAfter) actor = casterAfter;
    };
    const scheduleRiderSave = (delayMs: number): void => {
      if (!conditionId || !targetChar || !action.conditionSaveId || !action.conditionDc) return;
      setTimeout(() => {
        const fresh = characters.byId(targetChar.id);
        if (!fresh) return;
        const sc = systemFor(fresh.system).saveCheck(fresh.sheet, action.conditionSaveId!, action.conditionDc!);
        const br = roll(sc.expr);
        const passed = br.total >= sc.threshold;
        const msg = chat.add(d.campaignId, {
          userId: d.userId, fromName: d.username, fromCharacter: actor.name, kind: 'roll',
          text: `${tgt.name} — ${sc.label} vs ${action.label}: ${passed ? 'Success' : 'Failure'} (DC ${sc.threshold})`,
          // The rider save is the TARGET's roll — their stats, not the caster's.
          characterId: fresh.id, statsUserId: fresh.ownerUserId,
          roll: { ...br, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
        });
        io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
        if (!passed) setTimeout(applyCondition, diceSettleDelayMs(br.dice));
      }, delayMs);
    };

    // Damage/heal resolution + chat post, run either immediately (plain
    // attacks/heals with no roll of their own) or after the attack/save
    // card's dice have settled.
    const resolveDamage = (): void => {
      // A SWADE heal has no amount to roll — the Healing roll already posted
      // above IS the whole resolution, and its margin decides the Wounds. So
      // apply the mending and stop: rolling the item's vestigial dice here
      // produced a second card showing a number that was then thrown away.
      if (action.healsWounds) {
        const mended = swadeWoundsHealed(hit, raise);
        consumeAmmoAndItem();
        if (mended > 0 && targetChar) {
          const targetId = targetChar.id;
          undo.push({ t: 'hp', characterId: targetId, delta: mended });
          // resolveDamage is ALREADY called once the Healing roll's dice have
          // settled — waiting a second settle here just left the patient
          // bleeding for another beat.
          const fresh = characters.byId(targetId);
          if (fresh) applySwadeWoundHeal(io, d.campaignId, fresh, mended);
          floatHp(io, d.campaignId, src.mapId, tgt.id, mended, 'heal');
        }
        return;
      }

      // A crit doubles the dice. Resistance/vulnerability/immunity from the
      // target's sheet then scales the total. A SWADE raise (beating TN 4 by
      // 4+) adds a bonus d6 that aces, per the book.
      // The raise's bonus d6 is rolled separately from the base damage so its
      // dice can be tagged — otherwise it just shows up as a mystery third die
      // in the breakdown with nothing marking it as earned.
      const rollDamage = (): RollBreakdown => {
        // Automatic fire: a raise walks a second round onto the target.
        const hits = actor.system === 'swade' && effRof >= 2 && raise ? 2 : 1;
        const core = hits > 1 ? Array(hits).fill(`(${action.amountExpr})`).join('+') : action.amountExpr;
        const baseExpr = dmgBonus > 0 ? `${core}+${dmgBonus}` : core;
        if (crit) return roll(critDamageExpr(baseExpr));
        const base = roll(baseExpr);
        if (!raise) return base;
        return withRaiseDie(base, roll('1d6!'));
      };
      let amountRoll = rollDamage();
      // Savage Attacker: once per round, reroll a melee hit's damage and keep
      // the higher total (auto-applied — no reason to ever decline it).
      if (hit && action.source === 'attack' && !action.ranged && hasSavageAttacker(actor.sheet)) {
        const used = num(actor.sheet, 'res_savageAttacker', 0);
        if (used < 1) {
          const reroll = rollDamage();
          if (reroll.total > amountRoll.total) amountRoll = reroll;
          undo.push({ t: 'field', characterId: actor.id, key: 'res_savageAttacker', value: used });
          actor = persistSheet(io, d.campaignId, actor, { res_savageAttacker: used + 1 });
        }
      }
      if (actor.system === 'swade' && hit) {
        recordBennyRoll(io, d.campaignId, actor, 'damage', action.amountExpr, amountRoll.total, `their ${action.label} damage`);
      }
      let magnitude = Math.max(0, amountRoll.total);
      // Cover Armor Bonus: the obstacle that made the shot harder also
      // absorbs part of what gets through (+2 armor per cover grade).
      if (actor.system === 'swade' && coverPenalty < 0 && hit) {
        magnitude = Math.max(0, magnitude + coverPenalty);
      }
      // Save-based spells scale the rolled damage (half / none on a save).
      if (action.effect === 'damage' && saveScale !== 1) magnitude = Math.floor(magnitude * saveScale);
      let resistTag = '';
      // Heavy Armor: an ordinary weapon does not scratch a Gargantuan hull —
      // not less damage, none. The fight has to be won with a Heavy Weapon or
      // some other way entirely, and saying so plainly is the point: a player
      // who sees "0 — cutlass can't hurt Heavy Armor" goes looking for the
      // cannon, where a small number just reads as bad luck.
      if (action.effect === 'damage' && hit && targetChar && targetChar.system === 'swade'
        && hasHeavyArmor({ size: num(targetChar.sheet, 'size', 0), flag: targetChar.sheet.heavyArmor })
        && action.heavy !== true) {
        magnitude = 0;
        resistTag = ' (Heavy Armor — needs a Heavy Weapon)';
      }
      if (action.effect === 'damage' && hit && targetChar && magnitude > 0) {
        const defended = applyDamageDefenses(targetChar.system, targetChar.sheet, action.damageType, magnitude);
        if (defended.label) {
          magnitude = defended.amount;
          resistTag = ` (${defended.label})`;
        }
        // SWADE shields: armor that counts only vs ranged attacks (a Medium/
        // Large Shield's +2) soaks that much off any ranged hit automatically.
        // The weapon's AP (armor piercing) eats through that soak first.
        if (action.ranged && targetChar.system === 'swade') {
          const dr = Math.max(0, swadeRangedArmor(targetChar.sheet) - (action.ap ?? 0));
          if (dr > 0 && magnitude > 0) {
            magnitude = Math.max(0, magnitude - dr);
            resistTag += ` (shield −${dr} vs ranged)`;
          } else if (swadeRangedArmor(targetChar.sheet) > 0 && (action.ap ?? 0) > 0) {
            resistTag += ` (AP ${action.ap} pierces shield)`;
          }
        }
      }
      // SWADE healing isn't an amount at all: the Healing roll's own margin
      // is the result — a success mends one Wound, a raise two, a failure
      // none. `magnitude` here is that wound count, not points.
      // A construct is repaired, not healed: the Healing skill has nothing to
      // work on, and there is no Golden Hour on a golem. The roll still
      // happens — the medic tried — it simply mends nothing, and the card
      // says why so nobody spends a second action on it.
      // A construct is repaired and an undead is mended by magic, so a
      // Healing roll from a kit has nothing to work on either way. `arcane`
      // marks the healing that does reach an undead — a power rather than a
      // pair of hands.
      const swadeTarget = targetChar?.system === 'swade';
      const arcaneHeal = action.source === 'power' || action.source === 'spell';
      const needsRepair = !!action.healsWounds && swadeTarget && isConstruct(targetChar!.sheet);
      const needsMagic = !!action.healsWounds && swadeTarget && !arcaneHeal && isUndead(targetChar!.sheet);
      // The Golden Hour. The Healing skill treats an injury while it is still
      // fresh; past that hour the body has done what it is going to do, and
      // only magic or time mends it. Measured against the world's clock, not
      // the wall's — which is what the GM's time controls move.
      const woundedAt = swadeTarget ? num(targetChar!.sheet, 'woundsAtSec', -1) : -1;
      const tooLate = !!action.healsWounds && !arcaneHeal && woundedAt >= 0
        && campaigns.clockSeconds(d.campaignId) - woundedAt >= 3600;
      const woundsMended = action.healsWounds && !needsRepair && !needsMagic && !tooLate
        ? swadeWoundsHealed(hit, raise) : 0;
      if (action.healsWounds) magnitude = woundsMended;
      const applied = action.effect === 'heal' ? magnitude : (hit ? magnitude : 0);
      const delta = action.effect === 'heal' ? applied : -applied;
      const impactKind: ImpactKind = action.effect === 'heal' ? 'heal' : action.aoe ? 'aoe' : action.ranged ? 'ranged' : 'melee';

      // Work out the outcome now, for the chat card's text — but don't touch
      // the target's HP yet. That (and the impact animation over their token)
      // is deferred to fire only once this roll's own dice have visibly
      // settled, so the token never reacts before the player sees why.
      // The card is built as rows rather than one run-on sentence (see the
      // text assembly below), so what the target's state was and what it
      // became are collected separately instead of concatenated here.
      /** What the roll was measured against — " (Toughness 5)". */
      let defenseTag = '';
      /** The verdict line, when the system has one distinct from the amount
       *  rolled. SWADE does — a hit is Shaken or Wounds, not points. */
      let verdictRow = '';
      /** Where the target stands afterwards: "INCAPACITATED", "Kira 12/20". */
      let statusRow = '';
      let applyToTarget: (() => void) | null = null;
      /** Venom only travels on a hit that at least Shakes — see resolvePoison. */
      let poisonLands = false;
      if (action.healsWounds && targetChar) {
        // Wound mending has its own application path — applyHpDelta's point
        // arithmetic (4 points to a Wound) would misread a wound count.
        const before = num(targetChar.sheet, 'wounds', 0);
        const after = Math.max(0, before - woundsMended);
        if (woundsMended > 0) statusRow = `${tgt.name} now ${after} of 3 Wounds`;
        if (woundsMended > 0) {
          undo.push({ t: 'hp', characterId: targetChar.id, delta: woundsMended });
          const targetId = targetChar.id;
          applyToTarget = () => {
            const fresh = characters.byId(targetId);
            if (fresh) applySwadeWoundHeal(io, d.campaignId, fresh, woundsMended);
            floatHp(io, d.campaignId, src.mapId, tgt.id, woundsMended, 'heal');
          };
        }
      } else if (applied !== 0) {
        if (targetChar) {
          if (targetChar.system === 'swade' && delta < 0) {
            // The wound ladder, not the HP pool: preview the same outcome
            // applyHpDelta will compute when it actually lands.
            const toughness = Number(systemFor('swade').derive(targetChar.sheet).toughness) || 4;
            const out = swadeDamageOutcome(-delta, toughness, {
              alreadyShaken: conditionsOf(targetChar.sheet).includes('shaken'),
              wildCard: targetChar.sheet.wildCard !== false,
              currentWounds: num(targetChar.sheet, 'wounds', 0),
              maxWounds: swadeWoundCap({
                wildCard: targetChar.sheet.wildCard !== false,
                size: num(targetChar.sheet, 'size', 0),
                override: num(targetChar.sheet, 'maxWoundsOverride', 0),
                resilient: str(targetChar.sheet, 'resilient', ''),
              }),
            });
            defenseTag = ` (Toughness ${toughness})`;
            verdictRow = `${out.verdict} (${-delta} vs. Toughness ${toughness})`;
            statusRow = out.stateNote ?? '';
            poisonLands = out.shaken && !!action.poison;
          } else {
            const { patch, note } = computeHpDelta(targetChar, delta);
            const nh = systemFor(targetChar.system).hp({ ...targetChar.sheet, ...patch });
            statusRow = `${tgt.name} ${nh.hp}/${nh.maxHp}${note}`;
          }
          undo.push({ t: 'hp', characterId: targetChar.id, delta });
          const targetId = targetChar.id;
          applyToTarget = () => {
            // Re-read fresh: item/ammo consumption below may have already
            // patched this same sheet (when the actor heals themself).
            const fresh = characters.byId(targetId);
            if (fresh) applyHpDelta(io, d.campaignId, fresh, delta, action.spellName ?? action.label, actor.name, action.damageType);
            floatHp(io, d.campaignId, src.mapId, tgt.id, delta, impactKind, action.damageType);
          };
        } else if (tgt.bar) {
          const cap = tgt.bar.maxHp > 0 ? tgt.bar.maxHp : tgt.bar.hp + delta;
          const nh = Math.max(0, Math.min(cap, tgt.bar.hp + delta));
          statusRow = `${tgt.name} ${nh}/${tgt.bar.maxHp}`;
          undo.push({ t: 'hp', tokenId: tgt.id, delta });
          applyToTarget = () => {
            // Re-read live and apply the DELTA, never a precomputed absolute:
            // another player's hit can land (and apply) during this roll's own
            // dice-settle delay, and writing a stale absolute HP would silently
            // erase their damage.
            const live = tokens.byId(tgt.id);
            if (!live?.bar) return;
            const liveCap = live.bar.maxHp > 0 ? live.bar.maxHp : live.bar.hp + delta;
            const liveHp = Math.max(0, Math.min(liveCap, live.bar.hp + delta));
            tokens.update(tgt.id, { bar: { hp: liveHp, maxHp: live.bar.maxHp } });
            io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tgt.id)! });
            syncMapVision(io, d.campaignId, src.mapId);
            floatHp(io, d.campaignId, src.mapId, tgt.id, delta, impactKind, action.damageType);
          };
        }
      }
      // Re-read the character first in case something else already patched
      // its sheet (e.g. the Savage Attacker reroll above).
      consumeAmmoAndItem();

      const healing = action.effect === 'heal' || action.healsWounds;
      // Name the bonus die's source on the headline, so an extra die in the
      // breakdown reads as a reward rather than a bug.
      const rollTag = crit ? ' (crit ×2 dice)' : raise && !action.healsWounds ? ' (raise +1d6)' : '';
      const amountRow = action.healsWounds
        ? (needsRepair
          ? 'No Wounds mended — a Construct is mended with Repair, not Healing'
          : needsMagic
            ? 'No Wounds mended — the Undead are mended by magic, not medicine'
            : tooLate
              ? 'No Wounds mended — the Golden Hour has passed; only magic or natural healing now'
          : woundsMended === 0
            ? 'No Wounds mended'
            : `Mends ${woundsMended} Wound${woundsMended === 1 ? '' : 's'}${raise ? ' (raise!)' : ''}`)
        : action.effect === 'heal'
        ? `Heals ${applied}`
        : hit ? `${applied} damage${resistTag}` : 'No damage';

      // Four rows rather than one run-on sentence: what was rolled, what it
      // was rolled against, what it did, and where that leaves the target.
      //
      //   Kira's Carbon-Edge Knife damage roll (raise +1d6)
      //   vs. Training Dummy (Toughness 5)
      //   1 Wound (12 vs. Toughness 5)
      //   INCAPACITATED
      //
      // Where the system has no verdict distinct from the number rolled (an
      // HP pool, a bare token bar), the amount IS the verdict and the third
      // row carries it instead.
      const rows = [
        `${actor.name}'s ${action.label} ${healing ? 'healing' : 'damage'} roll${rollTag}`,
        `${healing ? 'on' : 'vs.'} ${tgt.name}${defenseTag}`,
        verdictRow || amountRow,
        // With a SWADE verdict above it the raw amount is already quoted in
        // the "(12 vs. Toughness 5)" parenthetical — except for the tag that
        // explains why it shrank, which would otherwise be lost.
        ...(verdictRow && resistTag ? [resistTag.trim()] : []),
        statusRow,
      ];
      // A to-hit or save roll already posted its own card above (see the
      // dispatch below); this card is the damage half either way, so the rows
      // read the same whether or not one preceded it.
      const text = rows.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      const cardRoll = amountRoll;
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll', text, roll: cardRoll, recipients: null,
        callout: {
          what: `${action.label}${action.healsWounds ? ' — Healing' : action.effect === 'heal' ? ' — healing' : ' — damage'}`,
          tone: action.healsWounds || action.effect === 'heal' ? 'recover' : 'damage',
        },
      }, undo.length > 0 ? undo : undefined);
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });

      if (applyToTarget) {
        const settleMs = diceSettleDelayMs(cardRoll.dice);
        // A single-target ranged hit gets a shot flying across the map,
        // launched so its flight lands exactly when the damage does -- melee
        // (no travel to show) and AoE (its own shockwave, no single target
        // to aim at) skip this.
        if (impactKind === 'ranged') {
          // Emitted immediately, straight after the damage card. The client
          // holds it behind that roll's animation and fires it a beat after
          // the last die lands -- only the client knows how long an acing
          // chain actually took, so timing it from a dice count here was
          // always a guess that a chain of aces would outrun.
          emitProjectile(io, d.campaignId, src.mapId, src.id, tgt.id, action.damageType);
        }
        setTimeout(applyToTarget, settleMs);
      }

      // Venom, once the bite has landed and told. Scheduled a beat after the
      // damage so the table reads the wound before the poison that came with
      // it, rather than two cards arriving at once.
      if (poisonLands && targetChar && action.poison) {
        const targetId = targetChar.id;
        const poison = action.poison;
        setTimeout(() => {
          const fresh = characters.byId(targetId);
          if (fresh) resolvePoison(io, d.campaignId, fresh, poison, action.label);
        }, diceSettleDelayMs(cardRoll.dice) + SAVE_STEP_DELAY_MS);
      }

      // Condition rider, timed with the damage it rode in on: a hit's rider
      // rolls its own save first (when it has one); a failed spell save's
      // rider applies outright; a roll-less action's applies with its amount.
      if (conditionId) {
        const settleMs = diceSettleDelayMs(cardRoll.dice);
        if (attackBreakdown && hit && action.conditionSaveId && action.conditionDc) scheduleRiderSave(settleMs);
        else if ((attackBreakdown && hit)
          || (deferredSave && !deferredSave.passed)
          || (!attackBreakdown && !deferredSave)) setTimeout(applyCondition, settleMs);
      }
    };

    if (deferredSave) {
      const { total, threshold, label, passed } = deferredSave;
      const noDamage = saveScale === 0;
      // A fully-negated save still spends the ammo/item that was used --
      // and it must be consumed BEFORE the card is posted, since chat.add
      // serializes the undo entries right then (a late consume's refund
      // entry would silently miss the stored undo).
      if (noDamage) consumeAmmoAndItem();
      // Name the number and say what the result costs. "14 vs 15 · FAIL" left
      // two questions open: 15 of what, and what does failing actually do?
      // 5e measures against the caster's DC; SWN and SWADE against a target
      // number of the defender's own, so the label has to follow the system.
      const thName = (targetChar?.system ?? actor.system) === 'dnd5e' ? 'DC' : 'TN';
      const dealsDamage = action.effect === 'damage' && usableAmount(action.amountExpr);
      const consequence = noDamage ? 'negated entirely'
        : passed ? (dealsDamage ? 'half damage' : 'effect avoided')
          : (dealsDamage ? 'full damage' : 'effect applies');
      const saveText = `${actor.name} attacks ${tgt.name}: ${action.label} — ${label} ${total} vs ${thName} ${threshold} · ${passed ? 'SAVE' : 'FAIL'} (${consequence})`;
      const saveMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, kind: 'roll', text: saveText,
        // The dice on this card are the TARGET's saving throw.
        characterId: targetChar?.id ?? null, statsUserId: targetChar?.ownerUserId ?? null,
        roll: { ...attackBreakdown!, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
      }, noDamage && undo.length > 0 ? undo : undefined);
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: saveMsg });
      if (noDamage) return; // save passed & negates: no damage, no condition
      // A condition-only spell (Hold Person: no damage dice at all) has
      // nothing left to roll -- the failed save above IS the whole
      // resolution; apply the condition once its die settles.
      if (conditionId && !usableAmount(action.amountExpr)) {
        if (!passed) setTimeout(applyCondition, SAVE_STEP_DELAY_MS);
        return;
      }
      setTimeout(resolveDamage, SAVE_STEP_DELAY_MS);
      return;
    }
    if (attackBreakdown) {
      // A to-hit roll always gets its own card first -- the target only
      // finds out whether (and how much) damage lands once that roll's own
      // dice have visibly settled, same pacing as the save roll above.
      // A miss still spends ammo/an item -- consumed BEFORE the card is
      // posted so the refund lands in its serialized undo (see above); a
      // hit consumes inside resolveDamage's own flow instead, before its
      // damage card.
      if (!hit) consumeAmmoAndItem();
      // Headline states who did what to whom; the action rides in its own
      // field so chat can underline it and hang a tooltip off it, and the
      // outcome in another so it can sit under the dice rather than above.
      const attackText = action.healsWounds
        ? `${actor.name} treats ${tgt.name} with`
        : `${actor.name} attacks ${tgt.name} with`;
      const attackMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll', text: attackText,
        callout: { what: `${action.label} — attack`, tone: 'attack' },
        actionName: action.label, outcomeNote: attackOutcome,
        roll: { ...attackBreakdown, outcome: hit ? 'success' as const : 'failure' as const }, recipients: null,
      }, !hit && undo.length > 0 ? undo : undefined);
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: attackMsg });
      if (!hit) {
        // Innocent Bystander: a missed SWADE shot whose skill die shows a 1
        // hits a random target adjacent to the intended one.
        if (actor.system === 'swade' && action.ranged && usableAmount(action.amountExpr)) {
          const skillDieShown = attackBreakdown.dice.find((x) => !x.wild && !x.raise)?.value;
          if (skillDieShown === 1) {
            const bystanders = tokens.forMap(src.mapId).filter((t) =>
              t.id !== tgt.id && t.id !== src.id && t.characterId
              && hexDistance({ q: t.q, r: t.r }, { q: tgt.q, r: tgt.r }) === 1);
            if (bystanders.length > 0) {
              const pick = bystanders[roll(`1d${bystanders.length}`).total - 1];
              setTimeout(() => {
                const fresh = pick.characterId ? characters.byId(pick.characterId) : undefined;
                if (!fresh) return;
                const dmg = roll(action.amountExpr);
                const amt = Math.max(0, dmg.total);
                const { note } = applyHpDelta(io, d.campaignId, fresh, -amt, 'stray shot', actor.name, action.damageType);
                const strayMsg = chat.add(d.campaignId, {
                  userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll',
                  text: `💥 The shot goes wild — it hits ${pick.name} instead! ${amt} damage${note}`,
                  roll: dmg, recipients: null,
                });
                io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: strayMsg });
                floatHp(io, d.campaignId, src.mapId, pick.id, -amt, 'ranged', action.damageType);
              }, diceSettleDelayMs(attackBreakdown.dice));
            }
          }
        }
        // SWN Shock: a shock weapon still deals its flat shock damage on a
        // MISS against targets whose AC is at or below its threshold — the
        // rule that makes melee dangerous. Lands after the miss card's dice
        // settle, with its own undoable chat line and floating number.
        if (action.shockDamage && action.shockAc && targetChar) {
          const targetAc = Number(systemFor(targetChar.system).derive(targetChar.sheet).ac) || num(targetChar.sheet, 'ac', 0);
          if (targetAc > 0 && targetAc <= action.shockAc) {
            const targetId = targetChar.id;
            setTimeout(() => {
              const fresh = characters.byId(targetId);
              if (!fresh) return;
              const dmg = applyDamageDefenses(fresh.system, fresh.sheet, action.damageType, action.shockDamage!).amount;
              if (dmg <= 0) return;
              applyHpDelta(io, d.campaignId, fresh, -dmg, `${action.label} (shock)`, actor.name, action.damageType);
              const after = characters.byId(targetId)!;
              const { hp, maxHp } = systemFor(after.system).hp(after.sheet);
              const shockMsg = chat.add(d.campaignId, {
                userId: d.userId, fromName: d.username, kind: 'system',
                text: `${action.label} misses, but its shock still lands on ${tgt.name}: ${dmg} damage (${tgt.name} ${hp}/${maxHp})`,
                roll: null, recipients: null,
              }, [{ t: 'hp', characterId: targetId, delta: -dmg }]);
              io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: shockMsg });
              floatHp(io, d.campaignId, src.mapId, tgt.id, -dmg, 'melee', action.damageType);
            }, diceSettleDelayMs(attackBreakdown.dice));
          }
        }
        return;
      }
      setTimeout(resolveDamage, diceSettleDelayMs(attackBreakdown.dice));
      return;
    }
    // No roll at all AND nothing to roll for: a pure-condition cast like
    // Invisibility. Post the cast line and apply the condition directly --
    // resolveDamage would only produce a meaningless "heals 0" card.
    if (conditionId && !usableAmount(action.amountExpr)) {
      const castMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'system',
        text: `${actor.name} casts ${action.label} on ${tgt.name}.`, roll: null, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: castMsg });
      applyCondition();
      return;
    }
    resolveDamage();
  }, 'COMBAT_ACTION'));

  // Lock in an AoE spell's template: recompute (never trust the client) which
  // tokens the shape actually covers on the server's own map data, then run
  // the same sequenced save-and-damage pipeline as the DM's "call for save"
  // tool — one roll per hit target, damage always last.
  socket.on(C2S.CAST_AOE, safe(socket, (p: CastAoePayload) => {
    const d = requireCampaign(socket);
    let actor = characters.byId(p.characterId);
    if (!actor || actor.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actor.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    const action = combatActions(actor).find((a) => a.id === p.actionId);
    if (!action || !action.aoe) { emitError(socket, 'That is not an area spell.'); return; }

    // A SWADE weapon hosing a template (Suppressive Fire, grenades with a mag)
    // spends ammo like any other attack — suppression burns 3× the RoF table.
    if (actor.system === 'swade' && action.source === 'attack') {
      const atks = rows(actor.sheet, 'attacks').map((r) => ({ ...r }));
      const row = atks[action.index];
      const ammo = row ? num(row, 'ammo', -1) : -1;
      const spend = (action.suppressive ? 3 : 1) * AMMO_BY_ROF[Math.min(6, action.rof ?? 1)];
      if (ammo >= 0 && ammo < spend) {
        emitError(socket, `${action.label} needs ${spend} rounds — only ${Math.max(0, ammo)} left.`);
        return;
      }
      if (row && ammo > 0) {
        atks[action.index] = { ...row, ammo: Math.max(0, ammo - spend) };
        actor = persistSheet(io, d.campaignId, actor, { attacks: atks });
      }
      // Firing the template is an action like any other.
      multiActionPenalty(d.campaignId, actor.id);
    }

    const src = tokens.byId(p.sourceTokenId);
    if (!src) { emitError(socket, 'Unknown source token.'); return; }
    if (d.role !== 'dm' && src.characterId !== actor.id) { emitError(socket, 'That is not your token.'); return; }
    const map = maps.byId(src.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');

    if (!inBounds(p.aimHex, map.grid)) {
      emitError(socket, 'That is off the map.');
      return;
    }
    // Self-origin shapes (cone/line/cube) always anchor on the caster's own
    // current, server-authoritative position -- never the client-reported
    // originHex. Trusting the client's origin let it drift from the caster's
    // real hex (e.g. a stale snapshot from when aiming began, if the caster's
    // token moved before confirming the cast), which broke the "a cone's
    // point of origin doesn't hit its own caster" exclusion in pointInAoe:
    // that check only excludes the exact geometric origin point, so an origin
    // that no longer matches the caster's real hex left their own token
    // sitting inside the template as just another ordinary hit.
    const originHex: Hex = { q: src.q, r: src.r };
    // Range only constrains where a point-target shape (sphere/cylinder) can
    // be centered. Self-origin shapes (cone/line/cube) always anchor on the
    // caster — rangeFt is 0 for those, and `aimHex` is just a direction, so
    // it's never itself distance-limited (the shape's own sizeFt is).
    // A SWADE throw reaches its full band spread (Short / Medium / Long),
    // exactly as the shooter's ruler promises — the old check stopped at the
    // listed Short range, so a grenade could only go a third as far as it
    // should. `throwRead` is reused below for the throwing roll's penalty.
    const feetPerHexA = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
    const aimDist = hexDistance({ q: src.q, r: src.r }, p.aimHex);
    const shortHexesA = action.rangeFt > 0 ? Math.max(1, Math.ceil(action.rangeFt / feetPerHexA)) : 0;
    const banded = actor.system === 'swade' && action.rangeFt > 0;
    const throwRead = banded
      ? swadeRangeBand(aimDist, shortHexesA, { aiming: p.adv === 'adv', thrown: action.thrown === true })
      : null;
    if (banded && throwRead && !throwRead.reachable) {
      emitError(socket, `That is out of range — ${aimDist} tiles (${aimDist * feetPerHexA} ft). ${throwRead.reason ?? ''}`.trim());
      return;
    }
    if (!banded && action.rangeFt > 0 && aimDist > shortHexesA) {
      emitError(socket, 'That is out of range.');
      return;
    }
    // Line of sight: a point-target shape (sphere/cylinder) can't be centered
    // somewhere the caster can't see, and no shape can reach a token hidden
    // behind a wall/closed door from the caster — filtered below, alongside
    // the geometric hit-test, never trusting the client's own guess.
    const srcPx = hexToPixel({ q: src.q, r: src.r }, map.grid);
    const sightSegs = sightSegments(map.walls, map.doors, srcPx);
    if ((action.aoe.shape === 'sphere' || action.aoe.shape === 'cylinder')
      && rayBlocked(srcPx, hexToPixel(p.aimHex, map.grid), sightSegs)) {
      emitError(socket, 'That point is out of sight (blocked by a wall or door).');
      return;
    }

    // Casting a spell spends a slot (leveled) and sets concentration on the
    // caster before resolving the effect — mirrors C2S.COMBAT_ACTION. SWADE
    // area powers (Burst/Blast) spend Power Points the same way.
    const actorPatch: SheetData = {};
    // What it cost to cast, as undo entries. This path spent the Power Points
    // and the slot but recorded no way back, so a hide-and-undo left the
    // caster paying for a power the log says never happened. They ride on the
    // cast card below, with everything the resolution goes on to do.
    const costUndo: UndoEntry[] = [];
    // The cast card leads. It has to be posted BEFORE the activation roll,
    // not after: it is the announcement the roll belongs to, and a log that
    // shows the roll first reads backwards. It also has to exist before the
    // roll so a FAILED activation is still something the DM can undo.
    let leadMessageId: number | undefined;
    if (action.source === 'power' && actor.system === 'swade') {
      leadMessageId = postCastCard(
        io, d.campaignId, d.userId, d.username, actor, action, action.label, action.ppCost ?? 0,
      );
      // Same gate as a single-target power: the template does not get dropped
      // until the caster has rolled their arcane skill and made TN 4.
      const act = activatePower(io, d.campaignId, d.userId, d.username, socket, actor, action, costUndo, leadMessageId);
      if (!act) {
        // It fizzled, but a Power Point (and possibly Backlash) still landed.
        if (costUndo.length > 0) chat.appendUndo(leadMessageId, costUndo);
        return;
      }
      actor = act.actor;
    } else if (action.source === 'power' && action.ppCost) {
      const pp = num(actor.sheet, 'pp', 0);
      if (pp < action.ppCost) {
        emitError(socket, `Not enough Power Points (${pp} left, ${action.label} costs ${action.ppCost}).`);
        return;
      }
      costUndo.push({ t: 'field', characterId: actor.id, key: 'pp', value: pp });
      actorPatch.pp = pp - action.ppCost;
    }
    let castLevel: number | null = null;
    if (action.slotLevel) {
      // Upcast: spend the lowest available slot at or above the spell's own
      // level (see the matching comment in C2S.COMBAT_ACTION above).
      castLevel = bestCastLevel(actor.sheet, action.slotLevel);
      if (castLevel === null) {
        emitError(socket, `No level-${action.slotLevel}+ spell slot available.`);
        return;
      }
      costUndo.push({ t: 'slot', characterId: actor.id, level: castLevel });
      actorPatch[`slotsUsed${castLevel}`] = num(actor.sheet, `slotsUsed${castLevel}`, 0) + 1;
    }
    if (action.concentration && action.spellName) {
      // Starting new concentration ends the old spell -- including any
      // conditions it was maintaining on its targets.
      actor = clearConcentrationEffects(io, d.campaignId, actor);
      actorPatch.concentration = action.spellName;
    }
    if (Object.keys(actorPatch).length > 0) actor = persistSheet(io, d.campaignId, actor, actorPatch);
    const castLabel = castLevel && action.slotLevel && castLevel > action.slotLevel
      ? `${action.label} (cast at level ${castLevel})` : action.label;

    // SWADE thrown/fired templates can go wide: Athletics (thrown) or
    // Shooting vs 4 — on a failure the template deviates 1d6″ (thrown) or
    // 2d6″ (fired) in a random direction before it lands.
    // COOKING a grenade (a free Smarts roll before the throw): time the fuse
    // so it lands and goes off at once — nobody throws it back, nobody dives
    // clear. Get it wrong badly enough and it goes off in your hand.
    let cooked = false;
    let cookBlewUp = false;
    /** Damage the blast will actually roll — a hand detonation adds the raise die. */
    let blastDamage = action.amountExpr;
    // What counts as a grenade — hoisted so cooking it, throwing it back and
    // smothering it all agree. A thrown template flagged either by the action
    // or by the attack row's own notes.
    const isNade = action.thrown === true
      || /thrown/i.test(str(rows(actor.sheet, 'attacks')[action.index] ?? {}, 'notes', ''));
    if (actor.system === 'swade' && p.cook && isNade && action.source === 'attack') {
      const br = roll(traitExpr(actor.sheet, dieSides(str(actor.sheet, 'smarts', 'd6'))));
      // A SWADE Critical Failure: the trait die shows 1, and for a Wild Card
      // the Wild Die does too. One shared rule, so the mechanical outcome here
      // and the snake-eyes flare the client draws can never disagree.
      const critFail = critFailFor(io, d.campaignId, actor, br.dice);
      cooked = !critFail && br.total >= 4;
      let text: string;
      if (critFail) {
        // It detonates in hand. Re-centre the blast on the thrower BEFORE
        // anyone rolls anything, so evasion and saves are judged against
        // where it actually went off.
        p.aimHex = { q: src.q, r: src.r };
        text = `${actor.name} cooks ${action.label} — CRITICAL FAILURE: it goes off in their hand!`;
      } else if (cooked) {
        text = `${actor.name} cooks ${action.label} — Smarts success: the fuse is timed, no throwing it back and no diving clear.`;
      } else {
        text = `${actor.name} cooks ${action.label} — Smarts failure: the timing is off, so it can still be thrown back or evaded.`;
      }
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll',
        text, roll: { ...br, outcome: critFail ? 'failure' as const : cooked ? 'success' as const : 'failure' as const },
        recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      if (critFail) {
        // Damage as if thrown with a raise, per the book.
        blastDamage = usableAmount(action.amountExpr) ? `${action.amountExpr}+1d6!` : action.amountExpr;
        cookBlewUp = true;
      }
    }

    // Fires for EVERY thrown/fired template, not just damaging ones: a Stun
    // Grenade deals no damage, and its victims must not be made to roll Vigor
    // for a grenade that was never landed in the first place. A grenade that
    // already went off in the thrower's hand needs no throwing roll.
    if (actor.system === 'swade' && action.source === 'attack' && !action.suppressive && !cookBlewUp) {
      const row = rows(actor.sheet, 'attacks')[action.index];
      const thrown = action.thrown === true || /thrown/i.test(str(row ?? {}, 'notes', ''));
      const skillName = thrown ? 'Athletics' : 'Shooting';
      // The same range penalty the shooter's ruler showed while aiming.
      const rangeMod = throwRead?.penalty ?? 0;
      const br = roll(traitExpr(actor.sheet, skillDie(actor.sheet, skillName), rangeMod));
      const onTarget = br.total >= 4;
      const bandTag = rangeMod ? ` (${rangeMod} ${throwRead?.label ?? 'range'})` : '';
      let text = `${actor.name} lets ${action.label} fly — ${skillName} roll${bandTag}: on target`;
      if (!onTarget) {
        const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        const devDist = roll(thrown ? '1d6' : '2d6').total;
        const dir = DIRS[roll('1d6').total - 1];
        const moved = { q: p.aimHex.q + dir[0] * devDist, r: p.aimHex.r + dir[1] * devDist };
        if (inBounds(moved, map.grid)) p.aimHex = moved;
        text = `${actor.name} lets ${action.label} fly — ${skillName} roll${bandTag} fails: the ${thrown ? 'throw' : 'shot'} goes wide, deviating ${devDist}″!`;
      }
      const devMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll',
        text, roll: { ...br, outcome: onTarget ? 'success' as const : 'failure' as const }, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: devMsg });
    }

    // Everything from "who is standing in it" onward, as a closure. A SWADE
    // grenade parks here for a beat first (see the Hot Potato / Covering
    // offer below) and re-enters this with a possibly different centre,
    // damage, and a coverer — so nothing downstream may be computed before
    // the people in the blast have had their say.
    const aoe = action.aoe;
    const detonate = (mod: BlastMod): void => {
      const centre = mod.aimHex ?? p.aimHex;
      const damageExpr = mod.damageExpr ?? blastDamage;
      // Reachability stays anchored on the thrower, exactly as it is for a
      // throw that deviates: the wall test asks "could this have got to you",
      // and the thrower is where it came from either way.
      const geometricHitIds = tokensInAoe(aoe, originHex, centre, map.grid, tokens.forMap(src.mapId));
      const hitIds = geometricHitIds.filter((tid) => {
        const t = tokens.byId(tid);
        return !!t && !rayBlocked(srcPx, hexToPixel({ q: t.q, r: t.r }, map.grid), sightSegs);
      });
      if (hitIds.length === 0) { emitError(socket, `${action.label} caught no one in its area.`); return; }

      // SWADE Evasion: a telegraphed template attack (grenade blast, cone of
      // flame) can be dived away from — Agility at −2, success takes nothing.
      // A properly cooked grenade goes off the instant it lands: no diving clear.
      const evadeable = actor.system === 'swade' && action.source === 'attack'
        && !action.suppressive && !action.saveId && usableAmount(action.amountExpr) && !cooked;
      if (action.saveId || evadeable) {
        // Monster stat-block attacks (breath weapons, etc.) bake in a fixed DC
        // rather than deriving one from the actor's spellcasting stat.
        const casterDc = action.fixedDc || Math.round(Number(systemFor(actor.system).derive(actor.sheet).spellDc)) || 10;
        // A power already posted its card above, before rolling to activate.
        // Anything else (a breath weapon, a thrown template) gets one here —
        // it still needs something for the DM to rewind.
        const lead = leadMessageId ?? postCastCard(
          io, d.campaignId, d.userId, d.username, actor, action, castLabel, action.ppCost ?? 0,
        );
        if (costUndo.length > 0) chat.appendUndo(lead, costUndo);
        runGroupSave(io, {
          campaignId: d.campaignId, userId: d.userId, username: d.username,
          attackerName: actor.name,
          leadMessageId: lead,
          tokenIds: hitIds, saveId: action.saveId ?? 'agility', dc: casterDc,
          ...(evadeable ? { evasion: true } : {}),
          damageExpr, onSave: action.onSave ?? (evadeable ? 'negate' : 'half'),
          damageType: action.damageType, label: castLabel,
          ...(mod.cover ? { cover: mod.cover } : {}),
          ...(action.appliesCondition ? {
            appliesCondition: action.appliesCondition,
            ...(action.concentration ? { concentrationCasterId: actor.id } : {}),
          } : {}),
          aoeVisual: {
            mapId: src.mapId, shape: aoe.shape, sizeFt: aoe.sizeFt, sizeHexes: aoe.sizeHexes, widthFt: aoe.widthFt,
            originHex, aimHex: centre,
          },
        });
        return;
      }

      // No save (rare — every compendium AoE spell has one, but a homebrew
      // action might not): everyone caught in the area takes the same roll.
      const dmg = roll(damageExpr);
      const base = Math.max(0, dmg.total);
      const undo: UndoEntry[] = [];
      // As above: figure out who takes what now, apply once this roll's own
      // dice have settled.
      const applications: Array<() => void> = [];
      for (const tid of hitIds) {
        const tok = tokens.byId(tid);
        if (!tok) continue;
        const ch = tok.characterId ? characters.byId(tok.characterId) : undefined;
        let amt = base;
        if (mod.cover) {
          amt = coverAdjustedDamage(amt, { isCoverer: tok.id === mod.cover.tokenId, coverToughness: mod.cover.toughness });
        }
        if (ch && action.damageType) amt = applyDamageDefenses(ch.system, ch.sheet, action.damageType, amt).amount;
        if (amt <= 0) continue;
        undo.push(ch ? { t: 'hp', characterId: ch.id, delta: -amt } : { t: 'hp', tokenId: tok.id, delta: -amt });
        applications.push(() => {
          if (ch) {
            const fresh = characters.byId(ch.id);
            if (fresh) applyHpDelta(io, d.campaignId, fresh, -amt, action.spellName ?? action.label, actor.name, action.damageType);
          } else {
            const live = tokens.byId(tok.id);
            if (live?.bar) {
              const nh = Math.max(0, live.bar.hp - amt);
              tokens.update(tok.id, { bar: { hp: nh, maxHp: live.bar.maxHp } });
              io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
            }
          }
          floatHp(io, d.campaignId, tok.mapId, tok.id, -amt, 'aoe', action.damageType);
        });
      }
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll', text: `${actor.name} casts ${castLabel}`, roll: dmg, recipients: null,
      }, undo.length > 0 ? undo : undefined);
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      const noSaveSettleMs = diceSettleDelayMs(dmg.dice);
      setTimeout(() => {
        for (const apply of applications) apply();
        syncMapVision(io, d.campaignId, src.mapId);
      }, noSaveSettleMs);
      const noSaveFlightMs = aoe.shape === 'sphere' || aoe.shape === 'cylinder' ? PROJECTILE_FLIGHT_MS : 0;
      setTimeout(
        () => emitAoeBurst(io, d.campaignId, src.mapId, aoe.shape, aoe.sizeFt, aoe.sizeHexes, aoe.widthFt, originHex, centre, action.damageType),
        Math.max(0, noSaveSettleMs - noSaveFlightMs),
      );
    };

    // A live grenade at your feet is a question, not a fact. Park the blast
    // for a beat and ask everyone standing in it — one of them may snatch it
    // up and throw it back (Hot Potato), or throw themselves onto it
    // (Covering). A cooked grenade goes off the instant it lands, and one
    // that already went off in the thrower's hand is long past asking.
    const offerable = actor.system === 'swade' && action.source === 'attack'
      && isNade && !action.suppressive && !cooked && !cookBlewUp;
    // offerBlastChoice returns false when there was nobody in the blast who
    // could answer for themselves — then it resolves as it always has.
    if (!offerable || !offerBlastChoice({
      io, campaignId: d.campaignId, label: castLabel,
      throwerName: actor.name, throwerHex: { q: src.q, r: src.r },
      aoe, originHex, aimHex: p.aimHex, map,
      srcPx, sightSegs, damageExpr: blastDamage, resume: detonate,
    })) {
      detonate({});
    }
  }, 'CAST_AOE'));

  // Activate a psychic power that has no target (utility/self powers, e.g.
  // Attunement or Astral Wandering): commits Effort and rolls the discipline
  // check, same as a targeted power, but never touches anyone's HP.
  socket.on(C2S.USE_POWER, safe(socket, (p: UsePowerPayload) => {
    const d = requireCampaign(socket);
    let actor = characters.byId(p.characterId);
    if (!actor || actor.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actor.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    const pw = rows(actor.sheet, 'powers')[p.powerIndex];
    if (!pw) { emitError(socket, 'That power is no longer available.'); return; }
    const discipline = str(pw, 'discipline', '');
    const name = str(pw, 'name', '').trim() || 'a power';
    if (!discipline || !rows(actor.sheet, 'skills').some((sk) => str(sk, 'name', '') === discipline)) {
      emitError(socket, `${actor.name} hasn't trained in ${discipline || 'that discipline'}.`);
      return;
    }
    const level = Math.max(1, num(pw, 'level', 1));
    const cost = Math.max(1, num(pw, 'effort', 0) || level);
    const result = activatePsychicPower(io, d.campaignId, d, socket, actor, cost, discipline, name);
    if (!result) return;
    actor = result.actor;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `${actor.name} uses ${name} (−${cost} Effort).`, roll: null, recipients: null,
    }, [result.undo]);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'USE_POWER'));

  // SWN: reload a weapon from a matching ammo item in inventory. Consumes
  // one unit of that item and refills the weapon back to its magazine size
  // (swnReloadCheck is the single source of truth for whether this is legal
  // right now — the client uses the same check to enable/disable its button).
  socket.on(C2S.RELOAD_WEAPON, safe(socket, ({ characterId, attackIndex }: ReloadWeaponPayload) => {
    const d = requireCampaign(socket);
    const actor = characters.byId(characterId);
    if (!actor || actor.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actor.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    // SWADE reloads are simpler than SWN's: no tracked ammo boxes, just the
    // magazine capacity — but topping up IS an action, so it feeds the
    // Multi-Action penalty for anything else this turn.
    if (actor.system === 'swade') {
      const atks = rows(actor.sheet, 'attacks').map((r) => ({ ...r }));
      const atksBefore = atks.map((r) => ({ ...r }));
      const row = atks[attackIndex];
      const maxAmmo = row ? num(row, 'maxAmmo', 0) : 0;
      const ammo = row ? num(row, 'ammo', 0) : 0;
      if (!row || maxAmmo <= 0) { emitError(socket, 'That weapon has no magazine to reload.'); return; }
      if (ammo >= maxAmmo) { emitError(socket, `${str(row, 'name', 'That weapon')} is already loaded.`); return; }
      // Rounds come out of matching-caliber ammunition in inventory (partial
      // reloads allowed). Caliber-less legacy weapons still reload free.
      const caliber = str(row, 'caliber', '').trim().toLowerCase();
      let loaded = maxAmmo - ammo;
      const inv = rows(actor.sheet, 'inventory').map((r) => ({ ...r }));
      const invBefore = inv.map((r) => ({ ...r }));
      let fromInv = '';
      if (caliber) {
        let available = 0;
        for (const it of inv) if (str(it, 'caliber', '').toLowerCase() === caliber) available += Math.max(0, num(it, 'qty', 0));
        if (available <= 0) {
          emitError(socket, `No ${caliber} rounds in inventory — add ammunition from the compendium.`);
          return;
        }
        loaded = Math.min(loaded, available);
        let take = loaded;
        for (const it of inv) {
          if (take <= 0) break;
          if (str(it, 'caliber', '').toLowerCase() !== caliber) continue;
          const q = Math.max(0, num(it, 'qty', 0));
          const used = Math.min(q, take);
          it.qty = q - used;
          take -= used;
        }
        fromInv = ` — ${loaded} ${caliber} from inventory`;
      }
      atks[attackIndex] = { ...row, ammo: ammo + loaded };
      const updated = persistSheet(io, d.campaignId, actor, { attacks: atks, ...(caliber ? { inventory: inv } : {}) });
      multiActionPenalty(d.campaignId, actor.id);
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'system',
        text: `🔄 ${updated.name} reloads ${str(row, 'name', 'their weapon')} (${ammo + loaded}/${maxAmmo}${fromInv} — an action).`,
        roll: null, recipients: null,
      }, [
        { t: 'field', characterId: actor.id, key: 'attacks', value: atksBefore },
        ...(caliber ? [{ t: 'field' as const, characterId: actor.id, key: 'inventory', value: invBefore }] : []),
      ]);
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      return;
    }

    const check = swnReloadCheck(actor.sheet, attackIndex);
    if (!check.ok) { emitError(socket, check.reason!); return; }

    const atks = rows(actor.sheet, 'attacks').map((r) => ({ ...r }));
    const atksBefore = atks.map((r) => ({ ...r }));
    atks[attackIndex] = { ...atks[attackIndex], ammo: check.maxAmmo };

    const inv = rows(actor.sheet, 'inventory').map((r) => ({ ...r }));
    const invBefore = inv.map((r) => ({ ...r }));
    const invRow = inv[check.invIndex!];
    inv[check.invIndex!] = { ...invRow, qty: Math.max(0, num(invRow, 'qty', 1) - 1) };

    const updated = persistSheet(io, d.campaignId, actor, { attacks: atks, inventory: inv });
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `${updated.name} reloads ${check.weaponName} (−1 ${check.ammoItemName}).`,
      roll: null, recipients: null,
    }, [
      { t: 'field', characterId: actor.id, key: 'attacks', value: atksBefore },
      { t: 'field', characterId: actor.id, key: 'inventory', value: invBefore },
    ]);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'RELOAD_WEAPON'));

  // A 5e death saving throw for a character at 0 HP. Server-authoritative:
  // rolls, tallies successes/failures, and resolves stabilize/wake/death.
  socket.on(C2S.DEATH_SAVE, safe(socket, ({ characterId }: DeathSavePayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) {
      emitError(socket, 'You can only roll for your own character.');
      return;
    }
    if (systemFor(character.system).hp(character.sheet).hp > 0) {
      emitError(socket, `${character.name} is not down.`);
      return;
    }
    const br = roll('1d20');
    const v = br.total;
    let succ = num(character.sheet, 'deathSuccesses', 0);
    let fail = num(character.sheet, 'deathFailures', 0);
    if (v === 20) {
      // Nat 20: regain 1 HP and wake up — deferred until the d20 has settled
      // on screen, same as any other roll that inflicts damage or healing.
      // applyHpDelta posts its own "is back up!" status line once applied,
      // so this roll's own message just reports the roll itself.
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'roll',
        text: `${character.name} death save: natural 20!`, characterId: character.id, roll: br, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      setTimeout(() => {
        const fresh = characters.byId(characterId);
        if (!fresh) return;
        applyHpDelta(io, d.campaignId, fresh, 1); // clears unconscious, posts "is back up!"
        persistSheet(io, d.campaignId, characters.byId(characterId)!, { deathSuccesses: 0, deathFailures: 0 });
        for (const t of tokens.forCharacter(characterId)) floatHp(io, d.campaignId, t.mapId, t.id, 1, 'heal');
      }, diceSettleDelayMs(br.dice));
      return;
    }
    if (v === 1) fail += 2;
    else if (v >= 10) succ += 1;
    else fail += 1;
    succ = Math.min(3, succ);
    fail = Math.min(3, fail);

    const patch: SheetData = { deathSuccesses: succ, deathFailures: fail };
    // Terminal outcomes (die/stabilize) are game events in their own right —
    // posted as a separate message below, after the roll's own message,
    // rather than folded into the roll's text.
    let statusText: string | null = null;
    if (fail >= 3) {
      patch.conditions = [...conditionsOf(character.sheet).filter((c) => c !== 'unconscious'), 'dead'];
      statusText = `${character.name} has died.`;
      dropCarriedLoot(io, d.campaignId, characterId);
    } else if (succ >= 3) {
      patch.deathSuccesses = 0;
      patch.deathFailures = 0;
      patch.stable = true;
      statusText = `${character.name} is stable.`;
    }
    const outcome = v >= 10 ? `success (${succ}/3)` : `failure (${fail}/3)`;
    persistSheet(io, d.campaignId, characters.byId(characterId)!, patch);
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text: `${character.name} death save: ${v} — ${outcome}`, characterId: character.id, roll: br, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    if (statusText) {
      postStatusLine(io, d.campaignId, statusText.replace(/[!.]?$/, '') + ` by ${character.name}'s death save`);
    }
  }, 'DEATH_SAVE'));

  // DM "call for save": each listed token rolls its own save vs the DC, one
  // at a time — each roll posts as its own red/green chat card, and the next
  // target's roll waits for the dice animation to settle everywhere (plus a
  // beat) before firing. The shared damage roll (if any) always comes last,
  // applied per target based on their own pass/fail.
  socket.on(C2S.REQUEST_SAVE, safe(socket, (p: RequestSavePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM calls for saves.'); return; }
    if (!runGroupSave(io, { campaignId: d.campaignId, userId: d.userId, username: d.username, ...p })) {
      emitError(socket, 'No valid targets for the save.');
    }
  }, 'REQUEST_SAVE'));

  // DM "call for a Fear check": the SWADE Spirit roll, with failures routed
  // through the Fear Table. Same shape as a group save — one roll at a time,
  // each waiting for the previous card's dice to settle.
  socket.on(C2S.REQUEST_FEAR, safe(socket, (p: RequestFearPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM calls for Fear checks.'); return; }
    if (!runGroupFear(io, { campaignId: d.campaignId, userId: d.userId, username: d.username, ...p })) {
      emitError(socket, 'No valid targets — a Fear check needs a SWADE character sheet.');
    }
  }, 'REQUEST_FEAR'));

  socket.on(C2S.INIT_ADD, safe(socket, (payload: InitAddPayload) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);

    let name = payload.name?.trim() || 'Combatant';
    let value = payload.value ?? 0;
    let character;
    if (payload.tokenId) {
      const token = tokens.byId(payload.tokenId);
      if (!token) throw new Error('Unknown token.');
      name = token.name;
      character = token.characterId ? characters.byId(token.characterId) : undefined;
      if (d.role !== 'dm' && (!character || character.ownerUserId !== d.userId)) {
        emitError(socket, 'You can only add your own character to initiative.');
        return;
      }
    } else if (d.role !== 'dm') {
      emitError(socket, 'Only the DM adds custom entries.');
      return;
    }

    if (payload.roll) {
      const expr = character ? systemFor(character.system).initiativeExpr(character.sheet) : '1d20';
      const breakdown = roll(expr);
      value = breakdown.total;
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'roll',
        text: `${name}: initiative`, roll: breakdown, recipients: null,
      });
      if (!payload.hidden) io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      else io.to(dmRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    }

    state.entries.push({
      id: newId(),
      tokenId: payload.tokenId ?? null,
      name,
      value,
      hidden: d.role === 'dm' ? !!payload.hidden : false,
    });
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }, 'INIT_ADD'));

  socket.on(C2S.INIT_REMOVE, safe(socket, ({ entryId }: InitRemovePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    const idx = state.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return;
    state.entries.splice(idx, 1);
    if (state.turnIdx >= state.entries.length) state.turnIdx = 0;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }, 'INIT_REMOVE'));

  socket.on(C2S.INIT_UPDATE, safe(socket, (payload: InitUpdatePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    const entry = state.entries.find((e) => e.id === payload.entryId);
    if (!entry) return;
    // Re-roll uses the entry's own token/character (same expr as the original
    // roll) and posts a fresh chat card, same as adding it the first time —
    // an explicit `value` in the same payload still wins below if both are sent.
    if (payload.reroll) {
      const token = entry.tokenId ? tokens.byId(entry.tokenId) : undefined;
      const character = token?.characterId ? characters.byId(token.characterId) : undefined;
      const expr = character ? systemFor(character.system).initiativeExpr(character.sheet) : '1d20';
      const breakdown = roll(expr);
      entry.value = breakdown.total;
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'roll',
        text: `${entry.name}: initiative (re-roll)`, roll: breakdown, recipients: null,
      });
      io.to(entry.hidden ? dmRoom(d.campaignId) : campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    }
    if (payload.value !== undefined) entry.value = payload.value;
    if (payload.hidden !== undefined) entry.hidden = payload.hidden;
    if (payload.name !== undefined) entry.name = payload.name;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }, 'INIT_UPDATE'));

  socket.on(C2S.INIT_NEXT, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    if (state.entries.length === 0) return;
    const prevChar = combatantChar(state, state.turnIdx);
    state.turnIdx++;
    if (state.turnIdx >= state.entries.length) {
      state.turnIdx = 0;
      state.round++;
      redealRoundCards(io, d.campaignId, state);
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    finishTurnTransition(io, d.campaignId, state, prevChar);
  }, 'INIT_NEXT'));

  /**
   * A player ends their OWN character's turn. Same advance as INIT_NEXT, but
   * authorised against the combatant currently up rather than the DM role —
   * and only for whoever controls them, so nobody can skip someone else's turn.
   */
  socket.on(C2S.INIT_END_TURN, safe(socket, () => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    if (!state.active || state.entries.length === 0) return;
    const current = state.entries[state.turnIdx];
    if (!current) return;
    if (d.role !== 'dm') {
      const tok = current.tokenId ? tokens.byId(current.tokenId) : undefined;
      const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
      if (!ch || ch.ownerUserId !== d.userId) {
        emitError(socket, "It isn't your turn.");
        return;
      }
    }
    const prevChar = combatantChar(state, state.turnIdx);
    state.turnIdx++;
    if (state.turnIdx >= state.entries.length) {
      state.turnIdx = 0;
      state.round++;
      redealRoundCards(io, d.campaignId, state);
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    finishTurnTransition(io, d.campaignId, state, prevChar);
    const next = state.entries[state.turnIdx];
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      // Two lines: who finished, then who is up. One run-on sentence buried
      // the handover, which is the half people actually need to read.
      // .chat-text is pre-wrap, so the newline survives to the log.
      text: `⏭ ${current.name} ends their turn\n⏭ ${next?.name ?? '—'} is up (Round ${state.round}).`,
      roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_END_TURN'));

  /**
   * SWADE Soak: spend a Benny, roll Vigor, and the success plus each raise
   * removes one of the wounds just taken. Soaking every one of them shakes
   * off the Shaken too, and dropping back to MAX_WOUNDS or fewer stands an
   * incapacitated Wild Card back up. The offer was recorded when the wounds
   * landed; it expires if ignored.
   */
  socket.on(C2S.SOAK_ROLL, safe(socket, ({ characterId, spend }: SoakRollPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    const offer = takeSoakOffer(characterId);
    if (!offer) return;
    if (!spend) return; // declined — the wounds stand
    const bennies = num(ch.sheet, 'bennies', 0);
    if (bennies <= 0) return;
    // The new wounds do not penalise the roll to soak them: offset the wound
    // penalty by the wounds in this offer.
    const expr = traitExpr(ch.sheet, dieSides(String(ch.sheet.vigor ?? 'd4')), offer.wounds);
    // Soaking spends a Benny outside the Benny menu, so it needs the coin
    // flipped here too — otherwise the one use that most deserves the
    // table's attention would be the one it never sees. The chip is spent and
    // announced now; the Vigor dice wait for the coin to land, so the two
    // animations take their turn instead of talking over each other.
    flipBenny(io, d.campaignId, ch.name, 'to Soak Wounds');
    persistSheet(io, d.campaignId, ch, { bennies: bennies - 1 });
    postStatusLine(io, d.campaignId, `🪙 ${ch.name} spends a Benny to Soak ${offer.wounds} Wound${offer.wounds === 1 ? '' : 's'}.`);
    setTimeout(() => soakAfterCoin(io, d, ch.id, offer.wounds, expr), BENNY_FLIP_MS);
  }, 'SOAK_ROLL'));

  /** The Vigor roll a Soak buys, made once the coin has finished flipping. */
  function soakAfterCoin(
    io2: Server, d: ReturnType<typeof requireCampaign>, chId: string, offerWounds: number, expr: string,
  ): void {
    const ch = characters.byId(chId);
    if (!ch) return;
    const breakdown = roll(expr);
    const { removed, woundsAfter } = applySoakResult(io2, d.campaignId, ch, offerWounds, breakdown.total, 0);
    // The Soak is a Vigor roll like any other, and the book lets a Benny
    // reroll it. Recorded with the offer so the reroll can take MORE wounds
    // off this same attack rather than just print a better number.
    recordSoakRoll(io2, d.campaignId, characters.byId(ch.id) ?? ch, expr, breakdown.total, offerWounds, removed);
    const text = removed > 0
      ? `${ch.name} Soaks — ${removed} Wound${removed === 1 ? '' : 's'} soaked (now ${woundsAfter})${removed === offerWounds ? ', no longer Shaken' : ''}`
      : `${ch.name} Soaks — the Vigor roll fails, the wounds stand`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: ch.name, characterId: ch.id, kind: 'roll', text,
      roll: { ...breakdown, outcome: removed > 0 ? 'success' as const : 'failure' as const }, recipients: null,
      callout: { what: 'Soaking Wounds — Vigor', tone: 'benny' },
    });
    io2.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }

  /**
   * Answer the live grenade at your feet. The blast is parked mid-resolution
   * waiting on this, so every path through here MUST end in either a resumed
   * blast or a still-running fuse — a return that does neither leaves the
   * grenade hanging until the grace period bails it out.
   */
  socket.on(C2S.BLAST_RESPONSE, safe(socket, ({ blastId, characterId, choice }: BlastResponsePayload) => {
    const d = requireCampaign(socket);
    const pb = pendingBlasts.get(blastId);
    // Already settled by someone faster, or the fuse ran out mid-click.
    if (!pb || pb.settled || pb.campaignId !== d.campaignId) return;
    const cand = [...pb.candidates.values()].find((c) => c.characterId === characterId);
    if (!cand) { emitError(socket, 'That character is not standing in the blast.'); return; }
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) {
      emitError(socket, 'You can only answer for your own character.');
      return;
    }

    if (choice === 'none') {
      // Standing fast is not a claim on the grenade — it only drops this one
      // out of the queue. The blast waits for the others, or for the fuse.
      pb.candidates.delete(cand.tokenId);
      if (pb.candidates.size === 0 && claimBlast(io, pb)) pb.resume({});
      return;
    }

    if (choice === 'cover') {
      if (!claimBlast(io, pb)) return;
      const toughness = Math.round(Number(systemFor(ch.system).derive(ch.sheet).toughness)) || 4;
      // No roll to make — you either lie on it or you don't. runGroupSave
      // posts the line, doubles their damage and shields everyone else.
      pb.resume({ cover: { tokenId: cand.tokenId, name: cand.name, toughness } });
      return;
    }

    // Hot Potato: snatch it up and hurl it back. One attempt for the whole
    // blast — claiming it here is what makes it "one attempt only".
    if (!claimBlast(io, pb)) return;
    const br = roll(traitExpr(ch.sheet, skillDie(ch.sheet, 'Athletics'), cand.potatoMod));
    const critFail = critFailFor(io, d.campaignId, ch, br.dice);
    const caught = !critFail && br.total >= 4;
    const holdTag = cand.onHold ? ' on Hold' : '';

    let mod: BlastMod = {};
    let text: string;
    if (critFail) {
      // Fumbled the catch — it goes off in their hand, exactly as a botched
      // cook does: re-centred on them, at damage as if thrown with a raise.
      const tok = tokens.byId(cand.tokenId);
      if (tok) mod = { aimHex: { q: tok.q, r: tok.r } };
      // Damage as if thrown with a raise, the same as a botched cook.
      mod.damageExpr = usableAmount(pb.damageExpr) ? `${pb.damageExpr}+1d6!` : pb.damageExpr;
      text = `${cand.name} grabs at ${pb.label} (Athletics ${fmtMod(cand.potatoMod)}${holdTag}) — CRITICAL FAILURE: it goes off in their hand!`;
    } else if (caught) {
      mod = { aimHex: pb.throwerHex };
      text = `🤾 ${cand.name} snatches ${pb.label} up and hurls it back (Athletics ${fmtMod(cand.potatoMod)}${holdTag}) — it lands back at ${pb.throwerName}'s feet!`;
    } else {
      text = `${cand.name} fumbles for ${pb.label} (Athletics ${fmtMod(cand.potatoMod)}${holdTag}) and can't get hold of it in time.`;
    }
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
      text, roll: { ...br, outcome: caught ? 'success' as const : 'failure' as const }, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    // Let the catch roll land on screen before the thing detonates.
    setTimeout(() => pb.resume(mod), diceSettleDelayMs(br.dice));
  }, 'BLAST_RESPONSE'));

  // A Shaken combatant answers the prompt: make the Spirit roll now.
  socket.on(C2S.SHAKEN_ROLL, safe(socket, ({ characterId }: ShakenRollPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    if (!conditionsOf(ch.sheet).includes('shaken')) return;
    resolveShakenRecovery(io, d.campaignId, ch);
  }, 'SHAKEN_ROLL'));

  // A Bleeding Out player answers the prompt: make the Vigor roll now.
  socket.on(C2S.BLEED_ROLL, safe(socket, ({ characterId }: BleedRollPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    // Healed (or already stabilized) since the prompt went out? Nothing owed.
    if (!conditionsOf(ch.sheet).includes('bleeding')) return;
    resolveBleedingOut(io, d.campaignId, ch);
  }, 'BLEED_ROLL'));

  // SWADE Aim: the whole turn spent drawing a bead — stationary, nothing
  // else done first. Pays out on the FIRST action of the next turn.
  socket.on(C2S.COMBAT_AIM, safe(socket, ({ characterId, tokenId }: CombatAimPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    const tok = tokens.byId(tokenId);
    if (!tok || tok.characterId !== ch.id) return;
    if (conditionsOf(ch.sheet).includes('aiming')) { emitError(socket, `${ch.name} is already aiming.`); return; }
    if (conditionCombat(conditionsOf(ch.sheet)).incapacitated || conditionsOf(ch.sheet).includes('shaken')) {
      emitError(socket, `${ch.name} is in no state to aim.`);
      return;
    }
    const combat = initiative.get(d.campaignId).active;
    if (combat) {
      if (movedThisTurn(d.campaignId, tok.id)) {
        emitError(socket, 'Aiming means standing perfectly still — this token has already moved this turn.');
        return;
      }
      if ((swadeActionCounts.get(d.campaignId)?.get(ch.id) ?? 0) > 0) {
        emitError(socket, 'Aiming takes the whole turn — it must be the only thing done.');
        return;
      }
    }
    persistSheet(io, d.campaignId, ch, { conditions: [...conditionsOf(ch.sheet), 'aiming'] });
    setAimState(d.campaignId, ch.id, combat ? 'fresh' : 'ready');
    postStatusLine(io, d.campaignId, combat
      ? `🎯 ${ch.name} takes aim — the rest of the turn is spent drawing a bead.`
      : `🎯 ${ch.name} takes aim.`);
  }, 'COMBAT_AIM'));

  // A Stunned combatant answers the prompt: make the free Vigor roll now.
  socket.on(C2S.STUN_ROLL, safe(socket, ({ characterId }: StunRollPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    if (!conditionsOf(ch.sheet).includes('stunned')) return;
    resolveStunRecovery(io, d.campaignId, ch);
  }, 'STUN_ROLL'));

  // A downed Wild Card faces the music: the Incapacitation Vigor roll.
  socket.on(C2S.INCAP_ROLL, safe(socket, ({ characterId }: IncapRollPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    // Soaked back up (or healed) since the window opened? Nothing owed.
    if (!conditionsOf(ch.sheet).includes('incapacitated')) return;
    resolveIncapacitation(io, d.campaignId, ch);
  }, 'INCAP_ROLL'));

  // DM skips the Incapacitation roll for one of their own Wild Cards and
  // takes it straight out of the fight.
  socket.on(C2S.INCAP_DEATH, safe(socket, ({ characterId }: IncapDeathPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can call a death outright.'); return; }
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (!conditionsOf(ch.sheet).includes('incapacitated')) return;
    const conds = [...new Set([...conditionsOf(ch.sheet).filter((c) => c !== 'bleeding'), 'dead'])];
    persistSheet(io, d.campaignId, ch, { conditions: conds, hp: 0 });
    postStatusLine(io, d.campaignId, `💀 ${ch.name} has died.`);
  }, 'INCAP_DEATH'));

  // DM hands a character a Benny — always a public moment, so it's announced.
  socket.on(C2S.BENNY_AWARD, safe(socket, ({ characterId }: BennyAwardPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM hands out Bennies.'); return; }
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    persistSheet(io, d.campaignId, ch, { bennies: num(ch.sheet, 'bennies', 0) + 1 });
    postStatusLine(io, d.campaignId, `🪙 The DM awards ${ch.name} a Benny!`);
  }, 'BENNY_AWARD'));

  /**
   * A new session. Bennies are drawn fresh at the start of one and discarded
   * at the end — they are not a resource that carries over, and a table that
   * never resets them slowly drifts into either poverty or a hoard.
   *
   * Heroes draw three plus their Luck Edges. NPC Wild Cards get the two the
   * book allots them. The GM's own pool refills to one per player character.
   * Fatigue clears too: it is the one condition the rules expect a night's
   * rest to mend, and a new session is at least that.
   */
  socket.on(C2S.SESSION_START, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM starts a session.'); return; }
    const campaign = campaigns.byId(d.campaignId)!;
    if (campaign.system !== 'swade') { emitError(socket, 'Bennies are a SWADE thing.'); return; }
    const all = characters.forCampaign(d.campaignId).filter((c) => c.system === 'swade');
    const heroes = all.filter((c) => c.ownerUserId);
    for (const ch of heroes) {
      persistSheet(io, d.campaignId, ch, { bennies: swadeBennyMax(ch.sheet), fatigue: 0 });
    }
    for (const ch of all.filter((c) => !c.ownerUserId && c.sheet.wildCard !== false)) {
      persistSheet(io, d.campaignId, ch, { bennies: 2, fatigue: 0 });
    }
    const pool = campaigns.setGmBennies(d.campaignId, heroes.length);
    postStatusLine(io, d.campaignId,
      `🪙 A new session begins. ${heroes.length} hero${heroes.length === 1 ? '' : 'es'} draw a fresh hand of Bennies;`
      + ` the GM's pool holds ${pool}.`);
  }, 'SESSION_START'));

  // The Benny menu: every automatable use from the SWADE Benny table. Soak
  // rides the existing SOAK_ROLL flow; everything else lands here.
  socket.on(C2S.BENNY_USE, safe(socket, ({ characterId, use }: BennyUsePayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) {
      emitError(socket, 'That is not your character.');
      return;
    }
    const bennies = num(ch.sheet, 'bennies', 0);
    if (bennies <= 0) {
      emitError(socket, `${ch.name} has no Bennies left.`);
      return;
    }
    const spendBenny = (extra: Record<string, unknown> = {}): Character => {
      // Every use funnels through here, so this is the one place the coin has
      // to be flipped from — no way to spend a Benny without the table seeing it.
      flipBenny(io, d.campaignId, ch.name, BENNY_REASON[use] ?? 'to change their fate');
      return persistSheet(io, d.campaignId, characters.byId(ch.id) ?? ch,
        { bennies: num((characters.byId(ch.id) ?? ch).sheet, 'bennies', 0) - 1, ...extra });
    };
    const postRoll = (text: string, breakdown: ReturnType<typeof roll>, ok: boolean, what = 'a Benny reroll') => {
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: ch.name, characterId: ch.id, kind: 'roll', text,
        roll: { ...breakdown, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
        callout: { what, tone: 'benny' as const },
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    };

    switch (use) {
      case 'recover-shaken': {
        // Spending a Benny removes Shaken outright — no roll needed.
        if (!conditionsOf(ch.sheet).includes('shaken')) {
          emitError(socket, `${ch.name} isn't Shaken.`);
          return;
        }
        spendBenny({ conditions: conditionsOf(ch.sheet).filter((c) => c !== 'shaken') });
        postStatusLine(io, d.campaignId, `🪙 ${ch.name} spends a Benny and is no longer Shaken.`);
        break;
      }
      case 'reroll-trait':
      case 'reroll-damage': {
        const kind = use === 'reroll-trait' ? 'trait' as const : 'damage' as const;
        const rec = takeBennyRoll(ch.id, kind);
        if (!rec) {
          emitError(socket, `No recent ${kind} roll to reroll.`);
          return;
        }
        // A Critical Failure ends the attempt and must be accepted — the one
        // thing a Benny cannot buy back. Refused before the chip is spent.
        if (rec.critFail) {
          emitError(socket, 'A Critical Failure cannot be rerolled — not even with a Benny.');
          return;
        }
        spendBenny();
        // Spending the chip and making the roll are two moments, so they get
        // two lines and two animations. The coin is thrown now and says what
        // it bought; the dice wait until it has landed and faded, because two
        // animations playing over each other is two nobody watches.
        postStatusLine(io, d.campaignId, `🪙 ${ch.name} spends a Benny to reroll ${rec.label}.`);
        setTimeout(() => {
          const now = characters.byId(ch.id);
          if (!now) return;
          const b = roll(rec.expr);
          const better = b.total > rec.total;
          // A Soak reroll is not just a better number on a card: the same
          // attack's Wounds come off for real. Keep whichever roll went
          // further, apply only what the first one did not, and re-record so
          // a second Benny can push it further still.
          if (rec.soak) {
            const best = Math.max(rec.total, b.total);
            const { removed, woundsAfter } = applySoakResult(
              io, d.campaignId, now, rec.soak.offerWounds, best, rec.soak.removed,
            );
            const gained = removed - rec.soak.removed;
            recordSoakRoll(io, d.campaignId, characters.byId(now.id) ?? now, rec.expr, best, rec.soak.offerWounds, removed);
            postRoll(
              `${now.name} rerolls the Soak — ${b.total} vs the original ${rec.total}: `
              + (gained > 0
                ? `${gained} more Wound${gained === 1 ? '' : 's'} soaked (now ${woundsAfter})`
                : 'no better — the wounds stand'),
              b, gained > 0, 'rerolling the Soak — Vigor',
            );
            return;
          }
          const rerollCrit = kind === 'trait' && critFailFor(io, d.campaignId, now, b.dice);
          // The reroll stands beside the original; whichever is higher counts.
          recordBennyRoll(io, d.campaignId, now, kind, rec.expr, Math.max(rec.total, b.total), rec.label, rerollCrit);
          postRoll(
            `${now.name} rerolls ${rec.label} — ${b.total} vs the original ${rec.total}: ${better ? 'the reroll counts!' : 'keep the original.'}`,
            b, better, `rerolling ${rec.label}`,
          );
        }, BENNY_FLIP_MS);
        break;
      }
      case 'redraw-card': {
        const state = initiative.get(d.campaignId);
        if (!state.active || !state.cardMode) {
          emitError(socket, 'No action cards are in play.');
          return;
        }
        const entry = state.entries.find((e) => {
          const t = e.tokenId ? tokens.byId(e.tokenId) : undefined;
          return t?.characterId === ch.id;
        });
        if (!entry) {
          emitError(socket, `${ch.name} isn't in the initiative order.`);
          return;
        }
        if (!state.deck || state.deck.length === 0) state.deck = shuffleDeck(buildDeck());
        const card = state.deck.shift()!;
        if (card.rank === 15) state.jokerDealt = true;
        const redrawJoker = card.rank === 15;
        state.drawCounter = (state.drawCounter ?? 0) + 1;
        const currentId = state.entries[state.turnIdx]?.id;
        entry.card = card;
        entry.value = card.rank;
        entry.drawSeq = state.drawCounter;
        state.entries.sort(compareCardEntries);
        // Re-sorting must not steal the current combatant's turn.
        const keep = state.entries.findIndex((e) => e.id === currentId);
        if (keep >= 0) state.turnIdx = keep;
        flagChaseComplications(io, d.campaignId, state);
        initiative.set(d.campaignId, state);
        spendBenny();
        broadcastInitiative(io, d.campaignId);
        // A Joker bought with a Benny still turns the whole table's luck.
        if (redrawJoker) jokersWild(io, d.campaignId, ch.name, !!ch.ownerUserId);
        const msg = chat.add(d.campaignId, {
          userId: d.userId, fromName: d.username, kind: 'system',
          text: `🂠 ${ch.name} spends a Benny to redraw — draws the ${cardName(card)} ${cardShort(card)}`,
          roll: null, recipients: null,
        });
        const room = entry.hidden ? dmRoom(d.campaignId) : campaignRoom(d.campaignId);
        io.to(room).emit(S2C.CHAT, { msg });
        // Same table theater as any draw: the card flips over on screen.
        io.to(room).emit(S2C.INIT_CARD_DRAWN, { tokenId: entry.tokenId, name: ch.name, card, byUserId: d.userId });
        break;
      }
      case 'regain-pp': {
        const maxPp = num(ch.sheet, 'maxPp', 10);
        const pp = num(ch.sheet, 'pp', 0);
        if (pp >= maxPp) {
          emitError(socket, `${ch.name}'s Power Points are already full.`);
          return;
        }
        const after = Math.min(maxPp, pp + 5);
        spendBenny({ pp: after });
        postStatusLine(io, d.campaignId, `🪙 ${ch.name} spends a Benny to regain 5 Power Points (${pp} → ${after}).`);
        break;
      }
      case 'influence': {
        spendBenny();
        postStatusLine(io, d.campaignId, `🎭 ${ch.name} spends a Benny to influence the story.`);
        break;
      }
    }
  }, 'BENNY_USE'));

  // Hold: skip your turn now, keeping the right to jump back in later.
  socket.on(C2S.INIT_HOLD, safe(socket, () => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    if (!state.active || state.entries.length === 0) return;
    const current = state.entries[state.turnIdx];
    if (!current) return;
    if (d.role !== 'dm') {
      const tok = current.tokenId ? tokens.byId(current.tokenId) : undefined;
      const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
      if (!ch || ch.ownerUserId !== d.userId) { emitError(socket, "It isn't your turn."); return; }
    }
    current.held = true;
    const prevChar = combatantChar(state, state.turnIdx);
    const prevIdx = state.turnIdx;
    state.turnIdx = (state.turnIdx + 1) % state.entries.length;
    if (state.turnIdx === 0 && prevIdx === state.entries.length - 1) {
      state.round++;
      redealRoundCards(io, d.campaignId, state);
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    finishTurnTransition(io, d.campaignId, state, prevChar);
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `⏸ ${current.name} holds their action.`, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_HOLD'));

  // A held combatant interrupts: they become the current turn right now.
  socket.on(C2S.INIT_ACT_NOW, safe(socket, ({ entryId }: { entryId: string }) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    if (!state.active) return;
    const idx = state.entries.findIndex((e) => e.id === entryId && e.held);
    if (idx < 0) return;
    const entry = state.entries[idx];
    if (d.role !== 'dm') {
      const tok = entry.tokenId ? tokens.byId(entry.tokenId) : undefined;
      const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
      if (!ch || ch.ownerUserId !== d.userId) { emitError(socket, 'You can only act for your own character.'); return; }
    }
    entry.held = false;
    state.entries.splice(idx, 1);
    const insertAt = idx < state.turnIdx ? state.turnIdx - 1 : state.turnIdx;
    state.entries.splice(insertAt, 0, entry);
    state.turnIdx = insertAt;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `▶ ${entry.name} stops holding and acts now!`, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    // Their turn begins: run the usual start-of-turn recovery checks.
    const tok = entry.tokenId ? tokens.byId(entry.tokenId) : undefined;
    const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
    if (ch?.system === 'swade') startOfTurnRecovery(io, d.campaignId, ch);
  }, 'INIT_ACT_NOW'));

  socket.on(C2S.INIT_PREV, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    if (state.entries.length === 0) return;
    state.turnIdx--;
    if (state.turnIdx < 0) {
      state.turnIdx = state.entries.length - 1;
      state.round = Math.max(1, state.round - 1);
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }, 'INIT_PREV'));

  socket.on(C2S.INIT_SORT, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    if (state.cardMode) state.entries.sort(compareCardEntries);
    else state.entries.sort((a, b) => b.value - a.value);
    state.turnIdx = 0;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }, 'INIT_SORT'));

  /**
   * The GM moves the world's clock forward.
   *
   * One intent for every scale, because every time-based rule in SWADE is the
   * same question asked at a different magnitude: how much has passed, and
   * what has that cost or mended. Each effect below decides for itself
   * whether this passage is enough to matter to it.
   *
   * Rounds are refused while combat is running: the initiative tracker is
   * already advancing them, and two things ticking durations means every
   * power runs out twice as fast.
   */
  socket.on(C2S.ADVANCE_TIME, safe(socket, ({ step }: AdvanceTimePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM moves the clock.'); return; }
    const spec = TIME_STEPS.find((t) => t.id === step);
    if (!spec) return;
    if (spec.id === 'round' && initiative.get(d.campaignId).active) {
      emitError(socket, 'Combat is running — the initiative tracker advances rounds.');
      return;
    }
    const before = campaigns.clockSeconds(d.campaignId);
    const after = campaigns.setClockSeconds(d.campaignId, before + spec.seconds);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CLOCK, { seconds: after });
    const notes = applyTimePassage(io, d.campaignId, spec.seconds, after);
    const card: SheetCard = {
      name: `⏱ ${spec.label} passes`,
      theme: 'card-info',
      chips: [{ text: clockLabel(after), tone: 'qty' }],
      notes: notes.length ? notes : ['Nothing on anyone’s sheet was waiting on the clock.'],
    };
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `⏱ ${spec.label} passes — ${clockLabel(after)}${notes.length ? `. ${notes.join(' ')}` : '.'}`,
      card, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'ADVANCE_TIME'));

  socket.on(C2S.VEHICLE_OOC_ROLL, safe(socket, ({ characterId, roll: shouldRoll }: VehicleOocRollPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    if (!takeOocOffer(characterId)) return;
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    if (!shouldRoll) {
      postStatusLine(io, d.campaignId, `🌀 ${ch.name}'s driver wrestles it back under control.`);
      return;
    }
    resolveOutOfControl(io, d.campaignId, ch);
  }, 'VEHICLE_OOC_ROLL'));

  socket.on(C2S.HEALING_ROLL, safe(socket, ({ roll: shouldRoll }: HealingRollPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    runNaturalHealing(io, d.campaignId, !!shouldRoll);
  }, 'HEALING_ROLL'));

  socket.on(C2S.AFTERMATH_ROLL, safe(socket, ({ roll: shouldRoll }: AftermathRollPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    aftermathForExtras(io, d.campaignId, !!shouldRoll);
  }, 'AFTERMATH_ROLL'));

  /**
   * Start a chase.
   *
   * The track is a row of Chase Cards from a SECOND deck — it is scenery for
   * distance, not initiative, and drawing it from the action deck would foul
   * both. Everyone starts on the rearmost card; who is really ahead is the
   * GM's to arrange with a few Change Positions before the first round.
   *
   * A chase does not replace the fight. It deals Action Cards and runs on
   * this same tracker, which is exactly why a chase can contain attacks,
   * powers and Tests — the track only answers "how far apart is everyone".
   */
  socket.on(C2S.CHASE_START, safe(socket, ({ tokenIds, incrementId, trackLength }: ChaseStartPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM starts a chase.'); return; }
    const state = initiative.get(d.campaignId);
    const length = Math.max(3, Math.min(20, trackLength ?? CHASE_TRACK_DEFAULT));
    const track = shuffleDeck(buildDeck()).slice(0, length);

    const participants: ChaseParticipant[] = [];
    for (const tokenId of tokenIds) {
      const tok = tokens.byId(tokenId);
      if (!tok) continue;
      const ch = tok.characterId ? characters.byId(tok.characterId) : undefined;
      // Everyone in the chase needs a slot in the turn order; add anyone the
      // DM picked who is not already in it.
      let entry = state.entries.find((e) => e.tokenId === tokenId);
      if (!entry) {
        entry = {
          id: newId(), tokenId, name: tok.name, value: 0, hidden: tok.layer === 'gm',
          ownerUserId: ch?.ownerUserId ?? null, color: tok.color ?? null,
        };
        state.entries.push(entry);
      }
      // What they are travelling IN decides both the skill and the Top Speed:
      // the vehicle they are aboard if any, otherwise their own legs.
      const mount = tok.mountedOn ? tokens.byId(tok.mountedOn) : null;
      const mountCh = mount?.characterId ? characters.byId(mount.characterId) : undefined;
      const vehicleSheet = mountCh && isVehicle(mountCh.sheet) ? mountCh.sheet
        : ch && isVehicle(ch.sheet) ? ch.sheet : null;
      participants.push({
        entryId: entry.id, tokenId, name: tok.name, cardIdx: 0,
        maneuverSkill: vehicleSheet ? maneuveringSkillFor(vehicleSheet) : mount ? 'Riding' : 'Athletics',
        topSpeed: vehicleSheet ? num(vehicleSheet, 'topSpeed', 0) : 0,
        color: tok.color ?? null,
      });
    }
    if (participants.length === 0) { emitError(socket, 'Pick at least one token for the chase.'); return; }

    state.chase = { incrementId, track, participants };
    state.active = true;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    postStatusLine(io, d.campaignId,
      `🏁 A chase begins — ${participants.length} in it, ${length} Chase Cards laid out, ${chaseIncrement(incrementId)} yards a card.`);
  }, 'CHASE_START'));

  socket.on(C2S.CHASE_END, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    if (!state.chase) return;
    delete state.chase;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    postStatusLine(io, d.campaignId, '🏁 The chase is over.');
  }, 'CHASE_END'));

  /**
   * Change Position, or drop back.
   *
   * The roll is the participant's own maneuvering skill — Driving at the
   * wheel, Boating at the tiller, Athletics on foot — plus the vehicle's
   * Handling, plus the Speed Bonus for having the better machine, plus 2 if
   * they spend their ACTION on it rather than taking it free. Success moves
   * one card, a raise two.
   *
   * Dropping back needs no roll and is the reason a chase has a rear:
   * anyone may fall away deliberately, and then may not manoeuvre again.
   */
  socket.on(C2S.CHASE_MOVE, safe(socket, ({ entryId, mode, direction }: ChaseMovePayload) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    const chase = state.chase;
    if (!chase) { emitError(socket, 'No chase is running.'); return; }
    const me = chase.participants.find((p) => p.entryId === entryId);
    if (!me) return;
    const tok = me.tokenId ? tokens.byId(me.tokenId) : null;
    const ch = tok?.characterId ? characters.byId(tok.characterId) : undefined;
    if (d.role !== 'dm' && !(ch && ch.ownerUserId === d.userId)) {
      emitError(socket, 'That is not yours to drive.');
      return;
    }
    if (me.movedThisTurn) { emitError(socket, `${me.name} has already changed position this turn.`); return; }

    if (mode === 'dropBack') {
      me.cardIdx = clampToTrack(me.cardIdx - 1, chase.track.length);
      me.movedThisTurn = true;
      initiative.set(d.campaignId, state);
      broadcastInitiative(io, d.campaignId);
      postStatusLine(io, d.campaignId, `${me.name} drops back a Chase Card — no roll, and no more manoeuvring this turn.`);
      return;
    }

    // Handling under them and the Speed Bonus for the better machine ride
    // every maneuvering roll; spending the ACTION on it adds the book's +2.
    const { mod: baseMod, tags } = maneuverMods(chase, me, ch);
    let mod = baseMod;
    if (mode === 'action') { mod += 2; tags.push('+2 as an action'); }

    const sheet = ch?.sheet ?? {};
    const br = roll(traitExpr(sheet, skillDie(sheet, me.maneuverSkill), mod));
    const out = changePosition(br.total);
    const step = direction === 'forward' ? 1 : -1;
    if (out.success) me.cardIdx = clampToTrack(me.cardIdx + step * out.cards, chase.track.length);
    me.movedThisTurn = true;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);

    const where = direction === 'forward' ? 'ahead' : 'back';
    const text = `${me.name} — ${me.maneuverSkill} to Change Position${tags.length ? ` [${tags.join(', ')}]` : ''}: `
      + (out.success
        ? `${out.cards} card${out.cards === 1 ? '' : 's'} ${where}${out.raise ? ' (raise!)' : ''}`
        : 'no ground gained');
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: ch?.name ?? me.name,
      characterId: ch?.id ?? null, kind: 'roll', text,
      roll: { ...br, outcome: out.success ? 'success' as const : 'failure' as const }, recipients: null,
      callout: { what: `${me.maneuverSkill} — Change Position`, tone: 'trait' },
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    // Manoeuvring badly wrong is its own disaster, and what kind depends on
    // what you are travelling in.
    if (!out.success && ch && critFailFor(io, d.campaignId, ch, br.dice)) {
      setTimeout(() => {
        const live = initiative.get(d.campaignId);
        const pNow = live.chase?.participants.find((x) => x.entryId === me.entryId);
        if (!live.chase || !pNow) return;
        runChaseCritFailure(io, d.campaignId, live.chase, pNow, characters.byId(ch.id) ?? ch);
        initiative.set(d.campaignId, live);
        broadcastInitiative(io, d.campaignId);
      }, diceSettleDelayMs(br.dice));
    }
  }, 'CHASE_MOVE'));

  /**
   * A chase maneuver: everything you can spend the turn's ACTION on while the
   * track is out. Change Position is free and lives above; these cost the
   * action, one per turn, which is why they are gated on `actedThisTurn`
   * rather than on the free maneuver's own flag.
   *
   * Reach is checked here and not on the button: the client draws what it
   * thinks is possible, but the track is the server's.
   */
  socket.on(C2S.CHASE_ACTION, safe(socket, ({ entryId, action, targetEntryId }: ChaseActionPayload) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    const chase = state.chase;
    if (!chase) { emitError(socket, 'No chase is running.'); return; }
    const me = chase.participants.find((p) => p.entryId === entryId);
    const spec = chaseAction(action);
    if (!me || !spec) return;
    const myTok = me.tokenId ? tokens.byId(me.tokenId) : null;
    const myChar = myTok?.characterId ? characters.byId(myTok.characterId) : undefined;
    if (d.role !== 'dm' && !(myChar && myChar.ownerUserId === d.userId)) {
      emitError(socket, 'That is not yours to drive.');
      return;
    }
    if (me.actedThisTurn) { emitError(socket, `${me.name} has already spent this turn's action.`); return; }

    const target = targetEntryId ? chase.participants.find((p) => p.entryId === targetEntryId) ?? null : null;
    if (spec.reach !== null) {
      if (!target || target === me) { emitError(socket, `${spec.label} needs someone to do it to.`); return; }
      const gap = Math.abs(target.cardIdx - me.cardIdx);
      if (gap > spec.reach) {
        emitError(socket, `${target.name} is ${gap} Chase Card${gap === 1 ? '' : 's'} away — ${spec.label} reaches `
          + (spec.reach === 0 ? 'only your own card.' : 'one card.'));
        return;
      }
    }
    const targetTok = target?.tokenId ? tokens.byId(target.tokenId) : null;
    const targetChar = targetTok?.characterId ? characters.byId(targetTok.characterId) : undefined;
    const myVehicle = vehicleUnder(myTok);
    const targetVehicle = vehicleUnder(targetTok);

    const sheet = myChar?.sheet ?? {};
    const base = maneuverMods(chase, me, myChar);
    /** This participant's maneuvering roll, with whatever this action adds. */
    const rollMine = (extraMod = 0, extraTags: string[] = []) => ({
      br: roll(traitExpr(sheet, skillDie(sheet, me.maneuverSkill), base.mod + extraMod)),
      tags: [...base.tags, ...extraTags],
    });
    /** …and the other side's, for the opposed ones. */
    const rollTheirs = () => {
      const tsheet = targetChar?.sheet ?? {};
      const tb = target ? maneuverMods(chase, target, targetChar) : { mod: 0, tags: [] as string[] };
      const skill = target?.maneuverSkill ?? 'Athletics';
      return { br: roll(traitExpr(tsheet, skillDie(tsheet, skill), tb.mod)), tags: tb.tags };
    };
    const commit = () => { initiative.set(d.campaignId, state); broadcastInitiative(io, d.campaignId); };
    const postRollCard = (
      who: Character | undefined, name: string, what: string, text: string,
      br: ReturnType<typeof roll>, ok: boolean,
    ) => {
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: who?.name ?? name,
        characterId: who?.id ?? null, kind: 'roll', text,
        roll: { ...br, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
        callout: { what, tone: 'trait' },
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    };
    /**
     * The roll a driver makes to keep hold of it after being forced or rammed.
     * Posted as a line rather than an animated card: one action should not
     * queue five throws on everybody's screen, and the throw that mattered was
     * the one that put them in this position.
     */
    const controlCheck = (p: ChaseParticipant, ch: Character | undefined, vehicle: Character | null, mod: number) => {
      const psheet = ch?.sheet ?? {};
      const mods = maneuverMods(chase, p, ch);
      const br = roll(traitExpr(psheet, skillDie(psheet, p.maneuverSkill), mods.mod + mod));
      const held = br.total >= 4;
      postStatusLine(io, d.campaignId,
        `${p.name} fights for control — ${p.maneuverSkill} ${br.total} vs 4${mod ? ` (${mod})` : ''}: ${held ? 'held it.' : 'lost it!'}`);
      if (held) return;
      if (vehicle) resolveOutOfControl(io, d.campaignId, vehicle);
      else if (ch) applyConditionTo(io, d.campaignId, ch, 'distracted', 'thrown off their stride');
    };
    /**
     * A maneuvering roll of this actor's that went badly wrong. Routed by what
     * they are travelling in, and only ever after its own dice have landed.
     */
    const critCheck = (br: ReturnType<typeof roll>) => {
      if (!myChar || !critFailFor(io, d.campaignId, myChar, br.dice)) return;
      setTimeout(() => {
        const live = initiative.get(d.campaignId);
        const pNow = live.chase?.participants.find((x) => x.entryId === me.entryId);
        if (!live.chase || !pNow) return;
        runChaseCritFailure(io, d.campaignId, live.chase, pNow, characters.byId(myChar.id) ?? myChar);
        initiative.set(d.campaignId, live);
        broadcastInitiative(io, d.campaignId);
      }, diceSettleDelayMs(br.dice));
    };

    if (action === 'evade') {
      me.evading = true;
      me.actedThisTurn = true;
      commit();
      postStatusLine(io, d.campaignId,
        `〰️ ${me.name} drives evasively — −2 to attacks against them until their next turn, and −2 to their own.`);
      return;
    }

    if (action === 'holdSteady') {
      if (!myVehicle) { emitError(socket, `${me.name} is not driving anything to hold steady.`); return; }
      const { br, tags } = rollMine();
      const ok = br.total >= 4;
      if (ok) me.steadied = true;
      me.actedThisTurn = true;
      commit();
      postRollCard(myChar, me.name, `${me.maneuverSkill} — Hold Steady`,
        `${me.name} — ${me.maneuverSkill} to hold ${myVehicle.name} steady${tags.length ? ` [${tags.join(', ')}]` : ''}: `
        + (ok ? 'smooth as glass — nobody aboard suffers Unstable Platform this round.' : 'the ride stays rough (−2 to shoot from it).'),
        br, ok);
      if (!ok) critCheck(br);
      return;
    }

    if (action === 'flee') {
      const others = chase.participants.filter((p) => p !== me);
      if (others.length === 0) { emitError(socket, 'There is nobody left to flee from.'); return; }
      const gap = Math.min(...others.map((p) => Math.abs(p.cardIdx - me.cardIdx)));
      if (!canFlee(gap)) {
        emitError(socket, `Too close to break off — ${gap} Chase Card${gap === 1 ? '' : 's'} clear, and fleeing needs four.`);
        return;
      }
      const pen = fleePenalty(gap);
      const { br, tags } = rollMine(pen, [pen ? `${pen} Flee at ${gap} cards` : 'clean away — no penalty']);
      const ok = br.total >= 4;
      me.actedThisTurn = true;
      if (ok) chase.participants = chase.participants.filter((p) => p !== me);
      commit();
      postRollCard(myChar, me.name, `${me.maneuverSkill} — Flee`,
        `${me.name} — ${me.maneuverSkill} to break off${tags.length ? ` [${tags.join(', ')}]` : ''}: `
        + (ok ? 'gone — out of the chase.' : 'still in it.'),
        br, ok);
      if (!ok) critCheck(br);
      if (ok && chase.participants.length < 2) {
        delete state.chase;
        initiative.set(d.campaignId, state);
        broadcastInitiative(io, d.campaignId);
        postStatusLine(io, d.campaignId, '🏁 Nobody left to chase — the track comes down.');
      }
      return;
    }

    // Everything past here is opposed, and the reach check above has already
    // guaranteed a target.
    if (!target) return;

    if (action === 'force') {
      const mine = rollMine();
      const theirs = rollTheirs();
      const out = opposedManeuver(mine.br.total, theirs.br.total);
      me.actedThisTurn = true;
      postRollCard(myChar, me.name, `${me.maneuverSkill} — Force`,
        `${me.name} crowds ${target.name}${mine.tags.length ? ` [${mine.tags.join(', ')}]` : ''}: `
        + (out.success
          ? `${mine.br.total} beats ${theirs.br.total}${out.raise ? ' with a raise!' : ''}`
          : `${mine.br.total} against ${theirs.br.total} — held off`),
        mine.br, out.success);
      postRollCard(targetChar, target.name, `${target.maneuverSkill} — holding the line`,
        `${target.name} refuses to give way${theirs.tags.length ? ` [${theirs.tags.join(', ')}]` : ''}: ${theirs.br.total}`,
        theirs.br, !out.success);
      if (!out.success) critCheck(mine.br);
      if (out.success) {
        target.cardIdx = clampToTrack(target.cardIdx - 1, chase.track.length);
        postStatusLine(io, d.campaignId, `${target.name} is forced back a Chase Card.`);
      }
      commit();
      // The fight for control comes AFTER the dice that caused it have landed,
      // like every other consequence in this file.
      if (out.success) {
        setTimeout(() => controlCheck(target, characters.byId(targetChar?.id ?? '') ?? targetChar, targetVehicle, out.raise ? -2 : 0),
          diceSettleDelayMs(theirs.br.dice));
      }
      return;
    }

    if (action === 'ram') {
      const mine = rollMine();
      const theirs = rollTheirs();
      const out = opposedManeuver(mine.br.total, theirs.br.total);
      me.actedThisTurn = true;
      commit();
      postRollCard(myChar, me.name, `${me.maneuverSkill} — Ram`,
        `${me.name} rams ${target.name}${mine.tags.length ? ` [${mine.tags.join(', ')}]` : ''}: `
        + (out.success
          ? `${mine.br.total} beats ${theirs.br.total} — impact!`
          : `${mine.br.total} against ${theirs.br.total} — swerved past`),
        mine.br, out.success);
      postRollCard(targetChar, target.name, `${target.maneuverSkill} — swinging clear`,
        `${target.name} tries to swing clear${theirs.tags.length ? ` [${theirs.tags.join(', ')}]` : ''}: ${theirs.br.total}`,
        theirs.br, !out.success);
      if (!out.success) { critCheck(mine.br); return; }
      const rammer = myVehicle ?? myChar ?? null;
      const victim = targetVehicle ?? targetChar ?? null;
      const dmg = ramDamage(
        { toughness: collisionToughness(rammer), size: num(rammer?.sheet ?? {}, 'size', 0) },
        { toughness: collisionToughness(victim), size: num(victim?.sheet ?? {}, 'size', 0) },
      );
      // The impact lands only once the dice that decided it have finished —
      // a token must never take damage before the table has seen why.
      setTimeout(() => {
        postStatusLine(io, d.campaignId,
          `💥 ${me.name} into ${target.name}${dmg.tag ? ` — ${dmg.tag}` : ''}: ${dmg.toTarget} damage to ${target.name}, ${dmg.toRammer} back.`);
        const v = victim ? characters.byId(victim.id) ?? victim : null;
        const r = rammer ? characters.byId(rammer.id) ?? rammer : null;
        if (v && dmg.toTarget > 0) applyHpDelta(io, d.campaignId, v, -dmg.toTarget, 'a ram', me.name);
        if (r && dmg.toRammer > 0) applyHpDelta(io, d.campaignId, r, -dmg.toRammer, 'a ram', target.name);
        controlCheck(target, characters.byId(targetChar?.id ?? '') ?? targetChar, targetVehicle, 0);
        controlCheck(me, characters.byId(myChar?.id ?? '') ?? myChar, myVehicle, 0);
      }, diceSettleDelayMs(theirs.br.dice));
      return;
    }

    if (action === 'board') {
      // You board the MACHINE, not the person: whatever they are riding, or
      // them if they are the vehicle.
      const boardTok = targetTok?.mountedOn ? tokens.byId(targetTok.mountedOn) : targetTok;
      if (!myTok) return;
      if (!boardTok || !boardTok.mountable) {
        emitError(socket, `${target.name} is not riding anything you could board.`);
        return;
      }
      if (boardTok.id === myTok.mountedOn) { emitError(socket, `${me.name} is already aboard ${boardTok.name}.`); return; }
      const br = roll(traitExpr(sheet, skillDie(sheet, 'Athletics'), BOARD_MOD));
      const critFail = myChar ? critFailFor(io, d.campaignId, myChar, br.dice) : false;
      let out = boardOutcome(br.total, critFail);
      const riders = tokens.forMap(myTok.mapId).filter((t) => t.mountedOn === boardTok.id && t.id !== myTok.id);
      const seats = Math.max(1, boardTok.maxRiders ?? 1);
      // Made the leap, but there is nowhere to land.
      if (out === 'aboard' && riders.length >= seats) {
        out = 'held';
        postStatusLine(io, d.campaignId, `${boardTok.name} is full — ${seats} aboard already, and nowhere to land.`);
      }
      me.actedThisTurn = true;
      postRollCard(myChar, me.name, 'Athletics — Board',
        `${me.name} leaps for ${boardTok.name} [−2 Board]: `
        + (out === 'aboard' ? 'aboard!' : out === 'held' ? 'thinks better of it and stays put.' : 'misses, and hits the road.'),
        br, out === 'aboard');
      if (out === 'aboard') {
        tokens.update(myTok.id, { mountedOn: boardTok.id });
        tokens.move(myTok.id, boardTok.q, boardTok.r);
        const up = tokens.byId(myTok.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: up });
        for (const s2 of socketsSeeingToken(io, d.campaignId, up)) {
          s2.emit(S2C.TOKEN_MOVED, { tokenId: up.id, q: up.q, r: up.r });
        }
        // Aboard their machine, they travel with it from now on.
        me.cardIdx = target.cardIdx;
        syncMapVision(io, d.campaignId, myTok.mapId);
      } else if (out === 'fallen') {
        const fall = roll(FALL_FROM_VEHICLE_DAMAGE);
        chase.participants = chase.participants.filter((p) => p !== me);
        setTimeout(() => {
          postStatusLine(io, d.campaignId,
            `${me.name} hits the road at speed — ${FALL_FROM_VEHICLE_DAMAGE}: ${fall.total} damage.`);
          const who = myChar ? characters.byId(myChar.id) ?? myChar : null;
          if (who) {
            applyHpDelta(io, d.campaignId, who, -fall.total, 'a fall from a moving vehicle');
            applyConditionTo(io, d.campaignId, characters.byId(who.id) ?? who, 'prone', 'thrown from a vehicle');
          }
        }, diceSettleDelayMs(br.dice));
      }
      commit();
      return;
    }
  }, 'CHASE_ACTION'));

  socket.on(C2S.INIT_CLEAR, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const ending = initiative.get(d.campaignId);
    initiative.set(d.campaignId, { entries: [], turnIdx: 0, round: 1, active: false });
    resetSwadeTurnMoves(d.campaignId);
    swadeActionCounts.delete(d.campaignId);
    broadcastInitiative(io, d.campaignId);
    if (ending.active) offerAftermath(io, d.campaignId);
  }, 'INIT_CLEAR'));

  socket.on(C2S.INIT_ROLL_MAP, safe(socket, ({ mapId, includeGm }: InitRollMapPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM rolls group initiative.'); return; }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    const state = initiative.get(d.campaignId);
    const existing = new Set(state.entries.map((e) => e.tokenId));
    let added = 0;
    for (const t of tokens.forMap(mapId)) {
      if (existing.has(t.id)) continue;
      if (t.layer === 'gm' && !includeGm) continue;
      const character = t.characterId ? characters.byId(t.characterId) : undefined;
      const expr = character ? systemFor(character.system).initiativeExpr(character.sheet) : '1d20';
      state.entries.push({
        id: newId(), tokenId: t.id, name: t.name,
        value: roll(expr).total, hidden: t.layer === 'gm',
      });
      added++;
    }
    state.entries.sort((a, b) => b.value - a.value);
    state.turnIdx = 0;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `Rolled initiative for ${added} token${added === 1 ? '' : 's'}.`, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_ROLL_MAP'));

  socket.on(C2S.INIT_SET_ACTIVE, safe(socket, ({ active }: { active: boolean }) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    const wasActive = state.active;
    state.active = !!active;
    if (active) {
      const msg = chat.add(d.campaignId, {
        userId: null, fromName: 'System', kind: 'system',
        text: `Combat begins! Round ${state.round}.`, roll: null, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    if (wasActive && !state.active) offerAftermath(io, d.campaignId);
  }, 'INIT_SET_ACTIVE'));

  // ----- roll-your-own initiative (5e / SWN) -----

  // The DM calls for initiative: instead of the server silently rolling for
  // everyone, each combatant is put on the hook for their own roll. Players
  // get a prompt for their characters; the DM covers NPCs. Mirrors the SWADE
  // action-deck flow so both systems feel the same at the table.
  socket.on(C2S.INIT_ROLL_CALL, safe(socket, ({ mapId, includeGm }: InitRollCallPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM calls for initiative.'); return; }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');

    const pendingRolls: PendingInitiative[] = [];
    for (const t of tokens.forMap(mapId)) {
      if (t.layer === 'gm' && !includeGm) continue;
      const character = t.characterId ? characters.byId(t.characterId) : undefined;
      pendingRolls.push({
        tokenId: t.id, name: t.name,
        ownerUserId: character?.ownerUserId ?? null,
        hidden: t.layer === 'gm',
      });
    }
    if (pendingRolls.length === 0) { emitError(socket, 'No tokens on this map to roll for.'); return; }

    // A fresh call clears the previous order — same as dealing a new deck.
    // Calling for initiative IS starting combat — the DM should not have to
    // flip a separate switch once everyone has rolled.
    const state: InitiativeState = {
      entries: [], turnIdx: 0, round: 1, active: true, pendingRolls,
    };
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `🎲 The DM calls for initiative — ${pendingRolls.filter((p) => !p.hidden).length} combatant(s) roll!`,
      roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_ROLL_CALL'));

  // One combatant rolls their own initiative. Players roll for the characters
  // they own; the DM can roll for anyone (NPCs, or an absent player's token).
  // Each roll posts its own chat card, so the table sees every result land.
  socket.on(C2S.INIT_ROLL_MINE, safe(socket, ({ tokenId }: InitRollMinePayload) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    const idx = (state.pendingRolls ?? []).findIndex((p) => p.tokenId === tokenId);
    if (idx < 0) { emitError(socket, 'That combatant has already rolled (or was never called on).'); return; }
    const pending = state.pendingRolls![idx];
    if (d.role !== 'dm' && pending.ownerUserId !== d.userId) {
      emitError(socket, 'You can only roll for your own character.');
      return;
    }

    const token = tokens.byId(pending.tokenId);
    const character = token?.characterId ? characters.byId(token.characterId) : undefined;
    const expr = character ? systemFor(character.system).initiativeExpr(character.sheet) : '1d20';
    const breakdown = roll(expr);

    state.pendingRolls!.splice(idx, 1);
    state.entries.push({
      id: newId(), tokenId: pending.tokenId, name: pending.name,
      value: breakdown.total, hidden: pending.hidden,
    });
    // Keep the order live as results come in: highest first, next up on top.
    state.entries.sort((a, b) => b.value - a.value);
    state.turnIdx = 0;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);

    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text: `${pending.name}: initiative`, roll: breakdown, recipients: null,
    });
    io.to(pending.hidden ? dmRoom(d.campaignId) : campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_ROLL_MINE'));

  // ----- SWADE action-deck initiative -----

  // DM calls for cards: shuffle a fresh 54-card deck (jokers included) and
  // put every token on the map on the owes-a-draw list. Player-owned tokens
  // are drawn by their player (a deck button pops on their screen); unowned
  // (NPC) tokens are drawn by the DM.
  socket.on(C2S.INIT_CARD_CALL, safe(socket, ({ mapId, includeGm }: InitCardCallPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM deals action cards.'); return; }
    const campaign = campaigns.byId(d.campaignId)!;
    if (campaign.system !== 'swade') { emitError(socket, 'Action-deck initiative is a Savage Worlds thing.'); return; }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');

    const pendingDraws: PendingCardDraw[] = [];
    for (const t of tokens.forMap(mapId)) {
      if (t.layer === 'gm' && !includeGm) continue;
      const character = t.characterId ? characters.byId(t.characterId) : undefined;
      pendingDraws.push({
        tokenId: t.id, name: t.name,
        ownerUserId: character?.ownerUserId ?? null,
        hidden: t.layer === 'gm',
      });
    }
    if (pendingDraws.length === 0) { emitError(socket, 'No tokens on this map to deal to.'); return; }

    // Dealing the deck IS starting combat; see INIT_ROLL_CALL.
    const state: InitiativeState = {
      entries: [], turnIdx: 0, round: 1, active: true,
      cardMode: true, deck: shuffleDeck(buildDeck()), pendingDraws, drawCounter: 0,
    };
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `🂠 The DM deals action cards — ${pendingDraws.filter((p) => !p.hidden).length} combatant(s) draw for initiative!`,
      roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'INIT_CARD_CALL'));

  // One combatant draws the top card. Players draw for their own tokens; the
  // DM can draw for anyone (NPCs, or an AFK player's token).
  socket.on(C2S.INIT_CARD_DRAW, safe(socket, ({ tokenId }: InitCardDrawPayload) => {
    const d = requireCampaign(socket);
    const state = initiative.get(d.campaignId);
    if (!state.cardMode) { emitError(socket, 'No card draw is in progress.'); return; }
    const idx = (state.pendingDraws ?? []).findIndex((p) => p.tokenId === tokenId);
    if (idx < 0) { emitError(socket, 'That combatant has already drawn (or was never dealt in).'); return; }
    const pending = state.pendingDraws![idx];
    if (d.role !== 'dm' && pending.ownerUserId !== d.userId) {
      emitError(socket, 'You can only draw for your own character.');
      return;
    }

    // The 54-card deck outlasts any normal encounter, but never dead-end:
    // reshuffle a fresh deck if it somehow runs dry.
    if (!state.deck || state.deck.length === 0) {
      state.deck = shuffleDeck(buildDeck());
      const msg = chat.add(d.campaignId, {
        userId: null, fromName: 'System', kind: 'system',
        text: '🂠 The action deck is reshuffled.', roll: null, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    }
    const { card, discarded, plan } = drawActionCard(state, sheetForToken(pending.tokenId));
    if (card.rank === 15) state.jokerDealt = true;
    const drewJoker = card.rank === 15;
    state.drawCounter = (state.drawCounter ?? 0) + 1;
    state.pendingDraws!.splice(idx, 1);
    state.entries.push({
      id: newId(), tokenId: pending.tokenId, name: pending.name,
      value: card.rank, hidden: pending.hidden,
      card, drawSeq: state.drawCounter,
    });
    // Stack-rank as the cards come in: highest card on top, rank ties broken
    // by who drew first (lower drawSeq). Whoever is up next is always row 0.
    state.entries.sort(compareCardEntries);
    state.turnIdx = 0;
    flagChaseComplications(io, d.campaignId, state);
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);

    const room = pending.hidden ? dmRoom(d.campaignId) : campaignRoom(d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `🂠 ${pending.name} draws the ${cardName(card)} ${cardShort(card)}`
        + (plan.reasons.length ? ` [${plan.reasons.join('; ')}]` : '')
        + (discarded.length ? ` — discarded ${discarded.map((c) => cardShort(c)).join(' ')}` : ''),
      roll: null, recipients: null,
    });
    io.to(room).emit(S2C.CHAT, { msg });
    io.to(room).emit(S2C.INIT_CARD_DRAWN, { tokenId: pending.tokenId, name: pending.name, card, byUserId: d.userId });
    if (drewJoker) jokersWild(io, d.campaignId, pending.name, isPlayerSideToken(pending.tokenId), pending.hidden);
  }, 'INIT_CARD_DRAW'));
}
