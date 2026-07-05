import { useCallback, useRef, useState } from 'react';
import { uploadFile } from '../api';

/** Only surface a progress bar once an upload has been running this long --
 *  most uploads finish well under this and a flashing bar would just be noise. */
const SHOW_AFTER_MS = 1000;

/**
 * Wraps uploadFile() with a `progress` value (0..1, or null while hidden) that
 * only appears once the upload has taken more than a second, covering both
 * the network transfer and the server-side image processing that follows it.
 */
export function useUploadProgress() {
  const [progress, setProgress] = useState<number | null>(null);
  const shownRef = useRef(false);
  const startRef = useRef(0);

  const upload = useCallback<typeof uploadFile>((file, campaignId, kind, opts) => {
    shownRef.current = false;
    startRef.current = performance.now();
    setProgress(null);
    return uploadFile(file, campaignId, kind, {
      ...opts,
      onProgress: (fraction) => {
        if (!shownRef.current && performance.now() - startRef.current > SHOW_AFTER_MS) {
          shownRef.current = true;
        }
        if (shownRef.current) setProgress(fraction);
      },
    }).finally(() => setProgress(null));
  }, []);

  return { progress, upload };
}
