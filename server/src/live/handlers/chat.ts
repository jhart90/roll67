import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, DiceParseError, SKILLS_SWADE, castableLevels, dieSides, fmtMod, num, roll, rows, splitRollLabel, str, summarizeRollStats, systemFor, traitExpr, traitModWhy,
  type CastSpellPayload, type ChatMessage, type ChatPayload, type DeleteMacroPayload,
  type ModerateMessagePayload, type ReorderMacrosPayload, type RollBreakdown, type RollStatRow, type RollStatsGetPayload,
  type RollStatsUserBlock, type SaveMacroPayload,
  sanitizeCard, swadeStowedRollable, type SheetData, type SheetRollPayload, type UndoEntry, type PostSheetCardPayload,
} from 'shared';
import { campaigns, characters, chat, macros, redactChat, rollStats, tokens } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { applyUndo } from '../undo.js';
// NOTE: hp.ts also imports applyAdv from this file -- a deliberate, safe
// circular import (both sides are hoisted function declarations used only at
// call time, never during module evaluation).
import { clearConcentrationEffects, critFailFor, recordBennyRoll } from '../hp.js';
import { ironDiceInfo, rotateIronDice } from '../ironDice.js';

/**
 * Itemize the flat modifier a player typed into `/r` themselves.
 *
 * Without this the card falls back to "sheet math", which is a guess and, for
 * a hand-typed expression, a wrong one — harmless while it hid in a tooltip,
 * misinformation once a player asks to read modifiers in the log. The amount
 * is derived the same way the card derives the chip it labels (total less the
 * dice that counted), so the two can never disagree whatever the expression.
 */
function typedModWhy(breakdown: RollBreakdown): string[] {
  const flat = breakdown.total - breakdown.dice.filter((d) => d.kept).reduce((s, d) => s + d.value, 0);
  return flat === 0 ? [] : [`${fmtMod(flat)} Typed into the roll command`];
}

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
  /**
   * Erase the whole log, for everyone, for good.
   *
   * The DM's act alone, and deliberately total: the rows go, the undo records
   * inside them go with them, and every screen empties at once. What remains
   * afterwards is one system line saying who did it — a log that starts with
   * its own erasure is honest about having been erased.
   */
  socket.on(C2S.CHAT_WIPE, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM wipes the chat log.'); return; }
    chat.clear(d.campaignId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT_WIPED, {});
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `🧹 ${d.username} wiped the chat log.`, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'CHAT_WIPE'));

  socket.on(C2S.CHAT, safe(socket, ({ text }: ChatPayload) => {
    const d = requireCampaign(socket);
    handleChatText(io, socket, d.campaignId, d.userId, d.username, d.role, String(text ?? '').trim(), 0);
  }, 'CHAT'));

  /**
   * Show a sheet card in the log. The card travels structured so the chat
   * renders the card itself; `text` carries the same facts flattened, as the
   * fallback for search and for any client that can't draw one.
   *
   * Everything is re-derived or clamped here rather than trusted: the card is
   * a client-authored object, and it lands in a log everyone reads.
   */
  socket.on(C2S.POST_SHEET_CARD, safe(socket, ({ characterId, card }: PostSheetCardPayload) => {
    const d = requireCampaign(socket);
    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) {
      emitError(socket, 'You can only post cards from your own sheet.');
      return;
    }
    const clean = sanitizeCard(card);
    if (!clean) { emitError(socket, 'Nothing to post.'); return; }
    const flat = [...clean.chips.map((c) => c.text), ...clean.notes].join(' · ');
    const msg = chat.add(d.campaignId, {
      userId: d.userId,
      fromName: d.username,
      fromCharacter: character.name, characterId: character.id,
      kind: 'say',
      text: `🗨 ${clean.name}${flat ? `: ${flat}` : ''}`,
      card: clean,
      roll: null,
      recipients: null,
    });
    deliver(io, d.campaignId, msg);
  }, 'POST_SHEET_CARD'));

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
    // A weapon that isn't in hand can't be swung or fired, from the rolls
    // column any more than from the action pane. Re-derived from the live
    // sheet so a pinned macro can't reach past the greyed-out button.
    if (character.system === 'swade' && swadeStowedRollable(character.sheet, rollableId)) {
      emitError(socket, `${rollable.label} isn't in hand — tick Wielded on its card first.`);
      return;
    }
    const expr = applyAdv(rollable.expr, rollable.d20 ? adv : null);
    const breakdown = roll(expr);
    if (character.system === 'swade') breakdown.modWhy = traitModWhy(character.sheet);
    const label = `${rollable.label}${adv === 'adv' ? ' (advantage)' : adv === 'dis' ? ' (disadvantage)' : ''}`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId,
      fromName: d.username,
      fromCharacter: character.name, characterId: character.id,
      kind: 'roll',
      text: label,
      roll: breakdown,
      recipients: null,
    });
    deliver(io, d.campaignId, msg);
  }, 'SHEET_ROLL'));

  // IronDice: current seed commitment + revealed history — public to anyone
  // at the table. Rotation (reveal + fresh seed) is DM-only and announced.
  socket.on(C2S.IRON_DICE_GET, safe(socket, () => {
    requireCampaign(socket);
    socket.emit(S2C.IRON_DICE, ironDiceInfo());
  }, 'IRON_DICE_GET'));

  socket.on(C2S.IRON_DICE_ROTATE, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can rotate the IronDice seed.'); return; }
    rotateIronDice();
    socket.emit(S2C.IRON_DICE, ironDiceInfo());
    const msg = chat.add(d.campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: '🛡 IronDice seed rotated — the previous seed is now revealed, so every roll thrown under it can be independently verified.',
      roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'IRON_DICE_ROTATE'));

  // Lifetime roll statistics: account-wide for every member (no characterId),
  // or one character's rolls broken out by who was rolling (characterId set).
  socket.on(C2S.ROLL_STATS_GET, safe(socket, ({ characterId }: RollStatsGetPayload) => {
    const d = requireCampaign(socket);
    const members = campaigns.members(d.campaignId);
    const nameOf = (uid: string) =>
      members.find((m) => m.userId === uid)?.username ?? (uid ? 'former member' : 'NPCs / system');
    let users: RollStatsUserBlock[];
    if (characterId) {
      const ch = characters.byId(characterId);
      if (!ch || ch.campaignId !== d.campaignId) return;
      const byUser = new Map<string, RollStatRow[]>();
      for (const r of rollStats.forCharacter(d.campaignId, characterId)) {
        const list = byUser.get(r.user_id) ?? [];
        list.push(r);
        byUser.set(r.user_id, list);
      }
      users = [...byUser.entries()].map(([uid, rs]) => ({
        userId: uid, username: nameOf(uid), summary: summarizeRollStats(rs),
      }));
    } else {
      users = members.map((m) => ({
        userId: m.userId, username: m.username,
        summary: summarizeRollStats(rollStats.forUser(d.campaignId, m.userId)),
      }));
    }
    users.sort((a, b) => b.summary.lifetime - a.summary.lifetime);
    socket.emit(S2C.ROLL_STATS, { characterId: characterId ?? null, users });
  }, 'ROLL_STATS_GET'));

  socket.on(C2S.SAVE_MACRO, safe(socket, ({ macro }: SaveMacroPayload) => {
    const d = requireCampaign(socket);
    const bound = !!(macro?.characterId && (macro?.rollableId || macro?.actionId));
    if (!macro?.name?.trim()) throw new Error('Give the pill a name.');
    if (!bound && !macro?.command?.trim()) throw new Error('A pill needs a command, a sheet roll, or an action.');
    macros.save(d.userId, d.campaignId, {
      id: macro.id,
      name: macro.name.trim(),
      command: (macro.command ?? '').trim(),
      color: macro.color ?? null,
      characterId: macro.characterId ?? null,
      rollableId: macro.rollableId ?? null,
      actionId: macro.actionId ?? null,
    });
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }, 'SAVE_MACRO'));

  socket.on(C2S.CAST_SPELL, safe(socket, ({ characterId, rollableId, slotLevel }: CastSpellPayload) => {
    const d = requireCampaign(socket);
    let character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) {
      emitError(socket, 'You can only cast from your own sheet.');
      return;
    }
    const rollable = systemFor(character.system).rollables(character.sheet).find((r) => r.id === rollableId);
    if (!rollable) throw new Error('That spell is no longer on the sheet.');
    const minLevel = rollable.slotLevel ?? 1;
    const level = Math.floor(slotLevel);
    if (!castableLevels(character.sheet, minLevel).includes(level)) {
      emitError(socket, `No level-${level} spell slot available.`);
      return;
    }
    // Spend the slot. A concentration spell also becomes the active
    // concentration, ending any prior one -- including any conditions the
    // prior spell was maintaining on its targets.
    const patch: SheetData = { [`slotsUsed${level}`]: num(character.sheet, `slotsUsed${level}`, 0) + 1 };
    const undo: UndoEntry[] = [{ t: 'slot', characterId, level }];
    let concNote = '';
    const m = /^spell_(\d+)$/.exec(rollableId);
    if (m) {
      const row = rows(character.sheet, 'spells')[Number(m[1])];
      if (row && row.conc === true) {
        const name = str(row, 'name', 'a spell');
        const prev = str(character.sheet, 'concentration', '');
        if (prev && prev !== name) character = clearConcentrationEffects(io, d.campaignId, character);
        patch.concentration = name;
        undo.push({ t: 'field', characterId, key: 'concentration', value: prev });
        if (prev && prev !== name) concNote = ` (concentration on ${prev} ends)`;
      }
    }
    characters.update(characterId, undefined, { ...character.sheet, ...patch });
    const updated = characters.byId(characterId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
    if (updated.ownerUserId) io.to(userRoom(updated.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });

    const breakdown = roll(rollable.expr);
  if (character.system === 'swade') breakdown.modWhy = traitModWhy(character.sheet);
    const atLabel = level > minLevel ? ` (cast at level ${level})` : '';
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: character.name, characterId: character.id, kind: 'roll',
      text: `${rollable.label}${atLabel}${concNote}`, roll: breakdown, recipients: null,
    }, undo);
    deliver(io, d.campaignId, msg);
  }, 'CAST_SPELL'));

  // DM hides / unhides a chat message, optionally undoing its recorded effects.
  socket.on(C2S.MODERATE_MESSAGE, safe(socket, ({ messageId, action }: ModerateMessagePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can moderate the chat.'); return; }
    const existing = chat.byId(messageId);
    if (!existing) return;
    // A cast card owns a whole resolution — the activation roll, every save,
    // the damage, every impact line. Hiding it hides all of them, because
    // hiding the announcement and leaving its consequences on screen tells a
    // story that no longer happened.
    // Deleting is not hiding harder: the rows go, so there is nothing left to
    // redact, unhide or undo from. Undo entries are applied FIRST if they are
    // still there, because a message that is about to stop existing cannot be
    // asked later what it did.
    if (action === 'delete') {
      const gone = chat.deleteThread(messageId);
      if (gone.length === 0) return;
      io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT_REMOVED, { messageIds: gone });
      return;
    }
    const touched = chat.setThreadHidden(messageId, action !== 'unhide');
    if (action === 'hideUndo') {
      const entries = chat.undoFor(messageId) as UndoEntry[] | null;
      if (Array.isArray(entries) && entries.length > 0) {
        applyUndo(io, d.campaignId, entries);
        chat.clearUndo(messageId);
      }
    }
    for (const id of touched) {
      const updated = chat.byId(id);
      if (!updated) continue;
      for (const s of campaignSockets(io, d.campaignId)) {
        s.emit(S2C.CHAT_UPDATED, { msg: redactChat(updated, sdata(s).role === 'dm') });
      }
    }
  }, 'MODERATE_MESSAGE'));

  socket.on(C2S.REORDER_MACROS, safe(socket, ({ macroIds }: ReorderMacrosPayload) => {
    const d = requireCampaign(socket);
    if (Array.isArray(macroIds)) macros.reorder(d.userId, d.campaignId, macroIds);
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }, 'REORDER_MACROS'));

  socket.on(C2S.DELETE_MACRO, safe(socket, ({ macroId }: DeleteMacroPayload) => {
    const d = requireCampaign(socket);
    macros.delete(d.userId, macroId);
    socket.emit(S2C.MACROS, { macros: macros.forUser(d.userId, d.campaignId) });
  }, 'DELETE_MACRO'));
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
  if (character.system === 'swade') breakdown.modWhy = traitModWhy(character.sheet);
  // Any SWADE sheet roll is a trait test a Benny may reroll — unless it came
  // up a Critical Failure, which the book says must be accepted.
  const sheetCritFail = character.system === 'swade'
    && critFailFor(io, campaignId, character, breakdown.dice);
  recordBennyRoll(io, campaignId, character, 'trait', rollable.expr, breakdown.total, rollable.label, sheetCritFail);
  // The banner over the map while these dice are in the air. A damage roll
  // off the sheet is not a trait test, and the table can see which is which.
  const isDamage = /^damage_/.test(rollable.id) || /damage/i.test(rollable.label);
  const msg = chat.add(campaignId, {
    callout: { what: isDamage ? `${rollable.label} — damage` : `${rollable.label} — trait test`, tone: isDamage ? 'damage' : 'trait' },
    userId, fromName: username, fromCharacter: character.name, characterId: character.id, kind: 'roll',
    text: rollable.label, roll: breakdown, recipients: null,
  });
  deliver(io, campaignId, msg);
}

// Common shorthand for trait names, expanded before prefix matching.
const TRAIT_ALIASES: Record<string, string> = {
  str: 'strength', agi: 'agility', ag: 'agility', vig: 'vigor', vi: 'vigor',
  spi: 'spirit', sp: 'spirit', sma: 'smarts', sm: 'smarts',
  dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma',
  ck: 'common knowledge', know: 'common knowledge', kn: 'common knowledge',
};

/**
 * "/r spirit+2", "/r str-2", "/r hack" — a trait roll straight off the
 * sender's character sheet, resolved by (abbreviated) attribute or skill
 * name with an optional flat modifier. Returns true when the text was
 * handled as a trait roll (including handled-with-an-error); false hands
 * the text back to the plain dice parser.
 */
function tryTraitRoll(
  io: Server, socket: Socket, campaignId: string, userId: string, username: string,
  raw: string, gm: boolean,
): boolean {
  // A trait query is words (letters only) with an optional trailing ±N —
  // anything with digits or dice syntax in the name is not ours.
  const m = /^([a-z][a-z '’-]*(?:\s+[a-z][a-z '’-]*)*)\s*(?:([+-])\s*(\d+))?$/i.exec(raw.trim());
  if (!m) return false;
  const mod = m[3] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
  const query = (() => {
    const q = m[1].replace(/\s+/g, ' ').trim().toLowerCase();
    return TRAIT_ALIASES[q] ?? q;
  })();

  // The roll comes off a sheet: the sender's character — when they own
  // several, prefer the one standing on the campaign's active map.
  const mine = characters.forCampaign(campaignId).filter((c) => c.ownerUserId === userId);
  let character = mine[0];
  if (mine.length > 1) {
    const activeMapId = campaigns.byId(campaignId)?.activeMapId;
    if (activeMapId) {
      const onMap = tokens.forMap(activeMapId);
      character = mine.find((c) => onMap.some((t) => t.characterId === c.id)) ?? mine[0];
    }
  }
  if (!character) {
    emitError(socket, 'No character of yours here to roll for — /r <trait name>[±N] rolls off your sheet.');
    return true;
  }

  const list = systemFor(character.system).rollables(character.sheet);
  const baseOf = (label: string) => label.split(' (')[0].trim().toLowerCase();
  let matches = list.filter((r) => baseOf(r.label) === query);
  if (matches.length === 0) matches = list.filter((r) => baseOf(r.label).startsWith(query));
  if (matches.length > 1) {
    // "str" in 5e prefixes both the check and the save; a lone attribute
    // match ("per" → the Persuasion SKILL vs Performance) stays ambiguous.
    const attrs = matches.filter((r) => r.group === 'Attributes');
    if (attrs.length === 1) matches = attrs;
  }
  if (matches.length > 1) {
    emitError(socket, `Which one? ${matches.slice(0, 5).map((r) => r.label.split(' (')[0].trim()).join(', ')} — spell out more of the name.`);
    return true;
  }

  let label: string; let expr: string;
  if (matches.length === 1) {
    label = matches[0].label;
    expr = matches[0].expr;
  } else if (character.system === 'swade') {
    // A real SWADE skill the character never trained: the unskilled d4−2.
    const named = SKILLS_SWADE.filter((s) => s.toLowerCase().startsWith(query));
    if (named.length > 1) {
      emitError(socket, `Which one? ${named.join(', ')} — spell out more of the name.`);
      return true;
    }
    if (named.length === 0) {
      emitError(socket, `No attribute or skill called “${m[1].trim()}” on ${character.name}’s sheet.`);
      return true;
    }
    label = `${named[0]} (unskilled d4−2)`;
    expr = traitExpr(character.sheet, dieSides(''));
  } else {
    emitError(socket, `No attribute or skill called “${m[1].trim()}” on ${character.name}’s sheet.`);
    return true;
  }

  if (mod) expr += fmtMod(mod);
  const breakdown = roll(expr);
  const manualWhy = mod ? [`${fmtMod(mod)} Manual modifier — typed into the roll command`] : [];
  if (character.system === 'swade') breakdown.modWhy = [...traitModWhy(character.sheet), ...manualWhy];
  else if (mod) breakdown.modWhy = manualWhy;
  const text = `${label}${mod ? ` ${fmtMod(mod)}` : ''}`;
  if (character.system === 'swade') {
    const critFail = critFailFor(io, campaignId, character, breakdown.dice);
    recordBennyRoll(io, campaignId, character, 'trait', expr, breakdown.total, text, critFail);
  }
  const dmNames = gm
    ? campaigns.members(campaignId).filter((x) => x.role === 'dm').map((x) => x.username)
    : null;
  const msg = chat.add(campaignId, {
    userId, fromName: username, fromCharacter: character.name, characterId: character.id,
    kind: gm ? 'whisper' : 'roll',
    text: gm ? `(GM roll) ${text}` : text,
    roll: breakdown, recipients: dmNames,
  });
  deliver(io, campaignId, msg);
  return true;
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

  // /r or /roll — public roll: a dice expression, or a sheet trait by name.
  const rollMatch = text.match(/^\/r(?:oll)?\s+(.+)$/i);
  if (rollMatch) {
    if (tryTraitRoll(io, socket, campaignId, userId, username, rollMatch[1], false)) return;
    try {
      // "/r 1d20+3 # Stealth check" — anything after the first # labels the
      // roll, so a bare expression isn't the only thing the table sees.
      const { expr, label } = splitRollLabel(rollMatch[1]);
      const breakdown = roll(expr);
      breakdown.modWhy = typedModWhy(breakdown);
      const msg = chat.add(campaignId, {
        userId, fromName: username, kind: 'roll', text: label, roll: breakdown, recipients: null,
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
    if (tryTraitRoll(io, socket, campaignId, userId, username, gmRollMatch[1], true)) return;
    try {
      const { expr, label } = splitRollLabel(gmRollMatch[1]);
      const breakdown = roll(expr);
      breakdown.modWhy = typedModWhy(breakdown);
      const dmNames = campaigns.members(campaignId).filter((m) => m.role === 'dm').map((m) => m.username);
      const msg = chat.add(campaignId, {
        userId, fromName: username, kind: 'whisper', text: label ? `(GM roll) ${label}` : '(GM roll)', roll: breakdown,
        recipients: dmNames,
      });
      deliver(io, campaignId, msg);
    } catch (err) {
      if (err instanceof DiceParseError) emitError(socket, err.message);
      else throw err;
    }
    return;
  }

  // /w <player | character | dm> message — private whisper. The target can
  // be an account name, one of their characters' names (usually multi-word),
  // or the literal 'dm'. The longest name that prefixes the text wins; the
  // rest is the message.
  const whisperMatch = text.match(/^\/w\s+(.+)$/i);
  if (whisperMatch) {
    const rest = whisperMatch[1];
    const members = campaigns.members(campaignId);
    const campaign = campaigns.byId(campaignId);
    const candidates: Array<{ name: string; userId: string }> = members.map((m) => ({ name: m.username, userId: m.userId }));
    if (campaign) candidates.push({ name: 'dm', userId: campaign.dmUserId });
    for (const c of characters.forCampaign(campaignId)) {
      if (c.ownerUserId) candidates.push({ name: c.name, userId: c.ownerUserId });
    }
    const lower = rest.toLowerCase();
    let best: { userId: string; len: number } | null = null;
    for (const cand of candidates) {
      const n = cand.name.trim().toLowerCase();
      if (n && lower.startsWith(`${n} `) && (!best || n.length > best.len)) {
        best = { userId: cand.userId, len: n.length };
      }
    }
    if (!best) {
      emitError(socket, 'Whisper who? /w <player, character, or dm> <message> — no matching name here.');
      return;
    }
    const body = rest.slice(best.len).trim();
    const member = members.find((m) => m.userId === best!.userId);
    if (!member) { emitError(socket, 'They are not in this campaign.'); return; }
    if (!body) { emitError(socket, 'Say something: /w <name> <message>.'); return; }
    const msg = chat.add(campaignId, {
      userId, fromName: username, kind: 'whisper', text: body, roll: null,
      recipients: [member.username],
    });
    deliver(io, campaignId, msg);
    return;
  }

  if (text.startsWith('/')) {
    emitError(socket, 'Commands: /r <dice or trait name±N> [# label], /gr <dice or trait> [# label], /w <player, character, or dm> <message>, #macro — e.g. /r spirit+2, /r hack-1');
    return;
  }

  const msg = chat.add(campaignId, {
    userId, fromName: username, kind: 'say', text, roll: null, recipients: null,
  });
  deliver(io, campaignId, msg);
}
