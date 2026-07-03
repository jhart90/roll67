import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor, combatActions, critRange, hexDistance, num,
  applyDamageMultiplier, attackAdvantage, conditionCombat, conditionsOf, critDamageExpr,
  damageMultiplier, multiplierLabel,
  type CombatActionPayload, type DeathSavePayload, type InitAddPayload, type InitRemovePayload,
  type InitRollMapPayload, type InitUpdatePayload, type InitiativeState, type RequestSavePayload,
  type SheetData,
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

export function registerCombatHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.COMBAT_ACTION, safe(socket, (p: CombatActionPayload) => {
    const d = requireCampaign(socket);
    const actor = characters.byId(p.characterId);
    if (!actor || actor.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && actor.ownerUserId !== d.userId) {
      emitError(socket, 'You can only act with your own character.');
      return;
    }
    const action = combatActions(actor).find((a) => a.id === p.actionId);
    if (!action) { emitError(socket, 'That action is no longer available.'); return; }

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

    // To-hit (weapons). Nat 20 always hits, nat 1 always misses; otherwise
    // compare to the target's AC when known, else auto-resolve as a hit.
    let hit = true;
    let crit = false;
    let attackBreakdown: ReturnType<typeof roll> | null = null;
    let hitLabel = '';
    if (action.attackExpr) {
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
      const ac = targetChar ? num(targetChar.sheet, 'ac', 0) : 0;
      hit = nat1 ? false : crit ? true : ac > 0 ? attackBreakdown.total >= ac : true;
      const advTag = netAdv === 'adv' ? ' [adv]' : netAdv === 'dis' ? ' [dis]' : '';
      hitLabel = ` — attack ${attackBreakdown.total}${advTag}${crit ? ' (crit!)' : ''} · ${hit ? 'HIT' : 'MISS'}`;
    }

    // Damage: a crit doubles the dice. Resistance/vulnerability/immunity from the
    // target's sheet then scales the total.
    const dmgExpr = crit ? critDamageExpr(action.amountExpr) : action.amountExpr;
    const amountRoll = roll(dmgExpr);
    let magnitude = Math.max(0, amountRoll.total);
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
      } else if (tgt.bar) {
        const cap = tgt.bar.maxHp > 0 ? tgt.bar.maxHp : tgt.bar.hp + delta;
        const nh = Math.max(0, Math.min(cap, tgt.bar.hp + delta));
        tokens.update(tgt.id, { bar: { hp: nh, maxHp: tgt.bar.maxHp } });
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tgt.id)! });
        syncMapVision(io, d.campaignId, src.mapId);
        hpNote = ` (${tgt.name} ${nh}/${tgt.bar.maxHp})`;
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
    });
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

  // DM "call for save": every listed token rolls its own save vs the DC; the
  // shared damage roll (if any) is applied fully on a fail, halved/negated on a
  // save. One chat card summarizes the group.
  socket.on(C2S.REQUEST_SAVE, safe(socket, (p: RequestSavePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM calls for saves.'); return; }
    const dmg = p.damageExpr && /\d*d\d/i.test(p.damageExpr) ? roll(p.damageExpr) : null;
    const base = dmg ? Math.max(0, dmg.total) : 0;
    let saveLabel = p.saveId;
    let touchedMap: string | null = null;
    const lines: string[] = [];
    for (const tid of p.tokenIds) {
      const tok = tokens.byId(tid);
      if (!tok) continue;
      touchedMap = tok.mapId;
      const ch = tok.characterId ? characters.byId(tok.characterId) : undefined;
      let passed: boolean; let total: number; let threshold: number;
      if (ch) {
        const sc = systemFor(ch.system).saveCheck(ch.sheet, p.saveId, p.dc);
        const br = roll(sc.expr);
        total = br.total; threshold = sc.threshold; passed = total >= threshold; saveLabel = sc.label;
      } else {
        const br = roll('1d20'); total = br.total; threshold = p.dc; passed = total >= p.dc;
      }
      let dealt = 0;
      if (base > 0) {
        let amt = passed ? (p.onSave === 'half' ? Math.floor(base / 2) : 0) : base;
        if (ch && p.damageType) amt = applyDamageMultiplier(amt, damageMultiplier(ch.sheet, p.damageType));
        if (amt > 0) {
          if (ch) applyHpDelta(io, d.campaignId, ch, -amt);
          else if (tok.bar) {
            const nh = Math.max(0, tok.bar.hp - amt);
            tokens.update(tok.id, { bar: { hp: nh, maxHp: tok.bar.maxHp } });
            io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
          }
          floatHp(io, d.campaignId, tok.mapId, tok.id, -amt);
          dealt = amt;
        }
      }
      lines.push(`${tok.name} ${total} vs ${threshold} — ${passed ? 'save' : 'fail'}${dealt ? ` (−${dealt})` : ''}`);
    }
    if (touchedMap) syncMapVision(io, d.campaignId, touchedMap);
    if (lines.length === 0) { emitError(socket, 'No valid targets for the save.'); return; }
    const header = `${p.label?.trim() || 'Saving throw'} — ${saveLabel}${p.damageExpr ? ` DC ${p.dc}` : ''}`;
    const text = `${header}: ${lines.join('; ')}`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll', text, roll: dmg, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    io.to(campaignRoom(d.campaignId)).emit(S2C.TABLE_RESULT, { text: header, color: '#c98a3c' });
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
