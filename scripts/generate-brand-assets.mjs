import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = path.join(projectRoot, 'assets', 'brand');
const runtimeDir = path.join(projectRoot, 'assets', 'runtime');
const checkOnly = process.argv.includes('--check');

const outputs = [
  { source: 'app-icon.svg', output: 'app-icon-256.png', size: 256 },
];

async function renderAsset({ source, size }) {
  const svg = await readFile(path.join(brandDir, source));
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function validatePng(buffer, expectedSize, filename) {
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== 'png' || metadata.width !== expectedSize || metadata.height !== expectedSize) {
    throw new Error(`${filename} must be a ${expectedSize}x${expectedSize} PNG`);
  }
  if (!metadata.hasAlpha) throw new Error(`${filename} must preserve an alpha channel`);
}

await mkdir(runtimeDir, { recursive: true });

for (const asset of outputs) {
  const rendered = await renderAsset(asset);
  await validatePng(rendered, asset.size, asset.output);
  const outputPath = path.join(runtimeDir, asset.output);

  if (checkOnly) {
    let committed;
    try {
      committed = await readFile(outputPath);
    } catch {
      throw new Error(`${asset.output} is missing; run npm run brand:generate`);
    }
    if (!committed.equals(rendered)) {
      throw new Error(`${asset.output} is stale; run npm run brand:generate`);
    }
  } else {
    await writeFile(outputPath, rendered);
    console.log(`generated assets/runtime/${asset.output}`);
  }
}

console.log(checkOnly ? 'Brand assets are current.' : 'Brand assets generated.');
