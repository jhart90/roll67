import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, roll, systemFor,
  type InitAddPayload, type InitRemovePayload, type InitUpdatePayload,
  type InitiativeState,
} from 'shared';
import { campaigns, characters, chat, initiative, tokens } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata } from '../hub.js';

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
