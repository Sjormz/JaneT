// Compares two design-capture runs (see tests/e2e/design-captures.spec.ts):
//   node scripts/design-style-diff.mjs <baseline-dir> <candidate-dir> [--ignore-prop=name,...] [--ignore-custom-properties] [--limit=20]
// Reports, per surface, elements added/removed, elements whose computed style changed (with the changed
// properties), and the fraction of screenshot pixels that differ. Exits 1 when anything differs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [baseDir, candDir, ...flags] = process.argv.slice(2);
if (!baseDir || !candDir) {
  console.error('usage: node scripts/design-style-diff.mjs <baseline-dir> <candidate-dir> [--ignore-prop=a,b] [--limit=20]');
  process.exit(2);
}
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.split('=')[1];
const ignored = new Set((flag('ignore-prop') ?? '').split(',').filter(Boolean));
const limit = Number(flag('limit') ?? 20);
const ignoreCustom = flags.includes('--ignore-custom-properties');

const parse = (text) => new Map(text.split(';').map((d) => { const i = d.indexOf(':'); return [d.slice(0, i), d.slice(i + 1)]; }));
let dirty = false;

for (const file of fs.readdirSync(baseDir).filter((f) => f.endsWith('.styles.json')).sort()) {
  const surface = file.replace('.styles.json', '');
  const candFile = path.join(candDir, file);
  if (!fs.existsSync(candFile)) { console.log(`${surface}: MISSING in candidate`); dirty = true; continue; }
  const a = JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8'));
  const b = JSON.parse(fs.readFileSync(candFile, 'utf8'));
  const removed = Object.keys(a.elements).filter((k) => !(k in b.elements));
  const added = Object.keys(b.elements).filter((k) => !(k in a.elements));
  const changed = [];
  for (const [key, id] of Object.entries(a.elements)) {
    if (!(key in b.elements)) continue;
    if (a.styles[id] === b.styles[b.elements[key]]) continue;
    const before = parse(a.styles[id]);
    const after = parse(b.styles[b.elements[key]]);
    const props = [...new Set([...before.keys(), ...after.keys()])]
      .filter((p) => !ignored.has(p) && !(ignoreCustom && p.startsWith('--')) && before.get(p) !== after.get(p))
      .map((p) => `${p}: ${before.get(p)} -> ${after.get(p)}`);
    if (props.length) changed.push({ key, props });
  }
  let pixels = '';
  const pngA = path.join(baseDir, `${surface}.png`);
  const pngB = path.join(candDir, `${surface}.png`);
  if (fs.existsSync(pngA) && fs.existsSync(pngB)) {
    const [ra, rb] = await Promise.all([pngA, pngB].map((p) => sharp(p).raw().toBuffer({ resolveWithObject: true })));
    if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) pixels = 'size differs';
    else {
      let diff = 0;
      for (let i = 0; i < ra.data.length; i += ra.info.channels) {
        if (ra.data[i] !== rb.data[i] || ra.data[i + 1] !== rb.data[i + 1] || ra.data[i + 2] !== rb.data[i + 2]) diff += 1;
      }
      pixels = `${((diff / (ra.info.width * ra.info.height)) * 100).toFixed(3)}% pixels differ`;
    }
  }
  const clean = !removed.length && !added.length && !changed.length;
  if (!clean) dirty = true;
  console.log(`${clean ? 'same' : 'DIFF'}  ${surface}  (${Object.keys(a.elements).length} elements; ${changed.length} changed, ${added.length} added, ${removed.length} removed; ${pixels})`);
  for (const k of removed.slice(0, limit)) console.log(`    - ${k}`);
  for (const k of added.slice(0, limit)) console.log(`    + ${k}`);
  for (const { key, props } of changed.slice(0, limit)) console.log(`    ~ ${key}\n        ${props.slice(0, 8).join('\n        ')}`);
}
process.exit(dirty ? 1 : 0);
