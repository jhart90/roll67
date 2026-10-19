import type { Server, Socket } from 'socket.io';
import { C2S, S2C, qyApply, type QyActionPayload } from 'shared';
import { campaigns, quietYear } from '../../db/repos.js';
import { campaignRoom, emitError, safe, sdata } from '../hub.js';
import { postStatusLine } from '../hp.js';

/**
 * The Quiet Year at the table: every rule lives in shared/quietYear.ts. This
 * handler checks the campaign is playing it, applies the action as whoever
 * sent it, stores the result, and shows it to everyone — the whole year is
 * public, the way the cards, the dice and the map are on a real table.
 */
export function registerQuietYearHandlers(io: Server, socket: Socket): void {
  const requireQy = () => {
    const d = sdata(socket);
    if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
    if (campaigns.byId(d.campaignId)?.system !== 'quietyear') throw new Error('This campaign is not playing The Quiet Year.');
    return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
  };

  socket.on(C2S.QY_GET, safe(socket, () => {
    const d = requireQy();
    socket.emit(S2C.QY_STATE, { state: quietYear.get(d.campaignId) });
  }, 'QY_GET'));

  socket.on(C2S.QY_ACTION, safe(socket, ({ action }: QyActionPayload) => {
    const d = requireQy();
    if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') return;
    const before = quietYear.get(d.campaignId);
    const result = qyApply(before, action, { userId: d.userId, name: d.username, isDm: d.role === 'dm' });
    if (result.error) { emitError(socket, result.error); return; }
    quietYear.set(d.campaignId, result.state);
    io.to(campaignRoom(d.campaignId)).emit(S2C.QY_STATE, { state: result.state });
    for (const line of result.announce ?? []) postStatusLine(io, d.campaignId, line);
  }, 'QY_ACTION'));
}
