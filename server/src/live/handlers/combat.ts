import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor, castableLevels, combatActions, critRange, hexDistance, inBounds, num, rows, str, fmtMod,
  applyDamageMultiplier, attackAdvantage, conditionCombat, conditionsOf, critDamageExpr,
  damageMultiplier, multiplierLabel, swnMod, isPsychicMishap, rollMishap, hasSavageAttacker, tokensInAoe,
  type CastAoePayload, type Character, type CombatActionPayload, type DeathSavePayload, type InitAddPayload,
  type InitRemovePayload, type InitRollMapPayload, type InitUpdatePayload, type InitiativeState, type RequestSavePayload,
  type SheetData, type Token, type UndoEntry, type UsePowerPayload,
} from 'shared';
import { campaigns, characters, chat, initiative, maps, tokens } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { applyHpDelta, floatHp, persistSheet } from '../hp.js';
import { syncMapVision } from '../visionService.js';
import { applyAdv } from './chat.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

// A save is always a single d20 roll; client/src/table/dice3d.ts settles a
// single die within ~1700ms (delay 0 + dur up to 1450-1700ms). Add a 1s pause
// on top per the requested "wait for the animation, pause a beat" pacing.
const SAVE_STEP_DELAY_MS = 2800;

/** Players never receive hidden entries; the DM sees everything. */
export function initiativeViewFor(state: InitiativeState, isDm: boolean): InitiativeState {
  if (isDm) return state;
  return { ...state, entries: state.entries.filter((e) => !e.hidden) };
}

export function broadcastInitiative(io: Server, campaignId: string): void {
  const state = initiative.get(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    socket.emit(S2C.INITIATIVE, { state: initiativeViewFor(state, d.role === 'dm') });
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
    targets.push({ tok, ch, sc });
  }
  if (targets.length === 0) return false;

  const hasDamage = !!spec.damageExpr && /\d*d\d/i.test(spec.damageExpr);
  const results: { tok: Token; ch: Character | undefined; passed: boolean }[] = [];

  const finish = (): void => {
    if (touchedMap) syncMapVision(io, spec.campaignId, touchedMap);
    const header = `${spec.label?.trim() || 'Saving throw'} — ${targets[0].sc.label}${spec.damageExpr ? ` DC ${spec.dc}` : ''}`;
    io.to(campaignRoom(spec.campaignId)).emit(S2C.TABLE_RESULT, { text: header, color: '#c98a3c' });
  };

  const postDamage = (): void => {
    const dmg = roll(spec.damageExpr!);
    const base = Math.max(0, dmg.total);
    const undo: UndoEntry[] = [];
    for (const { tok, ch, passed } of results) {
      let amt = passed ? (spec.onSave === 'half' ? Math.floor(base / 2) : 0) : base;
      if (ch && spec.damageType) amt = applyDamageMultiplier(amt, damageMultiplier(ch.sheet, spec.damageType));
      if (amt <= 0) continue;
      if (ch) {
        applyHpDelta(io, spec.campaignId, ch, -amt);
        undo.push({ t: 'hp', characterId: ch.id, delta: -amt });
      } else if (tok.bar) {
        const nh = Math.max(0, tok.bar.hp - amt);
        tokens.update(tok.id, { bar: { hp: nh, maxHp: tok.bar.maxHp } });
        io.to(dmRoom(spec.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
        undo.push({ t: 'hp', tokenId: tok.id, delta: -amt });
      }
      floatHp(io, spec.campaignId, tok.mapId, tok.id, -amt);
    }
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${spec.label?.trim() || 'Saving throw'} — damage`, roll: dmg, recipients: null,
    }, undo.length > 0 ? undo : undefined);
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });
    finish();
  };

  const postSave = (i: number): void => {
    const { tok, ch, sc } = targets[i];
    const br = roll(sc.expr);
    const passed = br.total >= sc.threshold;
    results.push({ tok, ch, passed });
    const msg = chat.add(spec.campaignId, {
      userId: spec.userId, fromName: spec.username, kind: 'roll',
      text: `${tok.name} — ${sc.label}: ${passed ? 'Success' : 'Failure'} (DC ${sc.threshold})`,
      roll: { ...br, outcome: passed ? 'success' as const : 'failure' as const }, recipients: null,
    });
    io.to(campaignRoom(spec.campaignId)).emit(S2C.CHAT, { msg });

    if (i + 1 < targets.length) setTimeout(() => postSave(i + 1), SAVE_STEP_DELAY_MS);
    else if (hasDamage) setTimeout(postDamage, SAVE_STEP_DELAY_MS);
    else finish();
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
    let updated = persistSheet(io, campaignId, actor, actorPatch);
    if (mishap.selfDamage) {
      updated = applyHpDelta(io, campaignId, updated, -Math.max(0, roll(mishap.selfDamage).total)).character;
    }
    const mishapMsg = chat.add(campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `⚡ Mishap! ${updated.name}'s ${label} check (${checkRoll.total}) snake-eyes — ${mishap.text}.${mishap.torched ? ' 🔥 Torched.' : ''}`,
      roll: checkRoll, recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg: mishapMsg });
    return { actor: updated, undo };
  }
  return { actor: persistSheet(io, campaignId, actor, actorPatch), undo };
}

export function registerCombatHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.COMBAT_ACTION, safe(socket, (p: CombatActionPayload) => {
    const d = requireCampaign(socket);
    let actor = characters.byId(p.characterId);
    if (!actor || actor.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actor.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    const action = combatActions(actor).find((a) => a.id === p.actionId);
    if (!action) { emitError(socket, 'That action is no longer available.'); return; }

    // Weapons that track ammo (SWN's optional "Ammo left" column) can't fire empty.
    if (action.source === 'attack') {
      const atkRow = rows(actor.sheet, 'attacks')[action.index];
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
    if (dist > rangeHexes) {
      emitError(socket, `${tgt.name} is out of range (${dist * feetPerHex} ft > ${action.rangeFt} ft).`);
      return;
    }

    const targetChar = tgt.characterId ? characters.byId(tgt.characterId) : undefined;

    // Conditions gate the action and shift advantage.
    const attackerC = conditionCombat(conditionsOf(actor.sheet));
    if (attackerC.incapacitated) {
      emitError(socket, `${actor.name} is incapacitated and can't act.`);
      return;
    }
    const targetC = targetChar ? conditionCombat(conditionsOf(targetChar.sheet)) : conditionCombat([]);

    // Casting a spell spends a slot (leveled) and sets concentration on the
    // caster before resolving the effect.
    const undo: UndoEntry[] = [];
    if (action.source === 'spell') {
      const actorPatch: SheetData = {};
      if (action.slotLevel) {
        const lvl = action.slotLevel;
        if (!castableLevels(actor.sheet, lvl).includes(lvl)) {
          emitError(socket, `No level-${lvl} spell slot available.`);
          return;
        }
        actorPatch[`slotsUsed${lvl}`] = num(actor.sheet, `slotsUsed${lvl}`, 0) + 1;
        undo.push({ t: 'slot', characterId: actor.id, level: lvl });
      }
      if (action.concentration && action.spellName) {
        undo.push({ t: 'field', characterId: actor.id, key: 'concentration', value: actor.sheet.concentration ?? '' });
        actorPatch.concentration = action.spellName;
      }
      if (Object.keys(actorPatch).length > 0) actor = persistSheet(io, d.campaignId, actor, actorPatch);
    }

    // Activating a psychic power commits Effort up front and rolls the
    // discipline's activation check (see activatePsychicPower).
    if (action.source === 'power') {
      const result = activatePsychicPower(io, d.campaignId, d, socket, actor, action.effortCost ?? 1, action.disciplineId ?? '', action.label);
      if (!result) return;
      actor = result.actor;
      undo.push(result.undo);
    }

    // To-hit (weapons/spell attacks). Nat 20 always hits, nat 1 always misses;
    // otherwise compare to the target's AC. Save-based spells skip the to-hit:
    // the target rolls a save vs the caster's DC and damage is scaled instead.
    let hit = true;
    let crit = false;
    let saveScale = 1;
    let attackBreakdown: ReturnType<typeof roll> | null = null;
    let hitLabel = '';
    if (action.saveId && action.effect === 'damage') {
      const casterDc = Math.round(Number(systemFor(actor.system).derive(actor.sheet).spellDc)) || 10;
      const sc = targetChar
        ? systemFor(targetChar.system).saveCheck(targetChar.sheet, action.saveId, casterDc)
        : { expr: '1d20', threshold: casterDc, label: `${action.saveId.toUpperCase()} save` };
      attackBreakdown = roll(sc.expr);
      const passed = attackBreakdown.total >= sc.threshold;
      saveScale = passed ? (action.onSave === 'negate' ? 0 : 0.5) : 1;
      // 5e's threshold is always the caster's DC; SWN's is target-number based
      // (ignores the caster's DC entirely) — showing sc.threshold is correct
      // for both instead of hard-coding "vs DC" around the 5e-only casterDc.
      hitLabel = ` — ${sc.label} ${attackBreakdown.total} vs ${sc.threshold} · ${passed ? 'SAVE' : 'FAIL'}`;
    } else if (action.attackExpr) {
      // Net advantage folds the roller's choice with attacker/target conditions.
      const netAdv = action.attackExpr.toLowerCase().startsWith('1d20')
        ? attackAdvantage(p.adv ?? null, attackerC, targetC, action.ranged)
        : null;
      const expr = applyAdv(action.attackExpr, netAdv);
      attackBreakdown = roll(expr);
      const d20s = attackBreakdown.dice.filter((x) => x.sides === 20 && x.kept);
      // Champion Improved Critical lowers the crit threshold (19, or 18 at 15).
      const critAt = critRange(actor.sheet);
      crit = d20s.some((x) => x.value >= critAt && x.value !== 1);
      const nat1 = d20s.some((x) => x.value === 1);
      // Prefer the derived AC (folds in toggles like Dual Wielder's +1) over
      // the raw sheet field, which stays the DM/player's manually-typed base.
      const ac = targetChar ? Number(systemFor(targetChar.system).derive(targetChar.sheet).ac) || num(targetChar.sheet, 'ac', 0) : 0;
      hit = nat1 ? false : crit ? true : ac > 0 ? attackBreakdown.total >= ac : true;
      const advTag = netAdv === 'adv' ? ' [adv]' : netAdv === 'dis' ? ' [dis]' : '';
      hitLabel = ` — attack ${attackBreakdown.total}${advTag}${crit ? ' (crit!)' : ''} · ${hit ? 'HIT' : 'MISS'}`;
    }

    // Damage: a crit doubles the dice. Resistance/vulnerability/immunity from the
    // target's sheet then scales the total.
    const dmgExpr = crit ? critDamageExpr(action.amountExpr) : action.amountExpr;
    let amountRoll = roll(dmgExpr);
    // Savage Attacker: once per round, reroll a melee hit's damage and keep
    // the higher total (auto-applied — no reason to ever decline it).
    if (hit && action.source === 'attack' && !action.ranged && hasSavageAttacker(actor.sheet)) {
      const used = num(actor.sheet, 'res_savageAttacker', 0);
      if (used < 1) {
        const reroll = roll(dmgExpr);
        if (reroll.total > amountRoll.total) amountRoll = reroll;
        undo.push({ t: 'field', characterId: actor.id, key: 'res_savageAttacker', value: used });
        actor = persistSheet(io, d.campaignId, actor, { res_savageAttacker: used + 1 });
      }
    }
    let magnitude = Math.max(0, amountRoll.total);
    // Save-based spells scale the rolled damage (half / none on a save).
    if (action.effect === 'damage' && saveScale !== 1) magnitude = Math.floor(magnitude * saveScale);
    let resistTag = '';
    if (action.effect === 'damage' && hit && targetChar) {
      const mult = damageMultiplier(targetChar.sheet, action.damageType);
      if (mult !== 1) {
        magnitude = applyDamageMultiplier(magnitude, mult);
        resistTag = ` (${multiplierLabel(mult)})`;
      }
    }
    const applied = action.effect === 'heal' ? magnitude : (hit ? magnitude : 0);
    const delta = action.effect === 'heal' ? applied : -applied;

    // Apply to the target's HP (character-backed or bare token bar) + float.
    let hpNote = '';
    if (applied !== 0) {
      if (targetChar) {
        const { character: updated, note } = applyHpDelta(io, d.campaignId, targetChar, delta);
        const nh = systemFor(updated.system).hp(updated.sheet);
        hpNote = ` (${tgt.name} ${nh.hp}/${nh.maxHp})${note}`;
        undo.push({ t: 'hp', characterId: targetChar.id, delta });
      } else if (tgt.bar) {
        const cap = tgt.bar.maxHp > 0 ? tgt.bar.maxHp : tgt.bar.hp + delta;
        const nh = Math.max(0, Math.min(cap, tgt.bar.hp + delta));
        tokens.update(tgt.id, { bar: { hp: nh, maxHp: tgt.bar.maxHp } });
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tgt.id)! });
        syncMapVision(io, d.campaignId, src.mapId);
        hpNote = ` (${tgt.name} ${nh}/${tgt.bar.maxHp})`;
        undo.push({ t: 'hp', tokenId: tgt.id, delta });
      }
      floatHp(io, d.campaignId, src.mapId, tgt.id, delta);
    }
    if (resistTag) hitLabel += resistTag;

    // Consume a used item (decrement the actor's inventory row). Re-read the
    // character first: a self-heal above may have just changed its sheet, and
    // we must not clobber that HP change.
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

    // Decrement ammo on a weapon that tracks it (leave untouched if the
    // "Ammo left" field was never set — that means this weapon isn't tracked).
    if (action.source === 'attack') {
      const fresh = characters.byId(actor.id) ?? actor;
      const atks = Array.isArray(fresh.sheet.attacks) ? [...(fresh.sheet.attacks as SheetData[])] : [];
      const row = atks[action.index];
      const ammo = row ? num(row, 'ammo', -1) : -1;
      if (row && ammo > 0) {
        const before = atks.map((r) => ({ ...r }));
        atks[action.index] = { ...row, ammo: ammo - 1 };
        const sheet = { ...fresh.sheet, attacks: atks };
        characters.update(actor.id, undefined, sheet);
        const updatedActor = characters.byId(actor.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
        if (updatedActor.ownerUserId) io.to(userRoom(updatedActor.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedActor });
        undo.push({ t: 'field', characterId: actor.id, key: 'attacks', value: before });
      }
    }

    const verb = action.effect === 'heal' ? 'uses' : 'attacks';
    const outcome = action.effect === 'heal'
      ? `heals ${applied}`
      : hit ? `${applied} damage` : 'no damage';
    const text = `${actor.name} ${verb} ${action.effect === 'heal' ? action.label + ' on' : ''} ${tgt.name}${action.effect === 'heal' ? '' : ': ' + action.label}${hitLabel} · ${outcome}${hpNote}`.replace(/\s+/g, ' ').trim();
    // Show the damage/heal dice as the card, unless it was a clean miss.
    const cardRoll = attackBreakdown && !hit ? attackBreakdown : amountRoll;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll', text, roll: cardRoll, recipients: null,
    }, undo.length > 0 ? undo : undefined);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }));

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

    const src = tokens.byId(p.sourceTokenId);
    if (!src) { emitError(socket, 'Unknown source token.'); return; }
    if (d.role !== 'dm' && src.characterId !== actor.id) { emitError(socket, 'That is not your token.'); return; }
    const map = maps.byId(src.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');

    if (!inBounds(p.aimHex, map.grid) || !inBounds(p.originHex, map.grid)) {
      emitError(socket, 'That is off the map.');
      return;
    }
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

    // Casting a spell spends a slot (leveled) and sets concentration on the
    // caster before resolving the effect — mirrors C2S.COMBAT_ACTION.
    const actorPatch: SheetData = {};
    if (action.slotLevel) {
      const lvl = action.slotLevel;
      if (!castableLevels(actor.sheet, lvl).includes(lvl)) {
        emitError(socket, `No level-${lvl} spell slot available.`);
        return;
      }
      actorPatch[`slotsUsed${lvl}`] = num(actor.sheet, `slotsUsed${lvl}`, 0) + 1;
    }
    if (action.concentration && action.spellName) actorPatch.concentration = action.spellName;
    if (Object.keys(actorPatch).length > 0) actor = persistSheet(io, d.campaignId, actor, actorPatch);

    const hitIds = tokensInAoe(action.aoe, p.originHex, p.aimHex, map.grid, tokens.forMap(src.mapId));
    if (hitIds.length === 0) { emitError(socket, `${action.label} caught no one in its area.`); return; }

    if (action.saveId) {
      const casterDc = Math.round(Number(systemFor(actor.system).derive(actor.sheet).spellDc)) || 10;
      runGroupSave(io, {
        campaignId: d.campaignId, userId: d.userId, username: d.username,
        tokenIds: hitIds, saveId: action.saveId, dc: casterDc,
        damageExpr: action.amountExpr, onSave: action.onSave ?? 'half',
        damageType: action.damageType, label: action.label,
      });
      return;
    }

    // No save (rare — every compendium AoE spell has one, but a homebrew
    // action might not): everyone caught in the area takes the same roll.
    const dmg = roll(action.amountExpr);
    const base = Math.max(0, dmg.total);
    const undo: UndoEntry[] = [];
    for (const tid of hitIds) {
      const tok = tokens.byId(tid);
      if (!tok) continue;
      const ch = tok.characterId ? characters.byId(tok.characterId) : undefined;
      let amt = base;
      if (ch && action.damageType) amt = applyDamageMultiplier(amt, damageMultiplier(ch.sheet, action.damageType));
      if (amt <= 0) continue;
      if (ch) {
        applyHpDelta(io, d.campaignId, ch, -amt);
        undo.push({ t: 'hp', characterId: ch.id, delta: -amt });
      } else if (tok.bar) {
        const nh = Math.max(0, tok.bar.hp - amt);
        tokens.update(tok.id, { bar: { hp: nh, maxHp: tok.bar.maxHp } });
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
        undo.push({ t: 'hp', tokenId: tok.id, delta: -amt });
      }
      floatHp(io, d.campaignId, tok.mapId, tok.id, -amt);
    }
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll', text: `${actor.name} casts ${action.label}`, roll: dmg, recipients: null,
    }, undo.length > 0 ? undo : undefined);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    syncMapVision(io, d.campaignId, src.mapId);
  }));

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
  }));

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
    let outcome: string;
    if (v === 20) {
      // Nat 20: regain 1 HP and wake up (applyHpDelta clears unconscious).
      applyHpDelta(io, d.campaignId, characters.byId(characterId)!, 1);
      outcome = 'NAT 20 — back up with 1 HP!';
      succ = 0; fail = 0;
      persistSheet(io, d.campaignId, characters.byId(characterId)!, { deathSuccesses: 0, deathFailures: 0 });
      const msg = chat.add(d.campaignId, {
        userId: d.userId, fromName: d.username, kind: 'roll',
        text: `${character.name} death save: ${outcome}`, roll: br, recipients: null,
      });
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
      return;
    }
    if (v === 1) fail += 2;
    else if (v >= 10) succ += 1;
    else fail += 1;

    const patch: SheetData = { deathSuccesses: Math.min(3, succ), deathFailures: Math.min(3, fail) };
    if (fail >= 3) { patch.conditions = [...conditionsOf(character.sheet).filter((c) => c !== 'unconscious'), 'dead']; outcome = 'THIRD FAILURE — dead'; }
    else if (succ >= 3) { patch.deathSuccesses = 0; patch.deathFailures = 0; outcome = 'stabilized'; }
    else outcome = v >= 10 ? `success (${Math.min(3, succ)}/3)` : `failure (${Math.min(3, fail)}/3)`;
    persistSheet(io, d.campaignId, characters.byId(characterId)!, patch);
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text: `${character.name} death save: ${v} — ${outcome}`, roll: br, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }));

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
  }));

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
  }));

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
  }));

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
  }));

  socket.on(C2S.INIT_NEXT, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    if (state.entries.length === 0) return;
    state.turnIdx++;
    if (state.turnIdx >= state.entries.length) {
      state.turnIdx = 0;
      state.round++;
    }
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }));

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
  }));

  socket.on(C2S.INIT_SORT, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const state = initiative.get(d.campaignId);
    state.entries.sort((a, b) => b.value - a.value);
    state.turnIdx = 0;
    initiative.set(d.campaignId, state);
    broadcastInitiative(io, d.campaignId);
  }));

  socket.on(C2S.INIT_CLEAR, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    initiative.set(d.campaignId, { entries: [], turnIdx: 0, round: 1, active: false });
    broadcastInitiative(io, d.campaignId);
  }));

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
  }));

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
  }));
}
