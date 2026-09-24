import { clipboard, nativeImage } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

let imageDirectory: string | undefined;

export async function readTerminalClipboard(): Promise<string | { imagePath: string }> {
  const items = await clipboard.read();
  const imageItem = items.find((item) => item.types.includes('image/png') || item.types.includes('image/jpeg'));
  if (imageItem) {
    const imageType = imageItem.types.includes('image/png') ? 'image/png' : 'image/jpeg';
    const imageData = await imageItem.getType(imageType) as Blob;
    const image = nativeImage.createFromBuffer(Buffer.from(await imageData.arrayBuffer()));
    if (image.isEmpty()) throw new Error('Clipboard image could not be read');
    const png = image.toPNG();
    if (png.length > 32 * 1024 * 1024) throw new Error('Clipboard image exceeds the 32 MB paste limit');
    imageDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'janet-clipboard-'));
    const imagePath = path.join(imageDirectory, `${randomUUID()}.png`);
    fs.writeFileSync(imagePath, png, { flag: 'wx', mode: 0o600 });
    return { imagePath };
  }
  const text = await clipboard.readText();
  if (text.length > 1_048_576) throw new Error('Clipboard text exceeds the terminal paste limit');
  return text;
}

export function clearTerminalClipboardImages(): void {
  if (imageDirectory) fs.rmSync(imageDirectory, { recursive: true, force: true });
  imageDirectory = undefined;
}
