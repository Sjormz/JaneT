import { clipboard } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

let imageDirectory: string | undefined;

export function readTerminalClipboard(): string | { imagePath: string } {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const png = image.toPNG();
    if (png.length > 32 * 1024 * 1024) throw new Error('Clipboard image exceeds the 32 MB paste limit');
    imageDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'janet-clipboard-'));
    const imagePath = path.join(imageDirectory, `${randomUUID()}.png`);
    fs.writeFileSync(imagePath, png, { flag: 'wx', mode: 0o600 });
    return { imagePath };
  }
  const text = clipboard.readText();
  if (text.length > 1_048_576) throw new Error('Clipboard text exceeds the terminal paste limit');
  return text;
}

export function clearTerminalClipboardImages(): void {
  if (imageDirectory) fs.rmSync(imageDirectory, { recursive: true, force: true });
  imageDirectory = undefined;
}
