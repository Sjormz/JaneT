import type { IDisposable, Terminal } from '@xterm/xterm';

const APC_START = '\x1b_G';
const APC_END = '\x1b\\';
const KITTY_PLACEHOLDER_CODEPOINT = 0x10EEEE;
const KITTY_FIRST_ROW_MARK = 0x0305;

// JaneT deliberately implements only the bounded subset emitted by Hermes:
// direct, PNG, virtual placements rendered through Unicode placeholders.
// It does not claim general Kitty graphics compatibility through TERM.
const MAX_PNG_BYTES = 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_PNG_BYTES * 4 / 3) + 4;
const MAX_APC_CHARS = MAX_BASE64_CHARS + 1024;
const MAX_PNG_DIMENSION = 2048;
const MAX_PNG_PIXELS = 1024 * 1024;
const MAX_PLACEMENT_CELLS = 64;
const MAX_PLACEMENT_AREA = 4096;
const MAX_STORED_IMAGES = 8;

export interface KittyPngFrame {
  id: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  dataUrl: string;
}

interface PendingFrame {
  id: number;
  cols: number;
  rows: number;
  payload: string;
}

type CaptureState = 'idle' | 'capturing' | 'discarding';

function parseControls(value: string): Map<string, string> | null {
  const controls = new Map<string, string>();
  for (const part of value.split(',')) {
    const separator = part.indexOf('=');
    if (separator !== 1 || part.length < 3) return null;
    const key = part[0];
    if (!/[A-Za-z]/.test(key) || controls.has(key)) return null;
    controls.set(key, part.slice(2));
  }
  return controls;
}

function boundedInteger(value: string | undefined, min: number, max: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function pngDimensions(payload: string): { width: number; height: number } | null {
  if (
    payload.length < 32 ||
    payload.length > MAX_BASE64_CHARS ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = atob(payload);
  } catch {
    return null;
  }
  if (decoded.length < 24 || decoded.length > MAX_PNG_BYTES) return null;

  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let index = 0; index < signature.length; index += 1) {
    if (decoded.charCodeAt(index) !== signature[index]) return null;
  }
  // The first PNG chunk must be the fixed-width 13-byte IHDR. Checking its
  // declared length keeps the dimension reads below tied to a real header.
  if (
    decoded.charCodeAt(8) !== 0 || decoded.charCodeAt(9) !== 0 ||
    decoded.charCodeAt(10) !== 0 || decoded.charCodeAt(11) !== 13
  ) {
    return null;
  }
  if (decoded.slice(12, 16) !== 'IHDR') return null;

  const readUint32 = (offset: number) => (
    decoded.charCodeAt(offset) * 0x1000000 +
    decoded.charCodeAt(offset + 1) * 0x10000 +
    decoded.charCodeAt(offset + 2) * 0x100 +
    decoded.charCodeAt(offset + 3)
  );
  const width = readUint32(16);
  const height = readUint32(20);
  if (
    width < 1 || height < 1 ||
    width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS
  ) {
    return null;
  }
  return { width, height };
}

/**
 * Extracts Kitty APC frames without altering the data sent to xterm. Unknown
 * or oversized sequences are ignored and xterm continues handling text as it
 * did before this feature existed.
 */
export class KittyGraphicsDecoder implements IDisposable {
  private state: CaptureState = 'idle';
  private searchTail = '';
  private sequence = '';
  private discardTail = '';
  private pending: PendingFrame | null = null;

  constructor(private readonly onFrame: (frame: KittyPngFrame) => void) {}

  public push(chunk: string): void {
    let input = this.state === 'idle' ? this.searchTail + chunk : chunk;
    this.searchTail = '';

    while (input.length > 0) {
      if (this.state === 'idle') {
        const start = input.indexOf(APC_START);
        if (start === -1) {
          this.searchTail = input.endsWith('\x1b_') ? '\x1b_' : input.endsWith('\x1b') ? '\x1b' : '';
          return;
        }
        input = input.slice(start + APC_START.length);
        this.sequence = '';
        this.state = 'capturing';
        continue;
      }

      if (this.state === 'discarding') {
        const discardInput = this.discardTail + input;
        const end = discardInput.indexOf(APC_END);
        if (end === -1) {
          this.discardTail = discardInput.endsWith('\x1b') ? '\x1b' : '';
          return;
        }
        this.discardTail = '';
        this.state = 'idle';
        input = discardInput.slice(end + APC_END.length);
        continue;
      }

      const combined = this.sequence + input;
      const end = combined.indexOf(APC_END);
      if (end === -1) {
        if (combined.length > MAX_APC_CHARS) {
          this.sequence = '';
          this.pending = null;
          this.discardTail = combined.endsWith('\x1b') ? '\x1b' : '';
          this.state = 'discarding';
        } else {
          this.sequence = combined;
        }
        return;
      }

      const sequence = combined.slice(0, end);
      input = combined.slice(end + APC_END.length);
      this.sequence = '';
      this.state = 'idle';
      this.processSequence(sequence);
    }
  }

  private processSequence(sequence: string): void {
    if (sequence.length > MAX_APC_CHARS) {
      this.pending = null;
      return;
    }
    const separator = sequence.indexOf(';');
    if (separator === -1) {
      this.pending = null;
      return;
    }
    const controls = parseControls(sequence.slice(0, separator));
    if (!controls) {
      this.pending = null;
      return;
    }
    const payload = sequence.slice(separator + 1);

    if (!controls.has('a')) {
      const allowedContinuationKeys = new Set(['m']);
      if (!this.pending || [...controls.keys()].some((key) => !allowedContinuationKeys.has(key))) {
        this.pending = null;
        return;
      }
      const more = controls.get('m');
      if (more !== '0' && more !== '1') {
        this.pending = null;
        return;
      }
      this.pending.payload += payload;
      if (this.pending.payload.length > MAX_BASE64_CHARS) {
        this.pending = null;
        return;
      }
      if (more === '0') this.finishPending();
      return;
    }

    const allowedKeys = new Set(['a', 'U', 'i', 'c', 'r', 'f', 'q', 'm']);
    if (
      [...controls.keys()].some((key) => !allowedKeys.has(key)) ||
      controls.get('a') !== 'T' ||
      controls.get('U') !== '1' ||
      controls.get('f') !== '100' ||
      controls.get('q') !== '2'
    ) {
      this.pending = null;
      return;
    }

    const id = boundedInteger(controls.get('i'), 1, 0xFFFFFF);
    const cols = boundedInteger(controls.get('c'), 1, MAX_PLACEMENT_CELLS);
    const rows = boundedInteger(controls.get('r'), 1, MAX_PLACEMENT_CELLS);
    const more = controls.get('m');
    if (!id || !cols || !rows || cols * rows > MAX_PLACEMENT_AREA || (more !== '0' && more !== '1')) {
      this.pending = null;
      return;
    }

    this.pending = { id, cols, rows, payload };
    if (payload.length > MAX_BASE64_CHARS) {
      this.pending = null;
      return;
    }
    if (more === '0') this.finishPending();
  }

  private finishPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    const dimensions = pngDimensions(pending.payload);
    if (!dimensions) return;
    this.onFrame({
      id: pending.id,
      cols: pending.cols,
      rows: pending.rows,
      ...dimensions,
      dataUrl: `data:image/png;base64,${pending.payload}`,
    });
  }

  public dispose(): void {
    this.state = 'idle';
    this.searchTail = '';
    this.sequence = '';
    this.discardTail = '';
    this.pending = null;
  }
}

function isPlaceholderCell(term: Terminal, x: number, y: number, id: number): boolean {
  const cell = term.buffer.active.getLine(y)?.getCell(x);
  if (!cell || !cell.isFgRGB() || cell.getFgColor() !== id) return false;
  return cell.getChars().codePointAt(0) === KITTY_PLACEHOLDER_CODEPOINT;
}

function findPlacement(term: Terminal, frame: KittyPngFrame): { x: number; y: number } | null {
  const buffer = term.buffer.active;
  const viewportFirstLine = buffer.viewportY;
  const viewportLastLine = Math.min(buffer.length, viewportFirstLine + term.rows);
  // Include possible placement origins just above the viewport so a partially
  // visible image remains positioned and is clipped by the overlay. Likewise,
  // a placement may start on the final visible row and continue below it.
  const firstLine = Math.max(0, viewportFirstLine - frame.rows + 1);
  const lastLine = viewportLastLine;

  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = firstLine; y < lastLine; y += 1) {
    const line = buffer.getLine(y);
    if (!line) continue;
    for (let x = 0; x < term.cols; x += 1) {
      const cell = line.getCell(x);
      if (!cell || !cell.isFgRGB() || cell.getFgColor() !== frame.id) continue;
      const codepoints = [...cell.getChars()].map((value) => value.codePointAt(0));
      if (codepoints[0] === KITTY_PLACEHOLDER_CODEPOINT && codepoints[1] === KITTY_FIRST_ROW_MARK) {
        candidates.push({ x, y });
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.x + frame.cols > term.cols || candidate.y + frame.rows > buffer.length) continue;
    let complete = true;
    for (let row = 0; row < frame.rows && complete; row += 1) {
      for (let col = 0; col < frame.cols; col += 1) {
        if (!isPlaceholderCell(term, candidate.x + col, candidate.y + row, frame.id)) {
          complete = false;
          break;
        }
      }
    }
    if (complete) return candidate;
  }
  return null;
}

interface ImageElement {
  wrapper: HTMLDivElement;
  image: HTMLImageElement;
}

/** Paints decoded images over their xterm Unicode placeholder rectangles. */
export class KittyGraphicsLayer implements IDisposable {
  private readonly decoder: KittyGraphicsDecoder;
  private readonly frames = new Map<number, KittyPngFrame>();
  private readonly elements = new Map<number, ImageElement>();
  private readonly disposables: IDisposable[] = [];
  private refreshQueued = false;
  private disposed = false;

  public constructor(
    private readonly term: Terminal,
    private readonly screen: HTMLElement,
    private readonly overlay: HTMLDivElement,
  ) {
    this.decoder = new KittyGraphicsDecoder((frame) => this.storeFrame(frame));
    this.disposables.push(
      term.onWriteParsed(() => this.scheduleRefresh()),
      term.onRender(() => this.scheduleRefresh()),
      term.onScroll(() => this.scheduleRefresh()),
      term.onResize(() => this.scheduleRefresh()),
      term.buffer.onBufferChange(() => this.scheduleRefresh()),
    );
  }

  public push(data: string): void {
    this.decoder.push(data);
  }

  private storeFrame(frame: KittyPngFrame): void {
    if (!this.frames.has(frame.id) && this.frames.size >= MAX_STORED_IMAGES) {
      const oldest = this.frames.keys().next().value as number | undefined;
      if (oldest !== undefined) {
        this.frames.delete(oldest);
        this.elements.get(oldest)?.wrapper.remove();
        this.elements.delete(oldest);
      }
    }
    this.frames.set(frame.id, frame);
    const existing = this.elements.get(frame.id);
    if (existing) existing.image.src = frame.dataUrl;
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued || this.disposed) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (!this.disposed) this.refresh();
    });
  }

  public refresh(): void {
    const width = this.screen.getBoundingClientRect().width || this.screen.clientWidth || parseFloat(this.screen.style.width);
    const height = this.screen.getBoundingClientRect().height || this.screen.clientHeight || parseFloat(this.screen.style.height);
    if (!width || !height || !this.term.cols || !this.term.rows) return;

    const cellWidth = width / this.term.cols;
    const cellHeight = height / this.term.rows;
    const viewportY = this.term.buffer.active.viewportY;
    const active = new Set<number>();
    const background = this.term.options.theme?.background || '#000000';

    for (const frame of this.frames.values()) {
      const placement = findPlacement(this.term, frame);
      if (!placement) continue;
      active.add(frame.id);
      let element = this.elements.get(frame.id);
      if (!element) {
        const wrapper = document.createElement('div');
        const image = document.createElement('img');
        wrapper.dataset.kittyImageId = String(frame.id);
        wrapper.setAttribute('aria-hidden', 'true');
        Object.assign(wrapper.style, {
          position: 'absolute',
          zIndex: '4',
          overflow: 'hidden',
          pointerEvents: 'none',
          contain: 'strict',
        });
        image.alt = '';
        image.draggable = false;
        image.src = frame.dataUrl;
        Object.assign(image.style, {
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          imageRendering: 'auto',
        });
        wrapper.appendChild(image);
        this.overlay.appendChild(wrapper);
        element = { wrapper, image };
        this.elements.set(frame.id, element);
      }

      Object.assign(element.wrapper.style, {
        display: 'block',
        left: `${placement.x * cellWidth}px`,
        top: `${(placement.y - viewportY) * cellHeight}px`,
        width: `${frame.cols * cellWidth}px`,
        height: `${frame.rows * cellHeight}px`,
        background,
      });
    }

    for (const [id, element] of this.elements) {
      if (!active.has(id)) element.wrapper.style.display = 'none';
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.decoder.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.elements.clear();
    this.frames.clear();
    this.overlay.remove();
  }
}

export function createKittyGraphicsLayer(term: Terminal): KittyGraphicsLayer | null {
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
  if (!screen) return null;
  const overlay = document.createElement('div');
  overlay.className = 'janet-kitty-image-layer';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '4',
  });
  screen.appendChild(overlay);
  return new KittyGraphicsLayer(term, screen, overlay);
}
