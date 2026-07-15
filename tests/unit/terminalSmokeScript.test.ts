import { describe, expect, it } from 'vitest';
import pty from 'node-pty';

const marker = '__JANET_TERMINAL_SMOKE__';

describe('node-pty host runtime', () => {
  it('loads the native module, spawns a real PTY, and receives child output', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      let received = '';
      let terminal: pty.IPty;
      const timeout = setTimeout(() => {
        try { terminal?.kill(); } catch {}
        reject(new Error(`PTY smoke timed out: ${JSON.stringify(received)}`));
      }, 4_000);

      try {
        terminal = pty.spawn(process.execPath, ['-e', `console.log('${marker}')`], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }

      terminal.onData((data) => { received += data; });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (exitCode === 0) resolve(received);
        else reject(new Error(`PTY child exited ${exitCode}: ${JSON.stringify(received)}`));
      });
    });

    expect(output).toContain(marker);
  }, 10_000);
});
