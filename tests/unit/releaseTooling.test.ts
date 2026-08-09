import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function loadScript(name: string): Promise<any> {
  return import(pathToFileURL(path.join(projectRoot, 'scripts', name)).href);
}

function writeWindowsReleaseFixture(releaseRoot: string, version = '1.2.3') {
  const setup = `JaneT-Setup-${version}-win-x64.exe`;
  const setupBytes = Buffer.from('windows setup bytes');
  const setupSha512 = createHash('sha512').update(setupBytes).digest('base64');
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, setup), setupBytes);
  fs.writeFileSync(path.join(releaseRoot, `${setup}.blockmap`), 'blockmap');
  fs.writeFileSync(path.join(releaseRoot, `JaneT-Portable-${version}-win-x64.exe`), 'portable');
  fs.writeFileSync(path.join(releaseRoot, 'latest.yml'), [
    `version: ${version}`,
    'files:',
    `  - url: ${setup}`,
    `    sha512: ${setupSha512}`,
    `    size: ${setupBytes.length}`,
    `path: ${setup}`,
    `sha512: ${setupSha512}`,
    "releaseDate: '2026-08-08T00:00:00.000Z'",
    '',
  ].join('\n'));
  return { setupSha512 };
}

function writeReleaseManifestFixture(
  releaseRoot: string,
  manifestName: string,
  version: string,
  fileNames: string[],
  primary: string,
  blockmaps: string[] = [],
) {
  const files = fileNames.map((name) => {
    const bytes = Buffer.from(`${name} bytes`);
    fs.writeFileSync(path.join(releaseRoot, name), bytes);
    return {
      name,
      sha512: createHash('sha512').update(bytes).digest('base64'),
      size: bytes.length,
    };
  });
  const primaryFile = files.find(({ name }) => name === primary)!;
  for (const blockmap of blockmaps) fs.writeFileSync(path.join(releaseRoot, blockmap), `${blockmap} bytes`);
  fs.writeFileSync(path.join(releaseRoot, manifestName), [
    `version: ${version}`,
    'files:',
    ...files.flatMap(({ name, sha512, size }) => [
      `  - url: ${name}`,
      `    sha512: ${sha512}`,
      `    size: ${size}`,
    ]),
    `path: ${primary}`,
    `sha512: ${primaryFile.sha512}`,
    "releaseDate: '2026-08-08T00:00:00.000Z'",
    '',
  ].join('\n'));
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
  it('keeps documented shortcuts aligned with the platform defaults', async () => {
    const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const { defaultKeybindingsForPlatform } = await import('../../src/renderer/keybindings');
    const windows = defaultKeybindingsForPlatform('win32');
    const macos = defaultKeybindingsForPlatform('darwin');
    const display = (shortcut: string) => shortcut ? shortcut.replace(/^Meta/, 'Cmd') : 'Unbound';
    const rows = [
      ['Command palette', 'palette-toggle'],
      ['New terminal tab', 'new-terminal'],
      ['Search terminal output', 'search-toggle'],
      ['Toggle workspace tools', 'toggle-sidebar'],
      ['Open snippets', 'snippets-toggle'],
      ['Split pane right', 'split-right'],
      ['Split pane below', 'split-down'],
    ] as const;

    for (const [label, action] of rows) {
      expect(readme).toContain(
        `| ${label} | \`${display(windows[action])}\` | \`${display(macos[action])}\` |`,
      );
    }
  });

  it('documents fresh-shell restart and unauthenticated agent status truthfully', () => {
    const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

    expect(readme).not.toContain('Keep active terminal and SSH work running when the window closes');
    expect(readme).toContain('Closing JaneT ends its managed local and SSH terminal sessions');
    expect(readme).toContain('Restarting restores the saved workspace structure into fresh shells');
    expect(readme).toContain('startup commands run again');
    expect(readme).toContain('Agent lifecycle status is bounded metadata, not an authenticated security signal');
  });

  it('documents launch recovery for every public package family', () => {
    const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

    expect(readme).toContain('Windows builds are unsigned');
    expect(readme).toContain('SmartScreen');
    expect(readme).toContain('Privacy & Security');
    expect(readme).toContain('Open Anyway');
    expect(readme).toContain('chmod +x JaneT-<version>-linux-x64.AppImage');
  });

  it('keeps the documented node-pty lock and Windows fixes aligned with release tooling', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const releaseGuide = fs.readFileSync(path.join(projectRoot, 'docs', 'release.md'), 'utf8');

    expect(releaseGuide).toContain(`locks \`node-pty\` ${packageJson.dependencies['node-pty']}`);
    expect(releaseGuide).toContain('upstream race fix #922');
    expect(releaseGuide).toContain('PR #885');
    expect(releaseGuide).not.toContain('locks `node-pty` 1.1.0');
  });

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

  it('recomputes the updater manifest SHA-512 from local package bytes', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      const { setupSha512 } = writeWindowsReleaseFixture(releaseRoot);
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot)).resolves.toBeUndefined();

      const manifestPath = path.join(releaseRoot, 'latest.yml');
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      fs.writeFileSync(manifestPath, manifest.replaceAll(setupSha512, Buffer.alloc(64).toString('base64')));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/SHA-512 mismatch/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('enforces the updater manifest version and exact package matrix', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      writeWindowsReleaseFixture(releaseRoot);
      const manifestPath = path.join(releaseRoot, 'latest.yml');
      const manifest = fs.readFileSync(manifestPath, 'utf8');

      fs.writeFileSync(manifestPath, manifest.replace('version: 1.2.3', 'version: 1.2.4'));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/version mismatch/);

      fs.writeFileSync(manifestPath, manifest.replace(
        'url: JaneT-Setup-1.2.3-win-x64.exe',
        'url: JaneT-Portable-1.2.3-win-x64.exe',
      ));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/file matrix mismatch/);

      const duplicateEntry = manifest.match(/  - url:.*\n    sha512:.*\n    size:.*\n/)?.[0] ?? '';
      fs.writeFileSync(manifestPath, manifest.replace('path:', `${duplicateEntry}path:`));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/file matrix mismatch/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('accepts the generated macOS and Linux architecture matrices', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      const version = '1.2.3';
      const macFiles = [
        `JaneT-${version}-mac-x64.zip`,
        `JaneT-${version}-mac-arm64.zip`,
        `JaneT-${version}-mac-x64.dmg`,
        `JaneT-${version}-mac-arm64.dmg`,
      ];
      writeReleaseManifestFixture(releaseRoot, 'latest-mac.yml', version, macFiles, macFiles[0], [
        `${macFiles[0]}.blockmap`,
        `${macFiles[1]}.blockmap`,
      ]);
      await expect(verifyReleaseManifest('macos', version, releaseRoot)).resolves.toBeUndefined();

      fs.rmSync(releaseRoot, { recursive: true, force: true });
      fs.mkdirSync(releaseRoot);
      const linuxFiles = [
        `JaneT-${version}-linux-x64.AppImage`,
        `JaneT-${version}-linux-x64.deb`,
      ];
      writeReleaseManifestFixture(releaseRoot, 'latest-linux.yml', version, linuxFiles, linuxFiles[0]);
      await expect(verifyReleaseManifest('linux', version, releaseRoot)).resolves.toBeUndefined();
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('matches manifest sizes and primary metadata to local package bytes', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      writeWindowsReleaseFixture(releaseRoot);
      const manifestPath = path.join(releaseRoot, 'latest.yml');
      const manifest = fs.readFileSync(manifestPath, 'utf8');

      fs.writeFileSync(manifestPath, manifest.replace(/    size: \d+/, '    size: 1'));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/size mismatch/);

      fs.writeFileSync(manifestPath, manifest.replace(
        'path: JaneT-Setup-1.2.3-win-x64.exe',
        'path: JaneT-Portable-1.2.3-win-x64.exe',
      ));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/primary package mismatch/);

      fs.writeFileSync(manifestPath, manifest.replace(
        /^sha512: .*$/m,
        `sha512: ${Buffer.alloc(64).toString('base64')}`,
      ));
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/primary package mismatch/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('requires policy blockmaps and rejects unexpected release artifacts', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      writeWindowsReleaseFixture(releaseRoot);
      const blockmap = path.join(releaseRoot, 'JaneT-Setup-1.2.3-win-x64.exe.blockmap');
      fs.rmSync(blockmap);
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/referenced blockmap/);

      fs.writeFileSync(blockmap, 'blockmap');
      fs.writeFileSync(path.join(releaseRoot, 'JaneT-Debug-1.2.3-win-x64.zip'), 'unexpected');
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/Unexpected windows release artifacts.*JaneT-Debug/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('rejects oversized or malformed updater manifests', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    try {
      writeWindowsReleaseFixture(releaseRoot);
      const manifestPath = path.join(releaseRoot, 'latest.yml');
      const manifest = fs.readFileSync(manifestPath, 'utf8');

      fs.writeFileSync(manifestPath, `${manifest}\n#${'x'.repeat(64 * 1024)}`);
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/unexpectedly large/);

      fs.writeFileSync(manifestPath, 'version: [unterminated');
      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/Invalid windows update manifest/);
    } finally {
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('rejects invalid parsed updater manifest shapes', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    const manifestPath = path.join(releaseRoot, 'latest.yml');
    const createReadStream = vi.spyOn(fs, 'createReadStream');
    const invalidManifests = [
      ['scalar root', 'manifest', /Invalid windows update manifest/],
      ['array root', '- manifest', /Invalid windows update manifest/],
      ['missing files', 'version: 1.2.3', /Invalid windows update manifest/],
      ['scalar files', 'version: 1.2.3\nfiles: manifest', /Invalid windows update manifest/],
      ['scalar entry', 'version: 1.2.3\nfiles:\n  - package', /file matrix mismatch/],
      ['array entry', 'version: 1.2.3\nfiles:\n  - [package]', /file matrix mismatch/],
      ['missing URL', 'version: 1.2.3\nfiles:\n  - size: 1', /file matrix mismatch/],
    ] as const;
    try {
      for (const [name, manifest, error] of invalidManifests) {
        fs.writeFileSync(manifestPath, manifest);
        await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot), name)
          .rejects.toThrow(error);
      }
      expect(createReadStream).not.toHaveBeenCalled();
    } finally {
      createReadStream.mockRestore();
      fs.rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal references before reading package bytes outside the release root', async () => {
    const { verifyReleaseManifest } = await loadScript('verify-release-artifacts.mjs');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-manifest-'));
    const releaseRoot = path.join(fixtureRoot, 'release');
    const outsidePath = path.join(fixtureRoot, 'outside.exe');
    const outsideBytes = Buffer.from('outside package bytes');
    const createReadStream = vi.spyOn(fs, 'createReadStream');
    try {
      fs.mkdirSync(releaseRoot);
      fs.writeFileSync(outsidePath, outsideBytes);
      fs.writeFileSync(path.join(releaseRoot, 'latest.yml'), [
        'version: 1.2.3',
        'files:',
        '  - url: ../outside.exe',
        `    sha512: ${createHash('sha512').update(outsideBytes).digest('base64')}`,
        `    size: ${outsideBytes.length}`,
        'path: JaneT-Setup-1.2.3-win-x64.exe',
        `sha512: ${createHash('sha512').update(outsideBytes).digest('base64')}`,
        '',
      ].join('\n'));

      await expect(verifyReleaseManifest('windows', '1.2.3', releaseRoot))
        .rejects.toThrow(/file matrix mismatch/);
      expect(createReadStream).not.toHaveBeenCalledWith(outsidePath);
    } finally {
      createReadStream.mockRestore();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('validates unpacked PTY files but loads the logical asar module path', async () => {
    const {
      macPackagedRuntimes,
      nativeMacRuntime,
      packagedRuntime,
      PACKAGED_RUNTIME_TIMEOUT_MS,
    } = await loadScript('verify-release-artifacts.mjs');
    const macRuntime = packagedRuntime('macos', '/release', 'arm64');
    const windowsRuntime = packagedRuntime('windows', '/release', 'x64');

    expect(macRuntime.executable).toBe(path.join('/release', 'mac-arm64', 'JaneT.app', 'Contents', 'MacOS', 'JaneT'));
    expect(macRuntime.platform).toBe('darwin');
    expect(macRuntime.nodePtyRoot).toContain(path.join('app.asar.unpacked', 'node_modules', 'node-pty'));
    expect(macRuntime.nodePtyModule).toContain(path.join('app.asar', 'node_modules', 'node-pty'));
    expect(macRuntime.nodePtyModule).not.toContain('app.asar.unpacked');
    expect(windowsRuntime.executable).toBe(path.join('/release', 'win-unpacked', 'JaneT.exe'));
    expect(windowsRuntime.platform).toBe('win32');
    expect(windowsRuntime.nodePtyRoot).toContain(path.join('app.asar.unpacked', 'node_modules', 'node-pty'));
    expect(windowsRuntime.nodePtyModule).toContain(path.join('app.asar', 'node_modules', 'node-pty'));
    expect(windowsRuntime.nodePtyModule).not.toContain('app.asar.unpacked');
    expect(PACKAGED_RUNTIME_TIMEOUT_MS).toBe(60_000);
    expect(macPackagedRuntimes('/release').map((runtime: { arch: string }) => runtime.arch)).toEqual(['x64', 'arm64']);
    expect(nativeMacRuntime('/release', 'arm64').arch).toBe('arm64');
    expect(nativeMacRuntime('/release', 'x64').arch).toBe('x64');
    expect(() => nativeMacRuntime('/release', 'riscv64')).toThrow(/No packaged macOS runtime matches/);
  });

  it('backports and verifies node-pty Windows ConPTY startup hardening', async () => {
    const {
      APP_ASAR_WORKER_REWRITE,
      CONPTY_DEFERRED_CONNECT_MARKER,
      CONPTY_PID_REFRESH_MARKER,
      CONPTY_PROCESS_LIST_MARKER,
      patchNodePtyConsoleListAgentSource,
      patchNodePtyWindowsAgentSource,
      patchNodePtyWindowsSources,
      patchNodePtyWindowsTerminalSource,
      patchNodePtyWindowsWorkerSource,
    } = await loadScript('patch-node-pty-windows-worker.mjs');
    const { validateWindowsPtyRuntime } = await loadScript('verify-release-artifacts.mjs');
    const legacy = "var scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');";
    const patched = patchNodePtyWindowsWorkerSource(legacy);

    expect(patched).toContain(APP_ASAR_WORKER_REWRITE);
    expect(patchNodePtyWindowsWorkerSource(patched)).toBe(patched);
    expect(() => patchNodePtyWindowsWorkerSource('unknown worker implementation')).toThrow(/expected worker path resolver/);
    expect(() => patchNodePtyWindowsAgentSource('unknown agent implementation')).toThrow(/expected Conout worker readiness block/);
    expect(() => patchNodePtyWindowsTerminalSource('unknown terminal implementation')).toThrow(/expected ready_datapipe handler/);
    expect(() => patchNodePtyConsoleListAgentSource('unknown helper implementation')).toThrow(/expected console process-list agent call/);
    expect(() => patchNodePtyWindowsAgentSource(`// ${CONPTY_DEFERRED_CONNECT_MARKER}`)).toThrow(/Incomplete node-pty Windows agent patch/);
    expect(() => patchNodePtyWindowsTerminalSource(`// ${CONPTY_PID_REFRESH_MARKER}`)).toThrow(/Incomplete node-pty Windows terminal patch/);
    expect(() => patchNodePtyConsoleListAgentSource(`// ${CONPTY_PROCESS_LIST_MARKER}`)).toThrow(/Incomplete node-pty Windows console-list agent patch/);

    const installedLibRoot = path.join(projectRoot, 'node_modules', 'node-pty', 'lib');
    const installedNodePtyRoot = path.dirname(installedLibRoot);
    const installedNodePtyPackage = JSON.parse(
      fs.readFileSync(path.join(installedNodePtyRoot, 'package.json'), 'utf8'),
    );
    const installedConptySource = fs.readFileSync(
      path.join(installedNodePtyRoot, 'src', 'win', 'conpty.cc'),
      'utf8',
    );
    expect(installedNodePtyPackage.version).toBe('1.2.0-beta.14');
    expect(installedConptySource).toContain('static std::mutex g_ptyHandlesMutex;');
    expect(installedConptySource).toContain('std::atomic<int> ptyCounter{0};');
    expect(installedConptySource).not.toContain('assert(remove_pty_baton');
    const installedSources = {
      worker: fs.readFileSync(path.join(installedLibRoot, 'windowsConoutConnection.js'), 'utf8'),
      agent: fs.readFileSync(path.join(installedLibRoot, 'windowsPtyAgent.js'), 'utf8'),
      terminal: fs.readFileSync(path.join(installedLibRoot, 'windowsTerminal.js'), 'utf8'),
      consoleListAgent: fs.readFileSync(path.join(installedLibRoot, 'conpty_console_list_agent.js'), 'utf8'),
    };
    expect(installedSources.worker).toContain(APP_ASAR_WORKER_REWRITE);
    expect(patchNodePtyWindowsSources(installedSources)).toEqual(installedSources);

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-windows-worker-'));
    const nodePtyRoot = path.join(fixtureRoot, 'node-pty');
    const libRoot = path.join(nodePtyRoot, 'lib');
    try {
      fs.mkdirSync(libRoot, { recursive: true });
      const prebuildRoot = path.join(nodePtyRoot, 'prebuilds', 'win32-x64');
      fs.mkdirSync(prebuildRoot, { recursive: true });
      fs.writeFileSync(path.join(nodePtyRoot, 'package.json'), JSON.stringify({ version: '1.2.0-beta.14' }));
      fs.writeFileSync(path.join(prebuildRoot, 'conpty.node'), 'native');
      fs.writeFileSync(path.join(libRoot, 'windowsConoutConnection.js'), legacy);
      for (const fileName of ['windowsPtyAgent.js', 'windowsTerminal.js', 'conpty_console_list_agent.js']) {
        fs.writeFileSync(path.join(libRoot, fileName), 'unpatched');
      }
      expect(() => validateWindowsPtyRuntime({ nodePtyRoot }))
        .toThrow(/cannot resolve app\.asar\.unpacked/);
      for (const [name, fileName] of [
        ['worker', 'windowsConoutConnection.js'],
        ['agent', 'windowsPtyAgent.js'],
        ['terminal', 'windowsTerminal.js'],
        ['consoleListAgent', 'conpty_console_list_agent.js'],
      ] as const) {
        fs.writeFileSync(path.join(libRoot, fileName), installedSources[name]);
      }
      fs.writeFileSync(path.join(nodePtyRoot, 'package.json'), JSON.stringify({ version: '1.1.0' }));
      expect(() => validateWindowsPtyRuntime({ nodePtyRoot })).toThrow(/race fix #922/);
      fs.writeFileSync(path.join(nodePtyRoot, 'package.json'), JSON.stringify({ version: '1.2.0-beta.14' }));

      fs.rmSync(path.join(prebuildRoot, 'conpty.node'));
      expect(() => validateWindowsPtyRuntime({ nodePtyRoot })).toThrow(/native module/);
      fs.writeFileSync(path.join(prebuildRoot, 'conpty.node'), 'native');
      expect(() => validateWindowsPtyRuntime({ nodePtyRoot })).not.toThrow();
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    expect(packageJson.scripts.postinstall).toContain('patch-node-pty-windows-worker.mjs');
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

  it('tests a listener-safe PTY round trip and exits despite a lingering Windows worker', async () => {
    const { smokeTerminalRuntime } = await loadScript('verify-release-artifacts.mjs');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-release-smoke-'));
    const fakePtyRoot = path.join(fixtureRoot, 'app.asar.unpacked', 'node_modules', 'node-pty');
    const fakePtyModule = path.join(fixtureRoot, 'app.asar', 'node_modules', 'node-pty');
    const marker = '__JANET_PACKAGED_PTY_OK__';
    const ready = '__JANET_PACKAGED_PTY_READY__';
    fs.mkdirSync(fakePtyRoot, { recursive: true });
    fs.mkdirSync(fakePtyModule, { recursive: true });
    const fakePtySource = `
module.exports = {
  spawn(executable, args, options) {
    const requestedWindows = process.argv[4] === 'win32';
    const windows = requestedWindows;
    const expectedExecutable = windows ? process.argv[5] : process.execPath;
    if (executable !== expectedExecutable) throw new Error('Smoke platform did not select the expected child executable');
    let dataListener;
    let exitListener;
    let queuedInput;
    if (!Array.isArray(args) || args[0] !== '-e') throw new Error('Smoke child must run a Node program');
    if (!args[1].includes('process.stdin.once')) throw new Error('PTY child does not wait for input');
    if (!args[1].includes('process.stdin.pause')) throw new Error('PTY child will not exit after input');
    if (!args[1].includes(${JSON.stringify(ready)})) throw new Error('PTY child does not emit readiness');
    if (windows) setInterval(() => {}, 1000);
    const terminal = {
      onData(listener) { dataListener = listener; },
      onExit(listener) { exitListener = listener; },
      write(input) {
        if (!dataListener || !exitListener) throw new Error('PTY trigger ran before listeners attached');
        if (input.includes(${JSON.stringify(marker)})) throw new Error('PTY trigger must not echo the success marker');
        if (input !== ${JSON.stringify('\r')}) throw new Error('PTY trigger must submit the readiness handshake');
        queuedInput = input;
      },
      kill() {},
    };
    queueMicrotask(() => {
      if (!dataListener || !exitListener) throw new Error('PTY readiness ran before listeners attached');
      dataListener(${JSON.stringify(ready)});
      if (queuedInput !== ${JSON.stringify('\r')}) throw new Error('PTY input was not queued before readiness');
      dataListener(${JSON.stringify(marker)});
      exitListener({ exitCode: 0 });
    });
    return terminal;
  },
};
`;
    fs.writeFileSync(path.join(fakePtyModule, 'index.js'), fakePtySource);

    try {
      for (const platform of ['linux', 'win32']) {
        await expect(smokeTerminalRuntime({
          platform,
          executable: process.execPath,
          nodePtyRoot: fakePtyRoot,
          nodePtyModule: fakePtyModule,
        }, 10_000)).resolves.toBeUndefined();
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 15_000);

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
