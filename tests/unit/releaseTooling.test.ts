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
  it('builds Electron entry points through the esbuild API without an npx subprocess', async () => {
    const { buildElectron } = await loadScript('build-electron.mjs');
    const builds: Record<string, unknown>[] = [];

    buildElectron({
      build(options: Record<string, unknown>) {
        builds.push(options);
      },
    });

    expect(builds).toEqual([
      expect.objectContaining({
        absWorkingDir: projectRoot,
        entryPoints: ['src/main/index.ts'],
        outfile: 'dist/main/index.js',
        bundle: true,
        platform: 'node',
        external: ['electron', 'node-pty', 'ssh2', 'ssh2-sftp-client', 'simple-git'],
      }),
      expect.objectContaining({
        absWorkingDir: projectRoot,
        entryPoints: ['src/main/preload.ts'],
        outfile: 'dist/main/preload.js',
        bundle: true,
        platform: 'node',
        external: ['electron', 'node-pty', 'ssh2', 'ssh2-sftp-client', 'simple-git'],
      }),
    ]);

    const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-electron.mjs'), 'utf8');
    expect(source).toContain("require('esbuild').buildSync");
    expect(source).not.toContain('child_process');
    expect(source).not.toMatch(/\bnpx(?:\.cmd)?\b/);
  });

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

  it('validates unpacked PTY files but loads the logical asar module path', async () => {
    const {
      macPackagedRuntimes,
      packagedRuntime,
      PACKAGED_RUNTIME_TIMEOUT_MS,
    } = await loadScript('verify-release-artifacts.mjs');
    const macRuntime = packagedRuntime('macos', '/release', 'arm64');
    const windowsRuntime = packagedRuntime('windows', '/release', 'x64');

    expect(macRuntime.executable).toBe(path.join('/release', 'mac-arm64', 'JaneT.app', 'Contents', 'MacOS', 'JaneT'));
    expect(macRuntime.nodePtyRoot).toContain(path.join('app.asar.unpacked', 'node_modules', 'node-pty'));
    expect(macRuntime.nodePtyModule).toContain(path.join('app.asar', 'node_modules', 'node-pty'));
    expect(macRuntime.nodePtyModule).not.toContain('app.asar.unpacked');
    expect(windowsRuntime.executable).toBe(path.join('/release', 'win-unpacked', 'JaneT.exe'));
    expect(windowsRuntime.nodePtyRoot).toContain(path.join('app.asar.unpacked', 'node_modules', 'node-pty'));
    expect(windowsRuntime.nodePtyModule).toContain(path.join('app.asar', 'node_modules', 'node-pty'));
    expect(PACKAGED_RUNTIME_TIMEOUT_MS).toBe(60_000);
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

  it('requires valid ad-hoc macOS signatures without an authority or team identifier', async () => {
    const { validateAdHocMacSignature } = await loadScript('verify-release-artifacts.mjs');
    const validDetails = [
      'Executable=/release/JaneT.app/Contents/MacOS/JaneT',
      'Signature=adhoc',
      'TeamIdentifier=not set',
    ].join('\n');

    expect(() => validateAdHocMacSignature(validDetails, '/release/JaneT.app')).not.toThrow();
    expect(() => validateAdHocMacSignature(
      validDetails.replace('Signature=adhoc', 'Authority=Developer ID Application: Example\nSignature size=9000'),
      '/release/JaneT.app',
    )).toThrow(/not ad-hoc signed/);
    expect(() => validateAdHocMacSignature(
      `${validDetails}\nAuthority=Developer ID Application: Example`,
      '/release/JaneT.app',
    )).toThrow(/certificate authority/);
    expect(() => validateAdHocMacSignature(
      validDetails.replace('TeamIdentifier=not set', 'TeamIdentifier=ABCDE12345'),
      '/release/JaneT.app',
    )).toThrow(/team identifier/);
  });

  it('starts the packaged PTY smoke child only after data and exit listeners attach', async () => {
    const { smokeTerminalRuntime } = await loadScript('verify-release-artifacts.mjs');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-smoke-'));
    const fakePtyRoot = path.join(fixtureRoot, 'app.asar.unpacked', 'node_modules', 'node-pty');
    const fakePtyModule = path.join(fixtureRoot, 'app.asar', 'node_modules', 'node-pty');
    const marker = '__JANET_PACKAGED_PTY_OK__';
    const ready = '__JANET_PACKAGED_PTY_READY__';
    fs.mkdirSync(fakePtyRoot, { recursive: true });
    fs.mkdirSync(fakePtyModule, { recursive: true });
    fs.writeFileSync(path.join(fakePtyModule, 'index.js'), `
module.exports = {
  spawn(_executable, args) {
    let dataListener;
    let exitListener;
    let queuedInput;
    const terminal = {
      onData(listener) { dataListener = listener; },
      onExit(listener) { exitListener = listener; },
      write(input) {
        if (!dataListener || !exitListener) throw new Error('PTY trigger ran before listeners attached');
        if (input.includes(${JSON.stringify(marker)})) throw new Error('PTY trigger must not echo the success marker');
        queuedInput = input;
      },
      kill() {},
    };
    queueMicrotask(() => {
      if (!dataListener || !exitListener) throw new Error('PTY readiness ran before listeners attached');
      if (!args[1].includes('process.stdin.once')) throw new Error('PTY child does not wait for input');
      if (!args[1].includes('process.stdin.pause')) throw new Error('PTY child will not exit after input');
      if (!args[1].includes(${JSON.stringify(ready)})) {
        exitListener({ exitCode: 0 });
        return;
      }
      dataListener(${JSON.stringify(ready)});
      if (typeof queuedInput !== 'string') {
        exitListener({ exitCode: 0 });
        return;
      }
      dataListener(${JSON.stringify(marker)});
      exitListener({ exitCode: 0 });
    });
    return terminal;
  },
};
`);

    try {
      await expect(smokeTerminalRuntime({
        executable: process.execPath,
        nodePtyRoot: fakePtyRoot,
        nodePtyModule: fakePtyModule,
      })).resolves.toBeUndefined();
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('pins release CI to explicit ad-hoc macOS signing without Apple credentials', () => {
    const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toContain('build-args: --mac -c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false -c.npmRebuild=false');
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(workflow).not.toContain('Require macOS signing and notarization secrets');
    for (const secretName of [
      'MAC_CSC_LINK',
      'MAC_CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ]) {
      expect(workflow).not.toContain(secretName);
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    expect(packageJson.scripts['dist:mac:test']).toContain('-c.npmRebuild=false');
    expect(packageJson.build.mac.signIgnore).toEqual([
      'node_modules/node-pty/prebuilds/darwin-(?:x64|arm64)/(?:pty\\.node|spawn-helper)$',
    ]);
  });

  it('declares the Node version required by Electron 43', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    expect(packageJson.engines).toEqual({ node: '>=22.12.0' });
    expect(fs.readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim()).toBe('22.12.0');
  });
});
