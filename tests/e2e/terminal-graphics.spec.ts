import { test, expect, _electron as electron } from '@playwright/test';
import { forceClose } from './electronLifecycle';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

test('Kitty capability probes, chunked images and deletion traverse a real PTY', async () => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-graphics-e2e-'));
  const fixture = path.join(userData, 'graphics.cjs');
  const png = (await sharp({ create: {
    width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 },
  } }).png().toBuffer()).toString('base64');
  fs.writeFileSync(fixture, `
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = '';
    const apc = s => '\\x1b_G' + s + '\\x1b\\\\';
    process.stdin.on('data', chunk => {
      input += chunk;
      if (input.includes('i=77;OK')) {
        input = '';
        process.stdout.write('\\r\\nPROBE_OK\\r\\n');
        // Same direct, chunked transfer used by Codex pets, with raw RGBA here.
        process.stdout.write(apc('a=T,t=d,f=32,s=1,v=1,c=4,r=2,i=42,q=2,m=1;/w'));
        process.stdout.write(apc('m=0;AA/w=='));
      }
      if (input.includes('d')) {
        input = '';
        process.stdout.write(apc('a=d,d=I,i=42,q=2;'));
      }
      if (input.includes('p')) {
        input = '';
        process.stdout.write(apc('a=T,t=d,f=100,c=4,r=2,i=42,q=2,m=1;${png.slice(0, 28)}'));
        process.stdout.write(apc('m=0;${png.slice(28)}'));
      }
    });
    console.log('GRAPHICS_ENV=' + Boolean(process.env.KITTY_WINDOW_ID));
    process.stdout.write(apc('a=q,t=d,f=24,s=1,v=1,i=77;AAAA'));
  `);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    mainDirectory: userData,
    session: {
      tabs: [{ id: 'graphics', title: 'graphics', type: 'local', root: {
        type: 'leaf', terminalType: 'local', startupCommands: [`node "${fixture}"`],
      } }], activeTabId: 'graphics', sidebarOpen: false,
    },
  }));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.'], cwd: path.resolve(__dirname, '../..'),
    env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.xterm-rows')).toContainText('GRAPHICS_ENV=true', { timeout: 20_000 });
    await expect(page.locator('.xterm-rows')).toContainText('PROBE_OK');
    const redPixels = () => page.locator('canvas.xterm-image-layer-top').evaluateAll(canvases => {
      let count = 0;
      for (const canvas of canvases as HTMLCanvasElement[]) {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 200 && pixels[i + 1] < 30 && pixels[i + 2] < 30 && pixels[i + 3] > 200) count++;
        }
      }
      return count;
    });
    await expect.poll(redPixels).toBeGreaterThan(100);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('d');
    await expect.poll(redPixels).toBe(0);
    await page.keyboard.type('p');
    await expect.poll(redPixels).toBeGreaterThan(100);
    await page.keyboard.type('d');
    await expect.poll(redPixels).toBe(0);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
