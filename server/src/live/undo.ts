import type { Server } from 'socket.io';
import { S2C, num, type SheetData, type UndoEntry } from 'shared';
import { characters, tokens } from '../db/repos.js';
import { applyHpDelta, persistSheet } from './hp.js';
import { dmRoom } from './hub.js';
import { syncMapVision } from './visionService.js';

/**
 * Reverse the recorded effects of a roll. HP entries re-apply the opposite
 * delta (which also un-downs a creature and refreshes its token bar via
 * applyHpDelta); slot/item entries refund a use; field entries restore a
 * captured prior value.
 */
export function applyUndo(io: Server, campaignId: string, entries: UndoEntry[]): void {
  const touchedMaps = new Set<string>();
  for (const e of entries) {
    if (e.t === 'hp') {
      if (e.characterId) {
        const ch = characters.byId(e.characterId);
        if (ch) applyHpDelta(io, campaignId, ch, -e.delta, 'Undo');
      } else if (e.tokenId) {
        const tok = tokens.byId(e.tokenId);
        if (tok?.bar) {
          const cap = tok.bar.maxHp > 0 ? tok.bar.maxHp : Math.max(0, tok.bar.hp - e.delta);
          const nh = Math.max(0, Math.min(cap, tok.bar.hp - e.delta));
          tokens.update(tok.id, { bar: { hp: nh, maxHp: tok.bar.maxHp } });
          io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(tok.id)! });
          touchedMaps.add(tok.mapId);
        }
      }
    } else if (e.t === 'slot') {
      const ch = characters.byId(e.characterId);
      if (ch) persistSheet(io, campaignId, ch, { [`slotsUsed${e.level}`]: Math.max(0, num(ch.sheet, `slotsUsed${e.level}`, 0) - 1) });
    } else if (e.t === 'item') {
      const ch = characters.byId(e.characterId);
      if (ch) {
        const inv = Array.isArray(ch.sheet.inventory) ? [...(ch.sheet.inventory as SheetData[])] : [];
        const row = inv[e.index];
        if (row) {
          inv[e.index] = { ...row, qty: num(row, 'qty', 0) + 1 };
          persistSheet(io, campaignId, ch, { inventory: inv });
        }
      }
    } else if (e.t === 'field') {
      const ch = characters.byId(e.characterId);
      if (ch) persistSheet(io, campaignId, ch, { [e.key]: e.value } as SheetData);
    }
  }
  for (const m of touchedMaps) syncMapVision(io, campaignId, m);
}
