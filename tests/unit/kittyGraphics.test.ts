import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import {
  createKittyGraphicsLayer,
  KittyGraphicsDecoder,
} from '../../src/renderer/kittyGraphics';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PLACEHOLDER = '\u{10EEEE}';

function kittyFrame(payload = PNG_1X1, controls = 'a=T,U=1,i=42,c=2,r=2,f=100,q=2,m=0'): string {
  return `\x1b_G${controls};${payload}\x1b\\`;
}

describe('KittyGraphicsDecoder', () => {
  it('accepts the bounded virtual PNG subset emitted by Hermes', () => {
    const frames: any[] = [];
    const decoder = new KittyGraphicsDecoder((frame) => frames.push(frame));

    decoder.push(kittyFrame());

    expect(frames).toEqual([expect.objectContaining({
      id: 42,
      cols: 2,
      rows: 2,
      width: 1,
      height: 1,
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
    })]);
  });

  it('reassembles Hermes chunked APC payloads across arbitrary PTY boundaries', () => {
    const frames: any[] = [];
    const decoder = new KittyGraphicsDecoder((frame) => frames.push(frame));
    const split = 28;
    const wire = [
      kittyFrame(PNG_1X1.slice(0, split), 'a=T,U=1,i=7,c=8,r=4,f=100,q=2,m=1'),
      kittyFrame(PNG_1X1.slice(split), 'm=0'),
    ].join('');

    for (let index = 0; index < wire.length; index += 3) {
      decoder.push(wire.slice(index, index + 3));
    }

    expect(frames).toEqual([expect.objectContaining({ id: 7, cols: 8, rows: 4 })]);
  });

  it('rejects generic Kitty actions, oversized placements, and dangerous PNG dimensions', () => {
    const onFrame = vi.fn();
    const decoder = new KittyGraphicsDecoder(onFrame);
    decoder.push(kittyFrame(PNG_1X1, 'a=T,i=1,c=2,r=2,f=100,q=2,m=0'));
    decoder.push(kittyFrame(PNG_1X1, 'a=T,U=1,i=1,c=65,r=2,f=100,q=2,m=0'));

    const decoded = atob(PNG_1X1);
    const bytes = Uint8Array.from(decoded, (value) => value.charCodeAt(0));
    bytes.set([0, 0, 8, 1], 16); // 2049px exceeds JaneT's per-axis bound.
    const oversized = btoa(String.fromCharCode(...bytes));
    decoder.push(kittyFrame(oversized, 'a=T,U=1,i=1,c=2,r=2,f=100,q=2,m=0'));

    const malformedHeader = Uint8Array.from(decoded, (value) => value.charCodeAt(0));
    malformedHeader[11] = 12; // PNG IHDR length must be exactly 13 bytes.
    decoder.push(kittyFrame(
      btoa(String.fromCharCode(...malformedHeader)),
      'a=T,U=1,i=1,c=2,r=2,f=100,q=2,m=0',
    ));

    expect(onFrame).not.toHaveBeenCalled();
  });

  it('drops an oversized APC sequence and recovers for the next valid frame', () => {
    const frames: any[] = [];
    const decoder = new KittyGraphicsDecoder((frame) => frames.push(frame));
    decoder.push(`${kittyFrame('A'.repeat(1_500_000))}${kittyFrame()}`);

    expect(frames).toEqual([expect.objectContaining({ id: 42 })]);
  });
});

class FakeCell {
  constructor(private readonly chars: string, private readonly color: number) {}
  getChars() { return this.chars; }
  getFgColor() { return this.color; }
  isFgRGB() { return this.color >= 0; }
}

class FakeLine {
  constructor(private readonly cells: FakeCell[]) {}
  getCell(x: number) { return this.cells[x]; }
}

function event<T>(listeners: Array<(value: T) => void>) {
  return (listener: (value: T) => void) => {
    listeners.push(listener);
    return { dispose: vi.fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
  };
}

describe('KittyGraphicsLayer', () => {
  it('paints a decoded frame over its colored Unicode placeholder rectangle', () => {
    const cols = 10;
    const rows = 6;
    const lines = Array.from({ length: rows }, () => new FakeLine(
      Array.from({ length: cols }, () => new FakeCell('', -1)),
    ));
    const placeholderRows = [
      [PLACEHOLDER + '\u0305', PLACEHOLDER],
      [PLACEHOLDER + '\u030D', PLACEHOLDER],
    ];
    for (let row = 0; row < 2; row += 1) {
      const cells = Array.from({ length: cols }, () => new FakeCell('', -1));
      for (let col = 0; col < 2; col += 1) cells[3 + col] = new FakeCell(placeholderRows[row][col], 42);
      lines[2 + row] = new FakeLine(cells);
    }

    const root = document.createElement('div');
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    screen.style.width = '100px';
    screen.style.height = '60px';
    root.appendChild(screen);

    const listeners: Array<Array<(value: any) => void>> = [[], [], [], [], []];
    const term = {
      element: root,
      cols,
      rows,
      options: { theme: { background: '#123456' } },
      buffer: {
        active: {
          viewportY: 0,
          length: rows,
          getLine: (y: number) => lines[y],
        },
        onBufferChange: event(listeners[4]),
      },
      onWriteParsed: event(listeners[0]),
      onRender: event(listeners[1]),
      onScroll: event(listeners[2]),
      onResize: event(listeners[3]),
    } as unknown as Terminal;

    const layer = createKittyGraphicsLayer(term)!;
    layer.push(kittyFrame());
    layer.refresh();

    const wrapper = screen.querySelector<HTMLElement>('[data-kitty-image-id="42"]')!;
    const image = wrapper.querySelector<HTMLImageElement>('img')!;
    expect(wrapper.style.left).toBe('30px');
    expect(wrapper.style.top).toBe('20px');
    expect(wrapper.style.width).toBe('20px');
    expect(wrapper.style.height).toBe('20px');
    expect(image.src).toBe(`data:image/png;base64,${PNG_1X1}`);

    layer.dispose();
    expect(screen.querySelector('.janet-kitty-image-layer')).toBeNull();
  });

  it('keeps a placement visible when its top rows are above the viewport', () => {
    const cols = 10;
    const rows = 6;
    const bufferLength = 9;
    const lines = Array.from({ length: bufferLength }, () => new FakeLine(
      Array.from({ length: cols }, () => new FakeCell('', -1)),
    ));
    const placeholderRows = [
      [PLACEHOLDER + '\u0305', PLACEHOLDER],
      [PLACEHOLDER + '\u030D', PLACEHOLDER],
    ];
    for (let row = 0; row < 2; row += 1) {
      const cells = Array.from({ length: cols }, () => new FakeCell('', -1));
      for (let col = 0; col < 2; col += 1) cells[3 + col] = new FakeCell(placeholderRows[row][col], 42);
      lines[2 + row] = new FakeLine(cells);
    }

    const root = document.createElement('div');
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    screen.style.width = '100px';
    screen.style.height = '60px';
    root.appendChild(screen);

    const listeners: Array<Array<(value: any) => void>> = [[], [], [], [], []];
    const term = {
      element: root,
      cols,
      rows,
      options: { theme: { background: '#123456' } },
      buffer: {
        active: {
          viewportY: 3,
          length: bufferLength,
          getLine: (y: number) => lines[y],
        },
        onBufferChange: event(listeners[4]),
      },
      onWriteParsed: event(listeners[0]),
      onRender: event(listeners[1]),
      onScroll: event(listeners[2]),
      onResize: event(listeners[3]),
    } as unknown as Terminal;

    const layer = createKittyGraphicsLayer(term)!;
    layer.push(kittyFrame());
    layer.refresh();

    const wrapper = screen.querySelector<HTMLElement>('[data-kitty-image-id="42"]')!;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.left).toBe('30px');
    expect(wrapper.style.top).toBe('-10px');
    expect(wrapper.style.height).toBe('20px');
    expect(wrapper.style.display).toBe('block');

    layer.dispose();
  });
});
