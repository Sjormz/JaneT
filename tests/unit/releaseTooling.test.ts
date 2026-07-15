import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function loadScript(name: string): Promise<any> {
  return import(pathToFileURL(path.join(projectRoot, 'scripts', name)).href);
}

describe('development tooling', () => {
  it('derives the Vite bind host and port from the configured renderer URL', async () => {
    const { npxExecutable, parseDevServerUrl } = await loadScript('dev.mjs');

    expect(parseDevServerUrl('http://0.0.0.0:6123/workspace?mode=test')).toEqual({
      url: 'http://0.0.0.0:6123/workspace?mode=test',
      host: '0.0.0.0',
      port: 6123,
    });
    expect(parseDevServerUrl('http://[::1]:7000')).toMatchObject({ host: '::1', port: 7000 });
    expect(() => parseDevServerUrl('https://localhost:5173')).toThrow(/must use http/);
    expect(() => parseDevServerUrl('http://localhost$(touch-pwned):5173')).toThrow(/unsafe hostname/);
    expect(npxExecutable('win32')).toBe('npx.cmd');
    expect(npxExecutable('linux')).toBe('npx');
    const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'dev.mjs'), 'utf8');
    expect(source).not.toContain('shell: true');
    expect(source).toContain('shell: false');
  });

  it('watches shared modules that are bundled into the Electron main process', async () => {
    const { mainSourceDirectories } = await loadScript('dev.mjs');
    expect(mainSourceDirectories('/repo')).toEqual([
      path.join('/repo', 'src/main'),
      path.join('/repo', 'src/shared'),
    ]);
  });
});

describe('release tooling', () => {
  it('requires every installer and update manifest for each supported platform', async () => {
    const { expectedReleaseArtifacts } = await loadScript('verify-release-artifacts.mjs');

    expect(expectedReleaseArtifacts('windows', '1.2.3')).toEqual([
      'JaneT-Setup-1.2.3-win-x64.exe',
      'JaneT-Setup-1.2.3-win-x64.exe.blockmap',
      'JaneT-Portable-1.2.3-win-x64.exe',
      'latest.yml',
    ]);
    expect(expectedReleaseArtifacts('macos', '1.2.3')).toEqual([
      'JaneT-1.2.3-mac-x64.dmg',
      'JaneT-1.2.3-mac-x64.zip',
      'JaneT-1.2.3-mac-x64.zip.blockmap',
      'JaneT-1.2.3-mac-arm64.dmg',
      'JaneT-1.2.3-mac-arm64.zip',
      'JaneT-1.2.3-mac-arm64.zip.blockmap',
      'latest-mac.yml',
    ]);
    expect(expectedReleaseArtifacts('linux', '1.2.3')).toEqual([
      'JaneT-1.2.3-linux-x64.AppImage',
      'JaneT-1.2.3-linux-x64.deb',
      'latest-linux.yml',
    ]);
  });

  it('points packaged PTY checks at asar-unpacked production dependencies', async () => {
    const { macPackagedRuntimes, packagedRuntime } = await loadScript('verify-release-artifacts.mjs');
    const macRuntime = packagedRuntime('macos', '/release', 'arm64');
    const windowsRuntime = packagedRuntime('windows', '/release', 'x64');

    expect(macRuntime.executable).toBe(path.join('/release', 'mac-arm64', 'JaneT.app', 'Contents', 'MacOS', 'JaneT'));
    expect(macRuntime.nodePtyRoot).toContain(path.join('app.asar.unpacked', 'node_modules', 'node-pty'));
    expect(windowsRuntime.executable).toBe(path.join('/release', 'win-unpacked', 'JaneT.exe'));
    expect(macPackagedRuntimes('/release').map((runtime: { arch: string }) => runtime.arch)).toEqual(['x64', 'arm64']);
  });

  it.skipIf(process.platform === 'win32')('validates both macOS native PTY layouts and helper execute bits', async () => {
    const { macPackagedRuntimes, validateMacPtyLayout } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-layout-'));
    try {
      const runtimes = macPackagedRuntimes(releaseRoot);
      for (const runtime of runtimes) {
        fs.mkdirSync(path.dirname(runtime.executable), { recursive: true });
        fs.writeFileSync(runtime.executable, 'electron');
        fs.chmodSync(runtime.executable, 0o755);
        const prebuild = path.join(runtime.nodePtyRoot, 'prebuilds', `darwin-${runtime.arch}`);
        fs.mkdirSync(prebuild, { recursive: true });
        fs.writeFileSync(path.join(prebuild, 'pty.node'), 'native');
        fs.writeFileSync(path.join(prebuild, 'spawn-helper'), 'helper');
        fs.chmodSync(path.join(prebuild, 'spawn-helper'), 0o755);
        expect(() => validateMacPtyLayout(runtime)).not.toThrow();
      }

      const nonHost = runtimes.find((runtime: { arch: string }) => runtime.arch !== process.arch) ?? runtimes[1];
      const helper = path.join(nonHost.nodePtyRoot, 'prebuilds', `darwin-${nonHost.arch}`, 'spawn-helper');
      fs.chmodSync(helper, 0o644);
      expect(() => validateMacPtyLayout(nonHost)).toThrow(/helper is not executable/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('declares the Node version required by Electron 43', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    expect(packageJson.engines).toEqual({ node: '>=22.12.0' });
    expect(fs.readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim()).toBe('22.12.0');
  });
});
