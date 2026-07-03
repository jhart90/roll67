import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, DiceParseError, roll, systemFor,
  type ChatMessage, type ChatPayload, type DeleteMacroPayload,
  type ReorderMacrosPayload, type SaveMacroPayload, type SheetRollPayload,
} from 'shared';
import { campaigns, characters, chat, macros } from '../../db/repos.js';
import { campaignRoom, emitError, safe, sdata, userRoom } from '../hub.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

/** Broadcast a persisted chat message to exactly the people who may see it. */
function deliver(io: Server, campaignId: string, msg: ChatMessage): void {
  if (msg.kind === 'whisper' && msg.recipients) {
    const members = campaigns.members(campaignId);
    const targets = new Set<string>();
    if (msg.fromUserId) targets.add(msg.fromUserId);
    for (const name of msg.recipients) {
      const m = members.find((x) => x.username.toLowerCase() === name.toLowerCase());
      if (m) targets.add(m.userId);
    }
    for (const userId of targets) {
      io.to(userRoom(userId)).emit(S2C.CHAT, { msg });
    }
  } else {
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
  }
}

/** Apply advantage/disadvantage to an expression that starts with 1d20. */
export function applyAdv(expr: string, adv: 'adv' | 'dis' | null | undefined): string {
  if (!adv) return expr;
  const lower = expr.toLowerCase();
  if (lower.startsWith('1d20')) {
    return (adv === 'adv' ? '2d20kh1' : '2d20kl1') + expr.slice(4);
  }
  return expr;
}

export function registerChatHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.CHAT, safe(socket, ({ text }: ChatPayload) => {
    const d = requireCampaign(socket);
    handleChatText(io, socket, d.campaignId, d.userId, d.username, d.role, String(text ?? '').trim(), 0);
  }));

  socket.on(C2S.SHEET_ROLL, safe(socket, ({ characterId, rollableId, adv }: SheetRollPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) {
      emitError(socket, 'You can only roll from your own sheet.');
      return;
    }
    const rollable = systemFor(character.system).rollables(character.sheet).find((r) => r.id === rollableId);
    if (!rollable) throw new Error('Unknown roll.');
    const expr = applyAdv(rollable.expr, rollable.d20 ? adv : null);
    const breakdown = roll(expr);
    const label = `${character.name}: ${rollable.label}${adv === 'adv' ? ' (advantage)' : adv === 'dis' ? ' (disadvantage)' : ''}`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId,
      fromName: d.username,
      kind: 'roll',
      text: label,
      roll: breakdown,
      recipients: null,
    });
    deliver(io, d.campaignId, msg);
  }));

  socket.on(C2S.SAVE_MACRO, safe(socket, ({ macro }: SaveMacroPayload) => {
    const d = requireCampaign(socket);
    const bound = !!(macro?.characterId && macro?.rollableId);
    if (!macro?.name?.trim()) throw new Error('Give the pill a name.');
    if (!bound && !macro?.command?.trim()) throw new Error('A pill needs a command or a sheet roll.');
    macros.save(d.userId, d.campaignId, {
      id: macro.id,
      name: macro.name.trim(),
      command: (macro.command ?? '').trim(),
      color: macro.color ?? null,
      characterId: macro.characterId ?? null,
      rollableId: macro.rollableId ?? null,
    });
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }));

  socket.on(C2S.REORDER_MACROS, safe(socket, ({ macroIds }: ReorderMacrosPayload) => {
    const d = requireCampaign(socket);
    if (Array.isArray(macroIds)) macros.reorder(d.userId, d.campaignId, macroIds);
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }));

  socket.on(C2S.DELETE_MACRO, safe(socket, ({ macroId }: DeleteMacroPayload) => {
    const d = requireCampaign(socket);
    macros.delete(d.userId, macroId);
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }));
}

/** Roll a character-sheet rollable and post the result (shared by pills). */
function runSheetRoll(
  io: Server, socket: Socket, campaignId: string, userId: string, username: string,
  role: 'dm' | 'player', characterId: string, rollableId: string,
): void {
  const character = characters.byId(characterId);
  if (!character || character.campaignId !== campaignId) throw new Error('Unknown character.');
  if (role !== 'dm' && character.ownerUserId !== userId) {
    emitError(socket, 'You can only roll from your own sheet.');
    return;
  }
  const rollable = systemFor(character.system).rollables(character.sheet).find((r) => r.id === rollableId);
  if (!rollable) throw new Error('That roll is no longer on the sheet.');
  const breakdown = roll(rollable.expr);
  const msg = chat.add(campaignId, {
    userId, fromName: username, kind: 'roll',
    text: `${character.name}: ${rollable.label}`, roll: breakdown, recipients: null,
  });
  deliver(io, campaignId, msg);
}

function handleChatText(
  io: Server,
  socket: Socket,
  campaignId: string,
  userId: string,
  username: string,
  role: 'dm' | 'player',
  text: string,
  depth: number,
): void {
  if (!text) return;
  if (text.length > 2000) {
    emitError(socket, 'Message too long.');
    return;
  }

  // #macro — run a saved macro's command.
  if (text.startsWith('#')) {
    if (depth > 2) {
      emitError(socket, 'Macros cannot call macros this deep.');
      return;
    }
    const name = text.slice(1).split(/\s/)[0];
    const macro = macros.forUser(userId, campaignId).find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!macro) {
      emitError(socket, `No macro named "${name}".`);
      return;
    }
    // A pill bound to a sheet roll stays live with the character's stats.
    if (macro.characterId && macro.rollableId) {
      runSheetRoll(io, socket, campaignId, userId, username, role, macro.characterId, macro.rollableId);
      return;
    }
    handleChatText(io, socket, campaignId, userId, username, role, macro.command, depth + 1);
    return;
  }

  // /r or /roll — public roll.
  const rollMatch = text.match(/^\/r(?:oll)?\s+(.+)$/i);
  if (rollMatch) {
    try {
      const breakdown = roll(rollMatch[1]);
      const msg = chat.add(campaignId, {
        userId, fromName: username, kind: 'roll', text: '', roll: breakdown, recipients: null,
      });
      deliver(io, campaignId, msg);
    } catch (err) {
      if (err instanceof DiceParseError) emitError(socket, err.message);
      else throw err;
    }
    return;
  }

  // /gr — roll seen only by the roller and the DM.
  const gmRollMatch = text.match(/^\/gr\s+(.+)$/i);
  if (gmRollMatch) {
    try {
      const breakdown = roll(gmRollMatch[1]);
      const dmNames = campaigns.members(campaignId).filter((m) => m.role === 'dm').map((m) => m.username);
      const msg = chat.add(campaignId, {
        userId, fromName: username, kind: 'whisper', text: '(GM roll)', roll: breakdown,
        recipients: dmNames,
      });
      deliver(io, campaignId, msg);
    } catch (err) {
      if (err instanceof DiceParseError) emitError(socket, err.message);
      else throw err;
    }
    return;
  }

  // /w name message — private whisper.
  const whisperMatch = text.match(/^\/w\s+(\S+)\s+(.+)$/i);
  if (whisperMatch) {
    const [, target, body] = whisperMatch;
    const member = campaigns.members(campaignId).find((m) => m.username.toLowerCase() === target.toLowerCase());
    if (!member) {
      emitError(socket, `Nobody called "${target}" here.`);
      return;
    }
    const msg = chat.add(campaignId, {
      userId, fromName: username, kind: 'whisper', text: body, roll: null,
      recipients: [member.username],
    });
    deliver(io, campaignId, msg);
    return;
  }

  if (text.startsWith('/')) {
    emitError(socket, 'Commands: /r <dice>, /gr <dice>, /w <player> <message>, #macro');
    return;
  }

  const msg = chat.add(campaignId, {
    userId, fromName: username, kind: 'say', text, roll: null, recipients: null,
  });
  deliver(io, campaignId, msg);
}
