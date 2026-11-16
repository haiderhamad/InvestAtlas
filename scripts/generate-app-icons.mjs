// SPDX-License-Identifier: Apache-2.0
// Render the original project SVG; no fonts or external artwork are required.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node scripts/generate-app-icons.mjs [--check]');
}
if (sharp.versions.sharp !== '0.35.5') {
  throw new Error('Install the locked sharp 0.35.5 renderer with npm ci.');
}
const sourcePath = 'public/app-icon.svg';
const source = await readFile(join(root, sourcePath));
if (/<(?:text|image|script|foreignObject)\b|\b(?:href|font-family)=/i.test(source.toString())) {
  throw new Error('App icon source must use font-independent local vector geometry.');
}
const png = (size) => sharp(source).resize(size, size).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
const outputs = new Map([
  [sourcePath, source],
  ['public/app-icon-192.png', await png(192)],
  ['public/app-icon-512.png', await png(512)],
  ['public/apple-touch-icon.png', await png(180)],
]);
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}
outputs.set('src/app/favicon.ico', Buffer.concat([header, ...frames]));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const provenance = {
  schemaVersion: 2,
  source: sourcePath,
  license: 'Apache-2.0',
  preparedOn: '2026-11-14',
  authorship: 'Original geometric SVG source created during owner-authorized InvestAtlas release preparation; no third-party artwork or font input.',
  authorization: 'Owner approved new reproducible SVG icons and Apache-2.0 source/derivative licensing on 2026-11-14.',
  priorArtwork: 'Replaced artwork remains unverified, is preserved privately, and is excluded from this source candidate.',
  generator: 'scripts/generate-app-icons.mjs',
  renderer: { package: 'sharp', version: sharp.versions.sharp, libvips: sharp.versions.vips },
  assets: [...outputs].map(([path, bytes]) => ({ path, sha256: digest(bytes), license: 'Apache-2.0' })),
};
outputs.set('ASSET_PROVENANCE.json', Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
for (const [path, expected] of outputs) {
  if (args[0] === '--check') {
    const actual = await readFile(join(root, path));
    if (!actual.equals(expected)) throw new Error(`Generated icon/provenance is stale: ${path}`);
  } else if (path !== sourcePath) {
    await writeFile(join(root, path), expected);
  }
}
console.log(`${args[0] === '--check' ? 'Verified' : 'Generated'} five app icons and their provenance with sharp ${sharp.versions.sharp}.`);
