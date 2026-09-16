import type { Terminal } from '@xterm/xterm';
import { ImageAddon } from '@xterm/addon-image';

/** Shared by local and SSH panes; xterm owns direct Kitty image rendering. */
export function enableTerminalGraphics(term: Terminal): void {
  term.loadAddon(new ImageAddon({
    kittySupport: true,
    // Keep these protocols opt-in until their rendering and lifecycle behavior
    // have dedicated coverage.
    sixelSupport: false,
    iipSupport: false,
    pixelLimit: 4096 * 4096,
    storageLimit: 32,
    kittySizeLimit: 8 * 1024 * 1024,
  }));
}
