import { getToken } from './socket';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
};

export async function uploadFile(
  file: File,
  campaignId: string,
  kind: 'map' | 'token' | 'handout' | 'audio',
  opts?: { title?: string; folderId?: string | null },
): Promise<{ assetId: string; url: string; width: number; height: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('campaignId', campaignId);
  form.append('kind', kind);
  if (opts?.title) form.append('title', opts.title);
  if (opts?.folderId) form.append('folderId', opts.folderId);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/upload', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'Upload failed', res.status);
  return data as { assetId: string; url: string; width: number; height: number };
}
