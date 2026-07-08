import type { Server, Socket } from 'socket.io';
import type { Role } from 'shared';

// Per-socket session data (set on joinCampaign).
export interface SocketData {
  userId: string;
  username: string;
  campaignId?: string;
  role?: Role;
  /** DM only: userId whose vision the DM is previewing, or undefined. */
  viewingAs?: string;
}

export function sdata(socket: Socket): SocketData {
  return socket.data as SocketData;
}

export function campaignRoom(campaignId: string): string {
  return `campaign:${campaignId}`;
}

export function dmRoom(campaignId: string): string {
  return `campaign:${campaignId}:dm`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** All connected sockets currently joined to a campaign. */
export function campaignSockets(io: Server, campaignId: string): Socket[] {
  const room = io.sockets.adapter.rooms.get(campaignRoom(campaignId));
  if (!room) return [];
  const out: Socket[] = [];
  for (const id of room) {
    const s = io.sockets.sockets.get(id);
    if (s) out.push(s);
  }
  return out;
}

/** Unique online user ids in a campaign, with their role. */
export function onlineUsers(io: Server, campaignId: string): Map<string, { username: string; role: Role }> {
  const out = new Map<string, { username: string; role: Role }>();
  for (const s of campaignSockets(io, campaignId)) {
    const d = sdata(s);
    if (d.role) out.set(d.userId, { username: d.username, role: d.role });
  }
  return out;
}

export function emitError(socket: Socket, message: string): void {
  socket.emit('errorMsg', { message });
}

/** Wrap a handler so thrown errors become error toasts instead of crashes. */
export function safe<T>(socket: Socket, fn: (payload: T) => void, eventName?: string): (payload: T) => void {
  return (payload: T) => {
    try {
      fn(payload);
    } catch (err) {
      console.error(`handler error [${eventName ?? '?'}]:`, err);
      const raw = err instanceof Error ? err.message : 'Something went wrong.';
      const isSqlite = raw.includes('FOREIGN KEY') || raw.includes('SQLITE') || raw.includes('UNIQUE constraint');
      const msg = isSqlite
        ? `DB error [${eventName ?? '?'}]: ${raw}`
        : raw;
      emitError(socket, msg);
    }
  };
}

/**
 * Recursively replace non-finite numbers (NaN/Infinity) in a client-supplied
 * patch with 0, in place of trusting the client's arithmetic. A NaN that
 * reaches a persisted sheet or token bar poisons every derived stat and
 * broadcast built from it until the value is manually re-typed -- cheaper to
 * scrub once at the write choke points than to guard every downstream read.
 */
export function scrubNonFinite<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? value : 0) as T;
  if (Array.isArray(value)) return value.map(scrubNonFinite) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubNonFinite(v);
    return out as T;
  }
  return value;
}
