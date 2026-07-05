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
  opts?: { title?: string; folderId?: string | null; onProgress?: (fraction: number) => void },
): Promise<{ assetId: string; url: string; width: number; height: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('campaignId', campaignId);
  form.append('kind', kind);
  if (opts?.title) form.append('title', opts.title);
  if (opts?.folderId) form.append('folderId', opts.folderId);
  const token = getToken();

  // Plain fetch has no progress signal at all, so this uses XMLHttpRequest
  // instead: xhr.upload.onprogress covers the real network transfer, then a
  // trickle timer fills the remaining gap while the server processes the
  // image (resize/recompress), which has no progress event of its own.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    let trickle: ReturnType<typeof setInterval> | undefined;
    const clearTrickle = () => { if (trickle) clearInterval(trickle); };
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      opts?.onProgress?.(Math.min(0.9, (e.loaded / e.total) * 0.9));
    };
    xhr.upload.onload = () => {
      let fake = 0.9;
      trickle = setInterval(() => {
        fake += (0.99 - fake) * 0.1;
        opts?.onProgress?.(fake);
      }, 200);
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      clearTrickle();
      opts?.onProgress?.(1);
      let data: unknown = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as { assetId: string; url: string; width: number; height: number });
      } else {
        reject(new ApiError((data as { error?: string }).error ?? `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => { clearTrickle(); reject(new ApiError('Upload failed', 0)); };
    xhr.send(form);
  });
}
