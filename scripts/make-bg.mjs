// Turn a piece of art into a full-bleed browser background.
//
//   node scripts/make-bg.mjs assets/ttp_books.png ttp-books
//
// Two jobs, and they pull against each other: it has to stay sharp on a 4K
// screen stretched edge to edge, and it has to arrive before anybody notices
// they are waiting. So this writes a LADDER of widths in modern formats, and
// the CSS picks the smallest one that still covers the viewport.
//
// On upscaling: there is no ML model here, just Lanczos — which is the right
// tool anyway for going up a modest factor from art that is already clean.
// Enlargement always softens, so each size is sharpened afterwards, gently
// and proportionally: enough to put the edges back, not enough to draw halos
// around them.
//
// On formats: a photographic background in PNG is a mistake measured in
// megabytes — the source here is 2.4 MB at 1448px, and the 3840px AVIF below
// is a fraction of that at nearly three times the width. AVIF leads, WebP
// covers everything that isn't Safari 15, and a JPEG rides along as the
// floor.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [, , src, slug = 'background'] = process.argv;
if (!src) {
  console.error('usage: node scripts/make-bg.mjs <source-image> [slug]');
  process.exit(1);
}

/** The ladder. 3840 covers a 4K display edge to edge; 1280 is a phone. */
const WIDTHS = [1280, 1920, 2560, 3840];
const OUT = path.join('client', 'public', 'bg');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const meta = await sharp(src).metadata();
console.log(`source: ${meta.width}×${meta.height} ${meta.format}, ${kb(fs.statSync(src).size)}`);
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
for (const w of WIDTHS) {
  const h = Math.round((w / meta.width) * meta.height);
  const factor = w / meta.width;
  // Sharpen in proportion to how far it was stretched: a 1280 downscale needs
  // almost nothing, a 3840 enlargement needs a real pass. Untouched when the
  // size is at or below the source, where the resampler is already crisp.
  const sigma = factor > 1 ? Math.min(1.6, 0.6 + (factor - 1) * 0.7) : 0.4;

  const base = sharp(src)
    .resize({ width: w, height: h, kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .sharpen({ sigma });

  const stem = path.join(OUT, `${slug}-${w}`);
  // effort/quality picked by eye at full-bleed: AVIF 52 is indistinguishable
  // from the source on this art, and WebP needs a few points more to match.
  await base.clone().avif({ quality: 52, effort: 6 }).toFile(`${stem}.avif`);
  await base.clone().webp({ quality: 82, effort: 6 }).toFile(`${stem}.webp`);
  if (w === Math.max(...WIDTHS)) {
    await base.clone().jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(`${stem}.jpg`);
  }

  rows.push({
    w, h,
    avif: fs.statSync(`${stem}.avif`).size,
    webp: fs.statSync(`${stem}.webp`).size,
    jpg: fs.existsSync(`${stem}.jpg`) ? fs.statSync(`${stem}.jpg`).size : null,
  });
}

console.log('\n  width        avif      webp       jpg');
for (const r of rows) {
  console.log(
    `  ${String(r.w).padStart(5)}×${String(r.h).padEnd(5)} ${kb(r.avif).padStart(8)} ${kb(r.webp).padStart(9)}`
    + (r.jpg ? ` ${kb(r.jpg).padStart(9)}` : ''),
  );
}
console.log(`\nwritten to ${OUT}/`);
