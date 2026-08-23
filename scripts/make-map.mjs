// Enlarge a piece of art into a battle map the table can zoom into.
//
//   node scripts/make-map.mjs assets/csb_thebes.png 4096
//
// The ceiling is not arbitrary: uploads resize maps to 4096 on the longest
// side (MAX_DIMENSION.map in server/src/media.ts), so anything bigger is work
// the server throws away. The output is WebP at quality 95 for the same
// reason — maps are stored as WebP regardless, and leaving headroom above the
// pipeline's own q90 keeps that the only pass anyone could ever see.
//
// On the enlargement: no ML model here, just Lanczos3, which is the right
// tool for going up a modest factor from art that is already clean.
//
// It resamples ONCE. Going up in steps sounds better and measurably is not:
// checked against ground truth -- shrink the source by the same factor, blow
// it back up, compare to the original -- one 2.83x jump scored 16.9 RMSE
// while 1.5x rungs scored 27.5, because every extra resample compounds the
// last one's guesses instead of refining them.
//
// Sharpening is deliberately light for the same reason. Measured the same
// way, sigma 0.5-0.8 sits at the optimum, plain Lanczos is barely behind, and
// a heavy 1.6 pass is worse than not sharpening at all. Enlargement softens
// and a little sharpening earns that back; past this point it is drawing
// halos, which on art somebody will zoom into are far more obvious than
// softness ever was.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [, , src, targetArg = '4096', sigmaArg = '0.8'] = process.argv;
if (!src) {
  console.error('usage: node scripts/make-map.mjs <source-image> [target-width] [sharpen-sigma]');
  process.exit(1);
}
const target = Number(targetArg);
const sigma = Number(sigmaArg);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

const meta = await sharp(src).metadata();
const targetH = Math.round(target * (meta.height / meta.width));
console.log(`source: ${meta.width}x${meta.height} ${meta.format}, ${mb(fs.statSync(src).size)}`);
console.log(`output: ${target}x${targetH} (${(target / meta.width).toFixed(2)}x), lanczos3 + sharpen ${sigma}`);

const stem = path.join(path.dirname(src), `${path.basename(src, path.extname(src))}_map${target}`);
const out = `${stem}.webp`;
let pipeline = sharp(src).resize({ width: target, height: targetH, kernel: sharp.kernel.lanczos3 });
if (sigma > 0) pipeline = pipeline.sharpen({ sigma });
await pipeline.webp({ quality: 95, effort: 6 }).toFile(out);
console.log(`wrote ${out}  ${mb(fs.statSync(out).size)}`);
