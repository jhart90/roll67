import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { imageSize } from 'image-size';

/**
 * Making an upload smaller before it lands on the volume.
 *
 * The rule every function here obeys: never store something bigger than what
 * arrived, and never store something a person at the table would notice. When
 * a re-encode fails, or saves too little to be worth the loss, the original
 * bytes are kept untouched. An upload must never fail because a compressor
 * was unhappy — the worst case is simply the behaviour we had before.
 */

/** Longest side per use, in pixels — backgrounds are viewed zoomed-in so get
 *  the most headroom, tokens are small on-screen so need far less. */
const MAX_DIMENSION: Record<string, number> = { map: 4096, handout: 2560, token: 1024 };

/**
 * WebP quality for photographic art. 90 sits above the point where artefacts
 * become findable even when pixel-peeping a zoomed map, while typically
 * costing a fifth of the equivalent PNG. Alpha is kept lossless regardless,
 * because a soft edge on a token reads as a halo where a soft gradient does
 * not.
 */
const WEBP_QUALITY = 90;

/** Keep a re-encode only if it saves at least this much. Below it, the space
 *  isn't worth even a theoretical generation of quality loss. */
const WORTH_IT = 0.1;

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  ext: string;
  mime: string;
}

/**
 * Re-encode an image to WebP, downscaling only if it exceeds the cap for its
 * kind.
 *
 * WebP rather than the format that arrived, because the volume's biggest
 * single image was a 15 MB PNG: PNG is lossless, so a photographic or
 * AI-generated picture stays enormous no matter how hard it is compressed.
 * Tokens encode losslessly — they are small already, they have crisp edges
 * against transparency, and lossless WebP still beats PNG — while maps and
 * handouts, which is where the megabytes actually are, use high-quality lossy.
 *
 * Animated GIFs pass through untouched; sharp would flatten them to one frame.
 */
export async function processImage(buffer: Buffer, mimetype: string, kind: string): Promise<ProcessedImage> {
  if (mimetype === 'image/gif') {
    const dims = imageSize(buffer);
    return { buffer, width: dims.width ?? 0, height: dims.height ?? 0, ext: 'gif', mime: 'image/gif' };
  }

  const maxSide = MAX_DIMENSION[kind] ?? MAX_DIMENSION.handout;
  const resized = sharp(buffer).rotate().resize({
    width: maxSide,
    height: maxSide,
    fit: 'inside',
    withoutEnlargement: true,
  });

  const { data, info } = await (kind === 'token'
    ? resized.webp({ lossless: true, effort: 5 })
    : resized.webp({ quality: WEBP_QUALITY, alphaQuality: 100, effort: 5 })
  ).toBuffer({ resolveWithObject: true });

  // A small, already-tight source (a plain PNG token, a well-compressed JPEG)
  // can encode *larger* as WebP. Keep whichever is smaller, and re-measure the
  // original rather than trusting the encoder's idea of its dimensions.
  if (data.length >= buffer.length) {
    const dims = imageSize(buffer);
    const ext = mimetype === 'image/jpeg' ? 'jpg' : mimetype === 'image/webp' ? 'webp' : 'png';
    return { buffer, width: dims.width ?? info.width, height: dims.height ?? info.height, ext, mime: mimetype };
  }
  return { buffer: data, width: info.width, height: info.height, ext: 'webp', mime: 'image/webp' };
}

/**
 * The ffmpeg binary, or null if this server hasn't got one.
 *
 * Resolved once, defensively: the npm-installed binary first, then anything on
 * PATH. Audio shrinking is a bonus, not a dependency — a server without ffmpeg
 * stores what it is given, exactly as it did before, and says so in the log
 * rather than failing an upload.
 */
const ffmpegPath: string | null = (() => {
  try {
    // An optional dependency, resolved the CommonJS way because this module is
    // ESM and a static import of something that may not be installed is a
    // startup crash rather than a caught miss.
    const mod = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg') as { path?: string };
    if (mod?.path && fs.existsSync(mod.path)) return mod.path;
  } catch { /* not installed: fall through to PATH */ }
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0 ? 'ffmpeg' : null;
})();

export const audioShrinkAvailable = ffmpegPath !== null;

/**
 * Target bitrate for table audio. Ambience and music played through a laptop
 * or a Discord call are transparent well below this; 128 kbps is the point
 * where nobody has ever won a listening test on a battle map, and it turns a
 * 320 kbps track into a fifth of the bytes. Uncompressed WAV, the real
 * offender at roughly 10 MB a minute, collapses by an order of magnitude.
 */
const AUDIO_BITRATE = '128k';

export interface ProcessedAudio {
  buffer: Buffer;
  ext: string;
  mime: string;
  /** False when the original was kept — already small, or ffmpeg unavailable. */
  reencoded: boolean;
}

/**
 * Re-encode audio to a sane bitrate, keeping the original when that would not
 * be a clear win.
 *
 * Everything becomes MP3: it is what every browser plays, and normalising
 * means a dropped-in WAV stops costing forty times what it needs to. A track
 * that is already at or below the target saves nothing by being transcoded and
 * would only lose a generation, so it is left alone — that is what the size
 * comparison at the end is really guarding.
 */
export function processAudio(buffer: Buffer, ext: string): ProcessedAudio {
  const keep: ProcessedAudio = { buffer, ext, mime: mimeForAudio(ext), reencoded: false };
  if (!ffmpegPath) return keep;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roll67-audio-'));
  const src = path.join(dir, `in.${ext}`);
  const dst = path.join(dir, 'out.mp3');
  try {
    fs.writeFileSync(src, buffer);
    // -vn drops cover art, which is a full-size JPEG riding along inside more
    // tracks than you would think.
    const run = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src,
      '-vn', '-c:a', 'libmp3lame', '-b:a', AUDIO_BITRATE,
      dst,
    ], { timeout: 180_000, maxBuffer: 1 << 20 });
    if (run.status !== 0 || !fs.existsSync(dst)) {
      console.warn('audio shrink: ffmpeg declined this file, storing the original');
      return keep;
    }
    const out = fs.readFileSync(dst);
    if (out.length === 0 || out.length > buffer.length * (1 - WORTH_IT)) return keep;
    return { buffer: out, ext: 'mp3', mime: 'audio/mpeg', reencoded: true };
  } catch (err) {
    console.warn('audio shrink failed, storing the original:', err);
    return keep;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir, best effort */ }
  }
}

function mimeForAudio(ext: string): string {
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    case 'weba': return 'audio/webm';
    case 'm4a': return 'audio/mp4';
    default: return 'application/octet-stream';
  }
}
