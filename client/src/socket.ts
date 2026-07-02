import { io, Socket } from 'socket.io-client';

export const AUTH_TOKEN_KEY = 'roll67-token';

export function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

/** Same-origin connection; dev traffic is proxied by Vite to :3001. */
export const socket: Socket = io({
  autoConnect: false,
  auth: (cb) => cb({ token: getToken() }),
});

export function connectSocket(): void {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket(): void {
  if (socket.connected) socket.disconnect();
}
