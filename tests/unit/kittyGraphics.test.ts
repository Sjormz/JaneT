import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const imageAddons = vi.hoisted(() => ({ instances: [] as Array<{ options: unknown }> }));

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: class {
    public constructor(public readonly options: unknown) {
      imageAddons.instances.push(this);
    }
  },
}));

import { enableTerminalGraphics } from '../../src/renderer/kittyGraphics';

describe('enableTerminalGraphics', () => {
  it('loads only the bounded upstream image addon', () => {
    const loadAddon = vi.fn();
    const registerApcHandler = vi.fn();
    const term = { loadAddon, parser: { registerApcHandler } } as unknown as Terminal;

    expect(enableTerminalGraphics(term)).toBeUndefined();
    const addon = imageAddons.instances[0];

    expect(loadAddon).toHaveBeenCalledOnce();
    expect(addon.options).toEqual({
      kittySupport: true,
      sixelSupport: false,
      iipSupport: false,
      pixelLimit: 4096 * 4096,
      storageLimit: 32,
      kittySizeLimit: 8 * 1024 * 1024,
    });
    expect(registerApcHandler).not.toHaveBeenCalled();
    expect(document.querySelector('.janet-kitty-image-layer')).toBeNull();
  });
});
