import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';

const image = vi.hoisted(() => ({ isEmpty: vi.fn(() => false), toPNG: vi.fn(() => Buffer.from('png')) }));
vi.mock('electron', () => ({ clipboard: { readImage: () => image, readText: () => 'plain text' } }));
import { readTerminalClipboard, clearTerminalClipboardImages } from '../../src/main/terminalClipboard';

afterEach(() => { clearTerminalClipboardImages(); vi.clearAllMocks(); });

it('writes unique clipboard images, retains them for the session, and cleans up at exit', () => {
  const first = readTerminalClipboard() as { imagePath: string };
  const second = readTerminalClipboard() as { imagePath: string };
  expect(first.imagePath).not.toBe(second.imagePath);
  expect(fs.readFileSync(first.imagePath).toString()).toBe('png');
  clearTerminalClipboardImages();
  expect(fs.existsSync(first.imagePath)).toBe(false);
  expect(fs.existsSync(second.imagePath)).toBe(false);
  image.isEmpty.mockReturnValueOnce(true);
  expect(readTerminalClipboard()).toBe('plain text');
});

it('rejects oversized images before writing a file', () => {
  image.toPNG.mockReturnValueOnce(Buffer.alloc(32 * 1024 * 1024 + 1));
  expect(readTerminalClipboard).toThrow('32 MB');
});
