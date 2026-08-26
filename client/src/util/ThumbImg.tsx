import { useState } from 'react';

/**
 * An image that asks for the server's small thumbnail and falls back to the
 * full upload if the thumbnail can't be served. The fallback is what makes
 * this safe to use anywhere: the worst case is exactly the full-size fetch
 * the grids did before thumbnails existed.
 */
export function ThumbImg({ id, url, alt }: { id: string; url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      src={failed ? url : `/api/thumb/${id}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
