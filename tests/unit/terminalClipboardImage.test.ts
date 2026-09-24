import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';

const image = vi.hoisted(() => ({ isEmpty: vi.fn(() => false), toPNG: vi.fn(() => Buffer.from('png')) }));
const clipboardMocks = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  getType: vi.fn(async () => ({ arrayBuffer: async () => Buffer.from('raw') })),
  read: vi.fn(),
}));
vi.mock('electron', () => ({
  clipboard: {
    read: clipboardMocks.read,
    readText: async () => 'plain text',
  },
  nativeImage: { createFromBuffer: clipboardMocks.createFromBuffer },
}));
import { readTerminalClipboard, clearTerminalClipboardImages } from '../../src/main/terminalClipboard';

beforeEach(() => {
  clipboardMocks.createFromBuffer.mockReturnValue(image);
  clipboardMocks.read.mockResolvedValue([{ types: ['image/png'], getType: clipboardMocks.getType }]);
});
afterEach(() => { clearTerminalClipboardImages(); vi.clearAllMocks(); });

it('writes unique clipboard images, retains them for the session, and cleans up at exit', async () => {
  const first = await readTerminalClipboard() as { imagePath: string };
  const second = await readTerminalClipboard() as { imagePath: string };
  expect(first.imagePath).not.toBe(second.imagePath);
  expect(fs.readFileSync(first.imagePath).toString()).toBe('png');
  clearTerminalClipboardImages();
  expect(fs.existsSync(first.imagePath)).toBe(false);
  expect(fs.existsSync(second.imagePath)).toBe(false);
  clipboardMocks.read.mockResolvedValueOnce([]);
  await expect(readTerminalClipboard()).resolves.toBe('plain text');
});

it('rejects oversized images before writing a file', async () => {
  image.toPNG.mockReturnValueOnce(Buffer.alloc(32 * 1024 * 1024 + 1));
  await expect(readTerminalClipboard()).rejects.toThrow('32 MB');
});
