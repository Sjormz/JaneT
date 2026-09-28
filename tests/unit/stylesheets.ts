import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Every renderer stylesheet, concatenated in the cascade order declared by styles/index.css, without comments. */
export function readRendererStylesheets(): string {
  const entry = join(process.cwd(), 'src/renderer/styles/index.css');
  const imports = [...readFileSync(entry, 'utf8').matchAll(/@import\s+"([^"]+)";/g)].map((match) => match[1]);
  return imports.map((file) => readFileSync(join(dirname(entry), file), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}
