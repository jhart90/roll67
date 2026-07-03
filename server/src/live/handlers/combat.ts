import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor, combatActions, hexDistance, num,
  type CombatActionPayload, type InitAddPayload, type InitRemovePayload, type InitRollMapPayload,
  type InitUpdatePayload, type InitiativeState, type SheetData,
} from 'shared';
import { campaigns, characters, chat, initiative, maps, tokens } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { setCharacterHp, floatHp } from '../hp.js';
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

    // To-hit (weapons). Nat 20 always hits, nat 1 always misses; otherwise
    // compare to the target's AC when known, else auto-resolve as a hit.
    let hit = true;
    let attackBreakdown: ReturnType<typeof roll> | null = null;
    let hitLabel = '';
    if (action.attackExpr) {
      const expr = applyAdv(action.attackExpr, action.attackExpr.toLowerCase().startsWith('1d20') ? p.adv : null);
      attackBreakdown = roll(expr);
      const d20s = attackBreakdown.dice.filter((x) => x.sides === 20 && x.kept);
      const nat20 = d20s.some((x) => x.value === 20);
      const nat1 = d20s.some((x) => x.value === 1);
      const ac = targetChar ? num(targetChar.sheet, 'ac', 0) : 0;
      hit = nat1 ? false : nat20 ? true : ac > 0 ? attackBreakdown.total >= ac : true;
      hitLabel = ` — attack ${attackBreakdown.total}${nat20 ? ' (crit!)' : ''} · ${hit ? 'HIT' : 'MISS'}`;
    }

    const amountRoll = roll(action.amountExpr);
    const magnitude = Math.max(0, amountRoll.total);
    const applied = action.effect === 'heal' ? magnitude : (hit ? magnitude : 0);
    const delta = action.effect === 'heal' ? applied : -applied;

    // Apply to the target's HP (character-backed or bare token bar) + float.
    let hpNote = '';
    if (applied !== 0) {
      if (targetChar) {
        const cur = systemFor(targetChar.system).hp(targetChar.sheet).hp;
        const updated = setCharacterHp(io, d.campaignId, targetChar, cur + delta);
        const nh = systemFor(updated.system).hp(updated.sheet);
        hpNote = ` (${tgt.name} ${nh.hp}/${nh.maxHp})`;
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
