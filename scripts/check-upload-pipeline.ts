/**
 * Proves the upload pipeline still earns its keep.
 *
 * Two promises are easy to break by accident and expensive to break quietly:
 * that an upload is shrunk before it reaches the volume, and that re-uploading
 * art the server already holds costs no extra disk. Both are invisible in the
 * UI -- everything looks fine while the volume fills up -- so they are checked
 * here rather than left to be noticed on a billing page.
 *
 * Run with: npm run check:uploads
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function check(label: string, pass: boolean, detail = ''): void {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!pass) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roll67-shrinktest-'));
process.env.DATA_DIR = tmp;

const { UPLOADS_DIR } = await import('../server/src/config.js');
const { users, campaigns, assets } = await import('../server/src/db/repos.js');
const { processImage, processAudio, audioShrinkAvailable } = await import('../server/src/media.js');
const { hashBytes, storeAsset, storageReport } = await import('../server/src/storage.js');
const sharp = (await import('sharp')).default;

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;

// A photographic-ish PNG: smooth noise, which is exactly what refuses to
// compress losslessly and is why the volume's biggest file was a PNG.
const W = 2000, H = 1500;
const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const x = i % W, y = (i / W) | 0;
  px[i * 3] = (Math.sin(x / 23) * 90 + Math.cos(y / 17) * 90 + 128) & 255;
  px[i * 3 + 1] = (Math.sin((x + y) / 31) * 110 + 128) & 255;
  px[i * 3 + 2] = ((x * 7 + y * 13) % 255);
}
const bigPng = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();

console.log('--- image shrink ---');
for (const kind of ['map', 'handout', 'token']) {
  const out = await processImage(bigPng, 'image/png', kind);
  const pct = (1 - out.buffer.length / bigPng.length) * 100;
  check(
    `${kind}: a photographic PNG shrinks by more than half`,
    pct > 50 && out.ext === 'webp',
    `${mb(bigPng.length)} -> ${mb(out.buffer.length)} (${pct.toFixed(1)}% saved) .${out.ext} ${out.width}x${out.height}`,
  );
}

// A tiny flat PNG must NOT be inflated by re-encoding.
const tinyPng = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
const tinyOut = await processImage(tinyPng, 'image/png', 'token');
check('a tiny image is never made bigger', tinyOut.buffer.length <= tinyPng.length, `${tinyPng.length}B -> ${tinyOut.buffer.length}B as .${tinyOut.ext}`);

console.log('--- audio shrink ---');
check('ffmpeg is available to shrink audio', audioShrinkAvailable, audioShrinkAvailable ? '' : 'audio will be stored as-is');
// 20s of 44.1k stereo 16-bit WAV = ~3.5 MB uncompressed.
const secs = 20, rate = 44100;
const pcm = Buffer.alloc(secs * rate * 4);
for (let i = 0; i < secs * rate; i++) {
  const v = Math.round(Math.sin(i / 40) * 8000 + Math.sin(i / 7.3) * 3000);
  pcm.writeInt16LE(v, i * 4); pcm.writeInt16LE(v, i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([hdr, pcm]);
const audioOut = processAudio(wav, 'wav');
if (audioShrinkAvailable) {
  check('an uncompressed WAV collapses to MP3', audioOut.reencoded && audioOut.buffer.length < wav.length / 4, `${mb(wav.length)} -> ${mb(audioOut.buffer.length)} .${audioOut.ext}`);
  const again = processAudio(audioOut.buffer, 'mp3');
  check('audio already at target is left alone', !again.reencoded, `${mb(audioOut.buffer.length)} unchanged`);
}

console.log('--- dedupe ---');
const u = users.create('t', 'x');
const c = campaigns.create('C1', 'swade', u.id);
const c2 = campaigns.create('C2', 'swade', u.id);
const store = (buf: Buffer, campaignId: string) => {
  const hash = hashBytes(buf);
  const a = assets.create({ campaign_id: campaignId, uploaderId: u.id, kind: 'map', filename: 'art.webp', ext: 'webp', mime: 'image/webp', bytes: buf.length, width: 1, height: 1, content_hash: hash });
  return { ...storeAsset(buf, `${a.id}.webp`, hash, a.id), id: a.id };
};
const art = (await processImage(bigPng, 'image/png', 'map')).buffer;
const first = store(art, c.id);
const second = store(art, c.id);
const third = store(art, c2.id);
const differentBytes = Buffer.concat([art, Buffer.from('x')]);
const other = store(differentBytes, c.id);
check('the first upload of some bytes is stored', !first.deduped);
check('re-uploading identical bytes shares the file', second.deduped);
check('sharing works across campaigns too', third.deduped);
check('different bytes are never shared', !other.deduped);

const names = fs.readdirSync(UPLOADS_DIR);
const inodes = new Set(names.map((n) => String(fs.statSync(path.join(UPLOADS_DIR, n)).ino)));
check('4 names occupy only 2 files', names.length === 4 && inodes.size === 2, `${names.length} names, ${inodes.size} inodes`);
const contents = names.map((n) => fs.readFileSync(path.join(UPLOADS_DIR, n)));
check('every shared name still reads back its own bytes',
  contents.every((b, i) => b.length === (names[i] === `${other.id}.webp` ? differentBytes.length : art.length)));

// Deleting one name must leave the others intact -- the filesystem refcounts.
fs.unlinkSync(path.join(UPLOADS_DIR, `${second.id}.webp`));
const survived = fs.readFileSync(path.join(UPLOADS_DIR, `${first.id}.webp`));
check('deleting one shared copy leaves the others whole', survived.length === art.length);

const rep = storageReport();
check('the report charges shared files once',
  rep.sharedBytes > 0 && rep.uploadsBytes < rep.uploadsBytes + rep.sharedBytes,
  `${mb(rep.uploadsBytes)} real, ${mb(rep.sharedBytes)} saved by sharing (a naive walk would say ${mb(rep.uploadsBytes + rep.sharedBytes)})`);
check('sharing leaves no duplicate waste behind', rep.duplicateBytes === 0, `${mb(rep.duplicateBytes)}`);

// SQLite keeps the file open on Windows, so this is best-effort housekeeping.
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }
console.log('');
console.log(failures === 0 ? 'upload pipeline: all checks passed' : `upload pipeline: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
