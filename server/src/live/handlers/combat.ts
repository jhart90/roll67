import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor, bestCastLevel, combatActions, critRange, hexDistance, hexToPixel, inBounds, num, rows, str, fmtMod,
  AMMO_BY_ROF, MAX_WOUNDS, SKILL_ATTR_SWADE, dieSides, gangUpBonus, traitModWhy, reachableAlong, skillDie, soakSuccesses, swadeDamageOutcome, traitExpr, type GangUpCombatant, type MapDef, type PlayingCard,
  applyDamageMultiplier, attackAdvantage, conditionCombat, conditionsOf, critDamageExpr, getCondition, rayBlocked, sightSegments,
  damageMultiplier, multiplierLabel, swnMod, isPsychicMishap, rollMishap, hasSavageAttacker, tokensInAoe, usableAmount,
  type AoeShape, type BennyAwardPayload, type BennyUsePayload, type BleedRollPayload, type ShakenRollPayload, type CastAoePayload, type Character, type CombatActionPayload, type DeathSavePayload, type Hex, type ImpactKind,
  type InitAddPayload, type InitiativeEntry, type InitRemovePayload, type InitRollMapPayload, type InitUpdatePayload, type InitiativeState,
  type RequestSavePayload, type RollBreakdown, type SheetData, type Token, type UndoEntry, type UsePowerPayload,
  buildDeck, shuffleDeck, cardName, cardShort, compareCardEntries, swadeRangedArmor, swnReloadCheck, withRaiseDie,
  type InitCardCallPayload, type InitCardDrawPayload, type PendingCardDraw, type ReloadWeaponPayload,
  type InitRollCallPayload, type InitRollMinePayload, type PendingInitiative, type SoakRollPayload,
} from 'shared';
import { campaigns, characters, chat, initiative, maps, tokens } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { applyConditionTo, applyHpDelta, clearConcentrationEffects, computeHpDelta, dropCarriedLoot, floatHp, persistSheet, postStatusLine, recordBennyRoll, takeBennyRoll, takeSoakOffer } from '../hp.js';
import { socketsSeeingToken, syncMapVision } from '../visionService.js';
import { applyAdv } from './chat.js';
import { hasRunThisTurn, resetSwadeTurnMoves } from './tokens.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

// A save is always a single d20 roll; client/src/table/dice3d.ts settles a
// single die within ~1700ms (delay 0 + dur up to 1450-1700ms). Add a 1s pause
// on top per the requested "wait for the animation, pause a beat" pacing.
const SAVE_STEP_DELAY_MS = 2800;

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

/**
 * End of a SWADE combatant's turn: Vulnerable and Distracted expire — unless
 * a condition that inflicts them (Stunned, Bound, Entangled) is still active.
 */
function expireTurnConditions(io: Server, campaignId: string, ch: Character): void {
  const conds = conditionsOf(ch.sheet);
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
 * (free Vigor to come to), then Shaken (Spirit to shake it off) — automatic,
 * so the damage ladder actually turns over without bookkeeping.
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
  const recoveryRoll = (attr: 'vigor' | 'spirit') =>
    roll(traitExpr(ch.sheet, dieSides(String(ch.sheet[attr] ?? 'd4'))));
  const post = (text: string, breakdown: ReturnType<typeof roll>, ok: boolean) => {
    const msg = chat.add(campaignId, {
      userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
      text, roll: { ...breakdown, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  };

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

  // Stunned: success leaves them Vulnerable and Distracted until the end of
  // their next turn; a raise clears those too. Prone stays until they stand.
  if (conditionsOf(ch.sheet).includes('stunned')) {
    const b = recoveryRoll('vigor');
    if (b.total >= 4) {
      const raise = b.total >= 8;
      let conds = conditionsOf(ch.sheet).filter((c) => c !== 'stunned');
      conds = raise
        ? conds.filter((c) => c !== 'vulnerable' && c !== 'distracted')
        : [...new Set([...conds, 'vulnerable', 'distracted'])];
      persistSheet(io, campaignId, ch, { conditions: conds });
      post(`${ch.name} is no longer Stunned${raise ? '' : ' (but Vulnerable and Distracted)'} — Vigor roll`, b, true);
    } else {
      post(`${ch.name} is still Stunned — Vigor roll`, b, false);
    }
    reread();
  }

  // Shaken: whoever runs this character rolls Spirit themself — the prompt
  // goes to the owning player, or to the DM's screen for their own tokens.
  if (conditionsOf(ch.sheet).includes('shaken')) {
    const room = ch.ownerUserId ? userRoom(ch.ownerUserId) : dmRoom(campaignId);
    io.to(room).emit(S2C.SHAKEN_PROMPT, { characterId: ch.id, name: ch.name });
  }
}

/** The Shaken recovery: Spirit vs 4 — success stands them back up. */
export function resolveShakenRecovery(io: Server, campaignId: string, ch: Character): void {
  const b = roll(traitExpr(ch.sheet, dieSides(String(ch.sheet.spirit ?? 'd4'))));
  const recovered = b.total >= 4;
  if (recovered) {
    persistSheet(io, campaignId, ch, { conditions: conditionsOf(ch.sheet).filter((c) => c !== 'shaken') });
  }
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', fromCharacter: ch.name, characterId: ch.id, kind: 'roll',
    text: recovered ? `${ch.name} shakes it off — Spirit roll` : `${ch.name} is still Shaken — Spirit roll`,
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
        const sk = bestSkillOf(actor.sheet, ['Taunt', 'Intimidation', 'Athletics']);
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
  swadeActionCounts.delete(campaignId);
  if (prev?.system === 'swade') expireTurnConditions(io, campaignId, prev);
  const ch = combatantChar(state, state.turnIdx);
  if (ch?.system === 'swade') startOfTurnRecovery(io, campaignId, ch);
}

/**
 * SWADE round 2+: deal everyone a fresh Action Card automatically — the
 * order reshuffles every round, per the book. The deck persists across
 * rounds and reshuffles only after a round in which a Joker was dealt.
 * Held combatants keep holding and draw no card.
 */
function redealRoundCards(io: Server, campaignId: string, state: InitiativeState): void {
  if (!state.active || !state.cardMode || state.entries.length === 0) return;
  if (state.jokerDealt) {
    state.deck = shuffleDeck(buildDeck());
    postStatusLine(io, campaignId, '🂠 A Joker was dealt last round — the action deck is reshuffled.');
  }
  state.jokerDealt = false;
  const dealt: Array<{ tokenId: string | null; name: string; card: PlayingCard; hidden: boolean }> = [];
  for (const entry of state.entries) {
    if (entry.held) continue;
    if (!state.deck || state.deck.length === 0) state.deck = shuffleDeck(buildDeck());
    const card = state.deck.shift()!;
    if (card.rank === 15) state.jokerDealt = true;
    state.drawCounter = (state.drawCounter ?? 0) + 1;
    entry.card = card;
    entry.value = card.rank;
    entry.drawSeq = state.drawCounter;
    dealt.push({ tokenId: entry.tokenId, name: entry.name, card, hidden: entry.hidden });
  }
  state.entries.sort(compareCardEntries);
  state.turnIdx = 0;
  const jokers = dealt.filter((c) => c.card.rank === 15 && !c.hidden).map((c) => c.name);
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `🂠 Round ${state.round} — new action cards are dealt.${jokers.length ? ` Joker to ${jokers.join(' & ')}!` : ''}`,
    roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  // The table-wide reveal: face-down cards flipping in deal order. Hidden
  // combatants stay off screen; the DM reads theirs from the initiative list.
  io.to(campaignRoom(campaignId)).emit(S2C.ROUND_CARDS, {
    round: state.round,
    cards: dealt.filter((c) => !c.hidden).map(({ hidden: _h, ...rest }) => rest),
  });
}

export function initiativeViewFor(state: InitiativeState, isDm: boolean, campaignId: string): InitiativeState {
  const { deck, drawCounter, ...rest } = state;
  const view: InitiativeState = {
    ...rest,
    entries: withOwners(campaignId, rest.entries),
    ...(state.cardMode ? { deckRemaining: deck?.length ?? 0 } : {}),
  };
  if (isDm) return view;
  return {
    ...view,
    entries: view.entries.filter((e) => !e.hidden),
    pendingDraws: view.pendingDraws?.filter((p) => !p.hidden),
    pendingRolls: view.pendingRolls?.filter((p) => !p.hidden),
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
  /** When the source spell is concentration: the caster to record the
   *  inflicted conditions on, so ending concentration lifts them. */
  concentrationCasterId?: string;
}

/**
 * Roll each target's save one at a time — each posts as its own red/green
 * chat card, paced by the dice-settle delay — then (if there's a damage
 * expression) roll damage once and apply it per target based on their own
 * pass/fail. Shared by the DM's manual "call for save" tool and an AoE spell
 * cast once its template is locked in. Returns false (nothing posted) if
 * none of the given token ids resolve to a real token.
 */
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
    // Figure out who takes what now (for undo + the card), but hold off on
    // actually touching anyone's HP until this roll's own dice have settled.
    const applications: Array<() => void> = [];
    for (const { tok, ch, passed } of results) {
      let amt = passed ? (spec.onSave === 'half' ? Math.floor(base / 2) : 0) : base;
      if (ch && spec.damageType) amt = applyDamageMultiplier(amt, damageMultiplier(ch.sheet, spec.damageType));
      if (amt <= 0) continue;
      if (!ch && !tok.bar) continue;
      undo.push(ch ? { t: 'hp', characterId: ch.id, delta: -amt } : { t: 'hp', tokenId: tok.id, delta: -amt });
      applications.push(() => {
        if (ch) {
          const fresh = characters.byId(ch.id);
          if (fresh) applyHpDelta(io, spec.campaignId, fresh, -amt, spec.label ?? 'a saving throw');
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
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${spec.label?.trim() || 'Saving throw'} — damage`, roll: dmg, recipients: null,
    }, undo.length > 0 ? undo : undefined);
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

  const postSave = (i: number): void => {
    const { tok, ch, sc } = targets[i];
    const br = roll(sc.expr);
    const passed = br.total >= sc.threshold;
    results.push({ tok, ch, passed });
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${tok.name} — ${sc.label}: ${passed ? 'Success' : 'Failure'} (DC ${sc.threshold})`,
      // The save is the TARGET's roll — their stats, not the caster's.
      characterId: ch?.id ?? null, statsUserId: ch?.ownerUserId ?? null,
      roll: { ...br, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
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

  postSave(0);
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
    const dist = hexDistance({ q: src.q, r: src.r }, { q: tgt.q, r: tgt.r });
    const effectiveRange = rangeHexes + (tgt.size >= 3 ? 1 : 0);
    // SWADE range bands: the listed range is Short; Medium (−2) reaches 2×
    // and Long (−4) reaches 4×. Other systems keep the hard single limit.
    const swadeBands = actor.system === 'swade' && action.ranged && rangeHexes > 1;
    // Extreme range (4× Long, −8) is only reachable while Aiming.
    const bandCap = p.adv === 'adv' ? 16 : 4;
    const maxRange = swadeBands ? rangeHexes * bandCap + (tgt.size >= 3 ? 1 : 0) : effectiveRange;
    if (dist > maxRange) {
      emitError(socket, `${tgt.name} is out of range (${dist * feetPerHex} ft > ${swadeBands ? action.rangeFt * bandCap : action.rangeFt} ft${swadeBands && bandCap === 4 ? ' — Extreme range needs Aim' : ''}).`);
      return;
    }
    const rangeBandMod = !swadeBands || dist <= rangeHexes ? 0
      : dist <= rangeHexes * 2 ? -2 : dist <= rangeHexes * 4 ? -4 : -8;
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
        // The adv slot is repurposed: melee 'adv' is a Wild Attack (+2 to
        // hit AND damage, but you're Vulnerable), ranged 'adv' is Aim (+2).
        if (p.adv === 'adv' && !action.ranged) {
          mod += 2; dmgBonus += 2; wildAttack = true; tags.push('+2 Wild Attack');
        } else if (p.adv === 'dis') { mod -= 2; tags.push('−2'); }
        if (rangeBandMod) { mod += rangeBandMod; tags.push(`${rangeBandMod} ${dist <= rangeHexes * 2 ? 'Medium' : dist <= rangeHexes * 4 ? 'Long' : 'Extreme'} range`); }
        if (coverPenalty) { mod += coverPenalty; tags.push(`${coverPenalty} Cover (armor +${-coverPenalty})`); }
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
          const illum = lit === 'bright' ? 0 : lit === 'dim' ? -2 : base;
          if (illum) { mod += illum; tags.push(`${illum} ${illum === -2 ? 'Dim light' : illum === -4 ? 'Darkness' : 'Pitch darkness'}`); }
        }
        // Aim: negate up to 4 points of range/cover penalties, else +2 flat.
        if (p.adv === 'adv' && action.ranged) {
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
        if (targetConditions.includes('stunned')) { mod += 4; dmgBonus += 4; tags.push('+4 The Drop'); }
        else if (targetConditions.includes('vulnerable') || targetConditions.includes('bound')) { mod += 2; tags.push('+2 Vulnerable'); }
        if (action.ranged && targetConditions.includes('prone')) { mod -= 2; tags.push('−2 vs Prone'); }
        if (mod) expr = mod > 0 ? `${expr}+${mod}` : `${expr}${mod}`;
        if (tags.length) advTag = ` [${tags.join(', ')}]`;
      } else if (netAdv) {
        expr = `${expr}${netAdv === 'adv' ? '+2' : '-2'}`;
        advTag = netAdv === 'adv' ? ' [+2]' : ' [−2]';
      }
      attackBreakdown = roll(expr);
      if (actor.system === 'swade') {
        recordBennyRoll(io, d.campaignId, actor, 'trait', expr, attackBreakdown.total, `their ${action.label} roll`);
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
      // SWADE powers (Bolt) beat a fixed TN of 4 instead of the target's
      // Parry; any SWADE to-hit that beats its number by 4+ is a raise
      // (+1d6! bonus damage below) — weapon attacks vs Parry included.
      const ac = action.fixedTn
        ?? (targetChar ? Number(systemFor(targetChar.system).derive(targetChar.sheet).ac) || num(targetChar.sheet, 'ac', 0) : 0);
      hit = nat1 ? false : crit ? true : ac > 0 ? attackBreakdown.total >= ac : true;
      raise = hit && actor.system === 'swade' && ac > 0 && attackBreakdown.total >= ac + 4;
      // Say WHY it landed or didn't. A bare HIT/MISS makes the engine look
      // arbitrary — especially in SWADE, where a weapon beats Parry but a
      // power beats a flat TN, and the two numbers look nothing alike.
      const targetSystem = targetChar?.system ?? actor.system;
      const acName = action.fixedTn ? 'TN' : targetSystem === 'swade' ? 'Parry' : 'AC';
      const why = nat1 ? 'natural 1 always misses'
        : crit ? `natural ${critAt}+ always hits`
          : ac > 0 ? `vs ${acName} ${ac}`
            : 'no target number to beat';
      attackOutcome = `${hit ? 'HIT' : 'MISS'}${crit ? ' (crit!)' : ''}${raise ? ' (raise!)' : ''} — ${why}${raise ? `, beat it by ${attackBreakdown.total - ac}` : ''}`;
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
      if (action.effect === 'damage' && hit && targetChar) {
        const mult = damageMultiplier(targetChar.sheet, action.damageType);
        if (mult !== 1) {
          magnitude = applyDamageMultiplier(magnitude, mult);
          resistTag = ` (${multiplierLabel(mult)})`;
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
      const applied = action.effect === 'heal' ? magnitude : (hit ? magnitude : 0);
      const delta = action.effect === 'heal' ? applied : -applied;
      const impactKind: ImpactKind = action.effect === 'heal' ? 'heal' : action.aoe ? 'aoe' : action.ranged ? 'ranged' : 'melee';

      // Work out the outcome now, for the chat card's text — but don't touch
      // the target's HP yet. That (and the impact animation over their token)
      // is deferred to fire only once this roll's own dice have visibly
      // settled, so the token never reacts before the player sees why.
      let hpNote = '';
      let applyToTarget: (() => void) | null = null;
      if (applied !== 0) {
        if (targetChar) {
          if (targetChar.system === 'swade' && delta < 0) {
            // The wound ladder, not the HP pool: preview the same outcome
            // applyHpDelta will compute when it actually lands.
            const out = swadeDamageOutcome(-delta, Number(systemFor('swade').derive(targetChar.sheet).toughness) || 4, {
              alreadyShaken: conditionsOf(targetChar.sheet).includes('shaken'),
              wildCard: targetChar.sheet.wildCard !== false,
              currentWounds: num(targetChar.sheet, 'wounds', 0),
            });
            hpNote = ` — ${out.summary}`;
          } else {
            const { patch, note } = computeHpDelta(targetChar, delta);
            const nh = systemFor(targetChar.system).hp({ ...targetChar.sheet, ...patch });
            hpNote = ` (${tgt.name} ${nh.hp}/${nh.maxHp})${note}`;
          }
          undo.push({ t: 'hp', characterId: targetChar.id, delta });
          const targetId = targetChar.id;
          applyToTarget = () => {
            // Re-read fresh: item/ammo consumption below may have already
            // patched this same sheet (when the actor heals themself).
            const fresh = characters.byId(targetId);
            if (fresh) applyHpDelta(io, d.campaignId, fresh, delta, action.spellName ?? action.label);
            floatHp(io, d.campaignId, src.mapId, tgt.id, delta, impactKind, action.damageType);
          };
        } else if (tgt.bar) {
          const cap = tgt.bar.maxHp > 0 ? tgt.bar.maxHp : tgt.bar.hp + delta;
          const nh = Math.max(0, Math.min(cap, tgt.bar.hp + delta));
          hpNote = ` (${tgt.name} ${nh}/${tgt.bar.maxHp})`;
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

      const verb = action.effect === 'heal' ? 'uses' : 'attacks';
      const outcome = action.effect === 'heal'
        ? `heals ${applied}`
        // Name the bonus die's source, so an extra die in the breakdown reads
        // as a reward rather than a bug.
        : hit ? `${applied} damage${crit ? ' (crit ×2 dice)' : raise ? ' (raise +1d6)' : ''}${resistTag}` : 'no damage';
      // A to-hit or save roll already posted its own card above (see the
      // dispatch below) — this card is damage-only, not a restatement of
      // the attack/target line. Only a no-roll action (e.g. a plain heal)
      // reaches this function with neither, so it still needs the full line.
      const text = (deferredSave || attackBreakdown)
        ? `${actor.name}'s ${action.label} — ${tgt.name}: ${outcome}${hpNote}`.replace(/\s+/g, ' ').trim()
        : `${actor.name} ${verb} ${action.effect === 'heal' ? action.label + ' on' : ''} ${tgt.name}${action.effect === 'heal' ? '' : ': ' + action.label}${hitLabel} · ${outcome}${hpNote}`.replace(/\s+/g, ' ').trim();
      const cardRoll = amountRoll;
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll', text, roll: cardRoll, recipients: null,
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
      const attackText = `${actor.name} attacks ${tgt.name} with`;
      const attackMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll', text: attackText,
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
                const { note } = applyHpDelta(io, d.campaignId, fresh, -amt, 'stray shot');
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
              const dmg = applyDamageMultiplier(action.shockDamage!, damageMultiplier(fresh.sheet, action.damageType));
              if (dmg <= 0) return;
              applyHpDelta(io, d.campaignId, fresh, -dmg, `${action.label} (shock)`);
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
    if (action.rangeFt > 0) {
      const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
      const rangeHexes = Math.max(1, Math.ceil(action.rangeFt / feetPerHex));
      if (hexDistance({ q: src.q, r: src.r }, p.aimHex) > rangeHexes) {
        emitError(socket, 'That is out of range.');
        return;
      }
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
    if (action.source === 'power' && action.ppCost) {
      const pp = num(actor.sheet, 'pp', 0);
      if (pp < action.ppCost) {
        emitError(socket, `Not enough Power Points (${pp} left, ${action.label} costs ${action.ppCost}).`);
        return;
      }
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
    if (actor.system === 'swade' && action.source === 'attack' && !action.suppressive && usableAmount(action.amountExpr)) {
      const row = rows(actor.sheet, 'attacks')[action.index];
      const thrown = /thrown/i.test(str(row ?? {}, 'notes', ''));
      const skillName = thrown ? 'Athletics' : 'Shooting';
      const br = roll(traitExpr(actor.sheet, skillDie(actor.sheet, skillName)));
      const onTarget = br.total >= 4;
      let text = `${actor.name} lets ${action.label} fly — ${skillName} roll: on target`;
      if (!onTarget) {
        const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        const devDist = roll(thrown ? '1d6' : '2d6').total;
        const dir = DIRS[roll('1d6').total - 1];
        const moved = { q: p.aimHex.q + dir[0] * devDist, r: p.aimHex.r + dir[1] * devDist };
        if (inBounds(moved, map.grid)) p.aimHex = moved;
        text = `${actor.name} lets ${action.label} fly — ${skillName} roll fails: the ${thrown ? 'throw' : 'shot'} goes wide, deviating ${devDist}″!`;
      }
      const devMsg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: actor.name, characterId: actor.id, kind: 'roll',
        text, roll: { ...br, outcome: onTarget ? 'success' as const : 'failure' as const }, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg: devMsg });
    }

    const geometricHitIds = tokensInAoe(action.aoe, originHex, p.aimHex, map.grid, tokens.forMap(src.mapId));
    const hitIds = geometricHitIds.filter((tid) => {
      const t = tokens.byId(tid);
      return !!t && !rayBlocked(srcPx, hexToPixel({ q: t.q, r: t.r }, map.grid), sightSegs);
    });
    if (hitIds.length === 0) { emitError(socket, `${action.label} caught no one in its area.`); return; }

    // SWADE Evasion: a telegraphed template attack (grenade blast, cone of
    // flame) can be dived away from — Agility at −2, success takes nothing.
    const evadeable = actor.system === 'swade' && action.source === 'attack'
      && !action.suppressive && !action.saveId && usableAmount(action.amountExpr);
    if (action.saveId || evadeable) {
      // Monster stat-block attacks (breath weapons, etc.) bake in a fixed DC
      // rather than deriving one from the actor's spellcasting stat.
      const casterDc = action.fixedDc || Math.round(Number(systemFor(actor.system).derive(actor.sheet).spellDc)) || 10;
      runGroupSave(io, {
        campaignId: d.campaignId, userId: d.userId, username: d.username,
        tokenIds: hitIds, saveId: action.saveId ?? 'agility', dc: casterDc,
        ...(evadeable ? { evasion: true } : {}),
        damageExpr: action.amountExpr, onSave: action.onSave ?? (evadeable ? 'negate' : 'half'),
        damageType: action.damageType, label: castLabel,
        ...(action.appliesCondition ? {
          appliesCondition: action.appliesCondition,
          ...(action.concentration ? { concentrationCasterId: actor.id } : {}),
        } : {}),
        aoeVisual: {
          mapId: src.mapId, shape: action.aoe.shape, sizeFt: action.aoe.sizeFt, sizeHexes: action.aoe.sizeHexes, widthFt: action.aoe.widthFt,
          originHex, aimHex: p.aimHex,
        },
      });
      return;
    }

    // No save (rare — every compendium AoE spell has one, but a homebrew
    // action might not): everyone caught in the area takes the same roll.
    const dmg = roll(action.amountExpr);
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
      if (ch && action.damageType) amt = applyDamageMultiplier(amt, damageMultiplier(ch.sheet, action.damageType));
      if (amt <= 0) continue;
      undo.push(ch ? { t: 'hp', characterId: ch.id, delta: -amt } : { t: 'hp', tokenId: tok.id, delta: -amt });
      applications.push(() => {
        if (ch) {
          const fresh = characters.byId(ch.id);
          if (fresh) applyHpDelta(io, d.campaignId, fresh, -amt, action.spellName ?? action.label);
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
    const noSaveFlightMs = action.aoe.shape === 'sphere' || action.aoe.shape === 'cylinder' ? PROJECTILE_FLIGHT_MS : 0;
    setTimeout(
      () => emitAoeBurst(io, d.campaignId, src.mapId, action.aoe!.shape, action.aoe!.sizeFt, action.aoe!.sizeHexes, action.aoe!.widthFt, originHex, p.aimHex, action.damageType),
      Math.max(0, noSaveSettleMs - noSaveFlightMs),
    );
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
    const breakdown = roll(expr);
    const removed = Math.min(offer.wounds, soakSuccesses(breakdown.total));
    const woundsAfter = Math.max(0, num(ch.sheet, 'wounds', 0) - removed);
    const patch: Record<string, unknown> = { bennies: bennies - 1 };
    if (removed > 0) patch.wounds = woundsAfter;
    let conds = conditionsOf(ch.sheet);
    if (removed === offer.wounds && removed > 0) conds = conds.filter((c) => c !== 'shaken');
    if (woundsAfter <= MAX_WOUNDS) conds = conds.filter((c) => c !== 'incapacitated' && c !== 'bleeding');
    patch.conditions = conds;
    persistSheet(io, d.campaignId, ch, patch);
    const text = removed > 0
      ? `${ch.name} spends a Benny to Soak — ${removed} Wound${removed === 1 ? '' : 's'} soaked (now ${woundsAfter})${removed === offer.wounds ? ', no longer Shaken' : ''}`
      : `${ch.name} spends a Benny to Soak — Vigor roll fails, the wounds stand`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: ch.name, characterId: ch.id, kind: 'roll', text,
      roll: { ...breakdown, outcome: removed > 0 ? 'success' as const : 'failure' as const }, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'SOAK_ROLL'));

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

  // DM hands a character a Benny — always a public moment, so it's announced.
  socket.on(C2S.BENNY_AWARD, safe(socket, ({ characterId }: BennyAwardPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM hands out Bennies.'); return; }
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId || ch.system !== 'swade') return;
    persistSheet(io, d.campaignId, ch, { bennies: num(ch.sheet, 'bennies', 0) + 1 });
    postStatusLine(io, d.campaignId, `🪙 The DM awards ${ch.name} a Benny!`);
  }, 'BENNY_AWARD'));

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
    const spendBenny = (extra: Record<string, unknown> = {}): Character =>
      persistSheet(io, d.campaignId, characters.byId(ch.id) ?? ch,
        { bennies: num((characters.byId(ch.id) ?? ch).sheet, 'bennies', 0) - 1, ...extra });
    const postRoll = (text: string, breakdown: ReturnType<typeof roll>, ok: boolean) => {
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, fromCharacter: ch.name, characterId: ch.id, kind: 'roll', text,
        roll: { ...breakdown, outcome: ok ? 'success' as const : 'failure' as const }, recipients: null,
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
        spendBenny();
        const b = roll(rec.expr);
        const better = b.total > rec.total;
        // The reroll stands beside the original; whichever is higher counts.
        recordBennyRoll(io, d.campaignId, characters.byId(ch.id) ?? ch, kind, rec.expr, Math.max(rec.total, b.total), rec.label);
        postRoll(
          `🪙 ${ch.name} spends a Benny to reroll ${rec.label} — ${b.total} vs the original ${rec.total}: ${better ? 'the reroll counts!' : 'keep the original.'}`,
          b, better,
        );
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
        state.drawCounter = (state.drawCounter ?? 0) + 1;
        const currentId = state.entries[state.turnIdx]?.id;
        entry.card = card;
        entry.value = card.rank;
        entry.drawSeq = state.drawCounter;
        state.entries.sort(compareCardEntries);
        // Re-sorting must not steal the current combatant's turn.
        const keep = state.entries.findIndex((e) => e.id === currentId);
        if (keep >= 0) state.turnIdx = keep;
        initiative.set(d.campaignId, state);
        spendBenny();
        broadcastInitiative(io, d.campaignId);
        const msg = chat.add(d.campaignId, {
          userId: d.userId, fromName: d.username, kind: 'system',
          text: `🂠 ${ch.name} spends a Benny to redraw — draws the ${cardName(card)} ${cardShort(card)}${card.rank === 15 ? ' — Joker! Act anywhere in the round, +2 to all trait rolls & damage.' : ''}`,
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

  socket.on(C2S.INIT_CLEAR, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    initiative.set(d.campaignId, { entries: [], turnIdx: 0, round: 1, active: false });
    resetSwadeTurnMoves(d.campaignId);
    swadeActionCounts.delete(d.campaignId);
    broadcastInitiative(io, d.campaignId);
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
    const card = state.deck.shift()!;
    if (card.rank === 15) state.jokerDealt = true;
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
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);

    const room = pending.hidden ? dmRoom(d.campaignId) : campaignRoom(d.campaignId);
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `🂠 ${pending.name} draws the ${cardName(card)} ${cardShort(card)}${card.rank === 15 ? ' — Joker! Act anywhere in the round, +2 to all trait rolls & damage.' : ''}`,
      roll: null, recipients: null,
    });
    io.to(room).emit(S2C.CHAT, { msg });
    io.to(room).emit(S2C.INIT_CARD_DRAWN, { tokenId: pending.tokenId, name: pending.name, card, byUserId: d.userId });
  }, 'INIT_CARD_DRAW'));
}
