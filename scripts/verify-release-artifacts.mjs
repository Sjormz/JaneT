import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const PACKAGED_PTY_MARKER = '__JANET_PACKAGED_PTY_OK__';
const PACKAGED_PTY_READY = '__JANET_PACKAGED_PTY_READY__';
export const PACKAGED_RUNTIME_TIMEOUT_MS = 60_000;

export function normalizeReleasePlatform(value) {
  if (value === 'windows' || value === 'win32' || value === 'win') return 'windows';
  if (value === 'darwin' || value === 'macos' || value === 'mac') return 'macos';
  if (value === 'linux') return 'linux';
  throw new Error(`Unsupported release platform: ${value}`);
}

export function expectedReleaseArtifacts(platformValue, version) {
  const platform = normalizeReleasePlatform(platformValue);
  if (platform === 'windows') {
    return [
      `JaneT-Setup-${version}-win-x64.exe`,
      `JaneT-Setup-${version}-win-x64.exe.blockmap`,
      `JaneT-Portable-${version}-win-x64.exe`,
      'latest.yml',
    ];
  }
  if (platform === 'macos') {
    return [
      `JaneT-${version}-mac-x64.dmg`,
      `JaneT-${version}-mac-x64.zip`,
      `JaneT-${version}-mac-x64.zip.blockmap`,
      `JaneT-${version}-mac-arm64.dmg`,
      `JaneT-${version}-mac-arm64.zip`,
      `JaneT-${version}-mac-arm64.zip.blockmap`,
      'latest-mac.yml',
    ];
  }
  return [
    `JaneT-${version}-linux-x64.AppImage`,
    `JaneT-${version}-linux-x64.deb`,
    'latest-linux.yml',
  ];
}

export function packagedRuntime(platformValue, releaseRoot, hostArch = process.arch) {
  const platform = normalizeReleasePlatform(platformValue);
  if (platform === 'windows') {
    const appRoot = path.join(releaseRoot, 'win-unpacked');
    return {
      platform: 'win32',
      executable: path.join(appRoot, 'JaneT.exe'),
      nodePtyRoot: path.join(appRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
      nodePtyModule: path.join(appRoot, 'resources', 'app.asar', 'node_modules', 'node-pty'),
    };
  }
  if (platform === 'macos') {
    return macPackagedRuntimes(releaseRoot).find((runtime) => runtime.arch === hostArch)
      ?? macPackagedRuntimes(releaseRoot)[0];
  }
  const appRoot = path.join(releaseRoot, 'linux-unpacked');
  return {
    platform: 'linux',
    executable: path.join(appRoot, 'janet'),
    nodePtyRoot: path.join(appRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
    nodePtyModule: path.join(appRoot, 'resources', 'app.asar', 'node_modules', 'node-pty'),
  };
}

export function macPackagedRuntimes(releaseRoot) {
  return [
    { arch: 'x64', outputDir: 'mac' },
    { arch: 'arm64', outputDir: 'mac-arm64' },
  ].map(({ arch, outputDir }) => {
    const appRoot = path.join(releaseRoot, outputDir, 'JaneT.app', 'Contents');
    return {
      platform: 'darwin',
      arch,
      executable: path.join(appRoot, 'MacOS', 'JaneT'),
      nodePtyRoot: path.join(appRoot, 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
      nodePtyModule: path.join(appRoot, 'Resources', 'app.asar', 'node_modules', 'node-pty'),
    };
  });
}

function requireNonEmptyFile(filePath, description) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`Missing ${description}: ${filePath}`);
  }
  if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid ${description}: ${filePath}`);
  return stat;
}

export function validateMacPtyLayout(runtime) {
  const executable = requireNonEmptyFile(runtime.executable, `${runtime.arch} packaged executable`);
  if ((executable.mode & 0o111) === 0) {
    throw new Error(`Packaged executable is not executable: ${runtime.executable}`);
  }

  const prebuildRoot = path.join(runtime.nodePtyRoot, 'prebuilds', `darwin-${runtime.arch}`);
  requireNonEmptyFile(path.join(prebuildRoot, 'pty.node'), `${runtime.arch} node-pty native module`);
  const helperPath = path.join(prebuildRoot, 'spawn-helper');
  const helper = requireNonEmptyFile(helperPath, `${runtime.arch} node-pty spawn helper`);
  if ((helper.mode & 0o111) === 0) {
    throw new Error(`Packaged node-pty helper is not executable: ${helperPath}`);
  }
}

export function findMissingArtifacts(platform, version, releaseRoot) {
  return expectedReleaseArtifacts(platform, version).filter((name) => {
    const filePath = path.join(releaseRoot, name);
    try {
      return !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0;
    } catch {
      return true;
    }
  });
}

export async function verifyMacApplications(releaseRoot) {
  const appPaths = [
    path.join(releaseRoot, 'mac', 'JaneT.app'),
    path.join(releaseRoot, 'mac-arm64', 'JaneT.app'),
  ];

  for (const appPath of appPaths) {
    if (!fs.existsSync(appPath)) throw new Error(`Missing packaged macOS application: ${appPath}`);
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', appPath]);
    const { stdout, stderr } = await execFileAsync('codesign', ['-dvv', appPath]);
    validateAdHocMacSignature(`${stdout}\n${stderr}`, appPath);
  }
}

export function validateAdHocMacSignature(details, appPath = 'macOS application') {
  if (!/^Signature=adhoc$/m.test(details)) {
    throw new Error(`macOS app is not ad-hoc signed: ${appPath}`);
  }
  if (/^Authority=/m.test(details)) {
    throw new Error(`Ad-hoc macOS app unexpectedly has a certificate authority: ${appPath}`);
  }
  if (!/^TeamIdentifier=not set$/m.test(details)) {
    throw new Error(`Ad-hoc macOS app unexpectedly has a team identifier: ${appPath}`);
  }
}

export async function smokePackagedTerminal(platform, releaseRoot) {
  if (normalizeReleasePlatform(platform) === 'macos') {
    const runtimes = macPackagedRuntimes(releaseRoot);
    for (const runtime of runtimes) validateMacPtyLayout(runtime);

    const hostRuntime = runtimes.find((runtime) => runtime.arch === process.arch);
    if (!hostRuntime) throw new Error(`No packaged macOS runtime matches host architecture ${process.arch}`);
    await smokeTerminalRuntime(hostRuntime);

    // Apple Silicon runners may also have Rosetta and can exercise the x64
    // bundle. Intel runners cannot execute arm64 code, so layout validation is
    // the strongest deterministic check available for that non-host bundle.
    if (process.arch === 'arm64') {
      const x64Runtime = runtimes.find((runtime) => runtime.arch === 'x64');
      if (x64Runtime) {
        try {
          await smokeTerminalRuntime(x64Runtime);
        } catch (error) {
          if (!isUnavailableCrossArchRuntime(error)) throw error;
          console.log('Rosetta is unavailable; validated the x64 node-pty layout without executing it.');
        }
      }
    }
    return;
  }

  const runtime = packagedRuntime(platform, releaseRoot);
  await smokeTerminalRuntime(runtime);
}

function isUnavailableCrossArchRuntime(error) {
  const candidate = error ?? {};
  const details = [candidate.message, candidate.code, candidate.errno, candidate.stderr]
    .filter(Boolean)
    .join(' ');
  return /bad cpu type|unsupported architecture|unknown system error -86|\b-86\b|EBADARCH|ENOEXEC/i.test(details);
}

export async function smokeTerminalRuntime(runtime) {
  for (const [label, target] of [
    ['executable', runtime.executable],
    ['nodePtyRoot', runtime.nodePtyRoot],
  ]) {
    if (!fs.existsSync(target)) throw new Error(`Missing packaged ${label}: ${target}`);
  }

  const smokeProgram = String.raw`
const pty = require(process.argv[1]);
const marker = process.argv[2];
const ready = process.argv[3];
const platform = process.argv[4];
const windows = platform === 'win32';
let terminal;
let received = '';
let exitRequested = false;
const timeout = setTimeout(() => {
  try { terminal && terminal.kill(); } catch {}
  console.error('packaged PTY timed out: ' + JSON.stringify(received));
  process.exit(2);
}, 5000);
try {
  const childProgram = 'process.stdin.once("data",()=>{process.stdin.pause();process.stdout.write(' + JSON.stringify(marker) + ')});process.stdout.write(' + JSON.stringify(ready) + ')';
  const childExecutable = windows ? (process.env.ComSpec || 'cmd.exe') : process.execPath;
  const childArgs = windows ? ['/d', '/q'] : ['-e', childProgram];
  terminal = pty.spawn(childExecutable, childArgs, {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TERM: 'xterm-256color',
      JANET_PACKAGED_PTY_MARKER: marker,
    },
  });
} catch (error) {
  clearTimeout(timeout);
  console.error(error);
  process.exit(3);
}
terminal.onData((data) => {
  received += data;
  if (windows && !exitRequested && received.includes(marker)) {
    exitRequested = true;
    terminal.write('exit\r');
  }
});
terminal.onExit(({ exitCode }) => {
  setTimeout(() => {
    clearTimeout(timeout);
    if (exitCode !== 0 || !received.includes(marker)) {
      console.error('packaged PTY failed: exit=' + exitCode + ' output=' + JSON.stringify(received));
      process.exit(4);
    }
    process.stdout.write(marker);
  }, 25);
});
// Electron is a GUI-subsystem executable on Windows, so use the real console
// shell as the ConPTY child. The literal marker is never written as input: cmd
// expands it from the environment, and stays alive until output is observed.
terminal.write(windows ? 'echo %JANET_PACKAGED_PTY_MARKER%\r' : '\r');
`;

  const { stdout, stderr } = await execFileAsync(runtime.executable, [
    '-e', smokeProgram, runtime.nodePtyModule, PACKAGED_PTY_MARKER, PACKAGED_PTY_READY, runtime.platform,
  ], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    // A cold Rosetta translation of the x64 Electron executable can exceed 15
    // seconds. Once JavaScript starts, the inner five-second PTY timer still
    // enforces the functional launch contract.
    timeout: PACKAGED_RUNTIME_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  if (!stdout.includes(PACKAGED_PTY_MARKER)) {
    throw new Error(`Packaged terminal smoke returned no marker. stderr: ${stderr}`);
  }
}

export async function verifyReleaseArtifacts(platformValue, releaseRoot = path.join(projectRoot, 'release')) {
  const platform = normalizeReleasePlatform(platformValue);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const missing = findMissingArtifacts(platform, packageJson.version, releaseRoot);
  if (missing.length > 0) {
    throw new Error(`Missing or empty release artifacts for ${platform}: ${missing.join(', ')}`);
  }
  if (platform === 'macos') await verifyMacApplications(releaseRoot);
  await smokePackagedTerminal(platform, releaseRoot);
  console.log(`Verified ${platform} release artifacts and packaged PTY runtime.`);
}

async function main() {
  const platform = process.argv[2];
  if (!platform) throw new Error('Usage: node scripts/verify-release-artifacts.mjs <windows|macos|linux> [release-dir]');
  const releaseRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(projectRoot, 'release');
  await verifyReleaseArtifacts(platform, releaseRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[release-verify] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
