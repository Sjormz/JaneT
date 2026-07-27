export interface RendererEventTarget {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed?(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
}

export function sendRendererEvent(
  window: RendererEventTarget | null,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) return false;
  try {
    window.webContents.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}
