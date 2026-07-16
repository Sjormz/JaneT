import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_ASAR_WORKER_REWRITE,
  CONPTY_DEFERRED_CONNECT_MARKER,
  CONPTY_PID_REFRESH_MARKER,
  CONPTY_PROCESS_LIST_MARKER,
  WINDOWS_PATCH_POSTCONDITIONS,
} from './patch-node-pty-windows-worker.mjs';

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
    const nodePtyRoot = path.join(appRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
    return {
      platform: 'win32',
      executable: path.join(appRoot, 'JaneT.exe'),
      nodePtyRoot,
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

export function nativeMacRuntime(releaseRoot, hostArch = process.arch) {
  const runtime = macPackagedRuntimes(releaseRoot).find((candidate) => candidate.arch === hostArch);
  if (!runtime) throw new Error(`No packaged macOS runtime matches host architecture ${hostArch}`);
  return runtime;
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

export function validateWindowsPtyRuntime(runtime) {
  const requirements = [
    ['windowsConoutConnection.js', WINDOWS_PATCH_POSTCONDITIONS.worker, 'worker cannot resolve app.asar.unpacked'],
    ['windowsPtyAgent.js', WINDOWS_PATCH_POSTCONDITIONS.agent, 'agent is missing the deferred ConPTY connection fix'],
    ['windowsTerminal.js', WINDOWS_PATCH_POSTCONDITIONS.terminal, 'terminal does not refresh its deferred ConPTY pid'],
    ['conpty_console_list_agent.js', WINDOWS_PATCH_POSTCONDITIONS.consoleListAgent, 'process-list helper is not safe before ConPTY connects'],
  ];
  for (const [fileName, postconditions, failure] of requirements) {
    const filePath = path.join(runtime.nodePtyRoot, 'lib', fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    if (postconditions.some((postcondition) => !source.includes(postcondition))) {
      throw new Error(`Packaged node-pty Windows ${failure}: ${filePath}`);
    }
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

    const hostRuntime = nativeMacRuntime(releaseRoot);
    await smokeTerminalRuntime(hostRuntime);

    // Execute only the runner's native architecture. Rosetta startup on fresh
    // hosted ARM runners is nondeterministic and can stall before verifier
    // JavaScript starts. Both bundles still receive deterministic artifact,
    // signature, native-module, helper, and executable-permission validation.
    console.log(
      `Executed the native ${hostRuntime.arch} macOS PTY; validated the non-host bundle without translated execution.`,
    );
    return;
  }

  const runtime = packagedRuntime(platform, releaseRoot);
  if (normalizeReleasePlatform(platform) === 'windows') validateWindowsPtyRuntime(runtime);
  await smokeTerminalRuntime(runtime);
}

export async function smokeTerminalRuntime(runtime, timeoutMs = PACKAGED_RUNTIME_TIMEOUT_MS) {
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
const hostNodeExecutable = process.argv[5];
const windows = platform === 'win32';
let terminal;
let received = '';
const timeout = setTimeout(() => {
  console.error('packaged PTY timed out: ' + JSON.stringify(received));
  process.exit(2);
}, 5000);
try {
  const childProgram = 'process.stdin.once("data",()=>{process.stdin.pause();process.stdout.write(' + JSON.stringify(marker) + ')});process.stdout.write(' + JSON.stringify(ready) + ')';
  const childExecutable = windows ? hostNodeExecutable : process.execPath;
  const childArgs = ['-e', childProgram];
  terminal = pty.spawn(childExecutable, childArgs, {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TERM: 'xterm-256color',
    },
  });
} catch (error) {
  clearTimeout(timeout);
  console.error(error);
  process.exit(3);
}
terminal.onData((data) => {
  received += data;
});
terminal.onExit(({ exitCode }) => {
  setTimeout(() => {
    clearTimeout(timeout);
    if (exitCode !== 0 || !received.includes(marker)) {
      console.error('packaged PTY failed: exit=' + exitCode + ' output=' + JSON.stringify(received));
      process.exit(4);
    }
    // node-pty 1.1.0 keeps a ref'ed Conout worker after natural child exit.
    // Once the isolated smoke has proved spawn, input, output, and exit, flush
    // the result and terminate explicitly instead of hanging release CI.
    process.stdout.write(marker, () => process.exit(0));
  }, 25);
});
// Listeners are attached before input. Unix pipes can accept the trigger
// immediately; node-pty's Windows terminal queues it until READY produces the
// first output event and the ConPTY data pipe becomes writable.
terminal.write('\r');
`;

  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(runtime.executable, [
      '-e', smokeProgram, runtime.nodePtyModule, PACKAGED_PTY_MARKER, PACKAGED_PTY_READY,
      runtime.platform, process.execPath,
    ], {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // The outer ceiling catches a packaged runtime that never starts. Once
      // JavaScript starts, the inner five-second PTY timer enforces the
      // functional launch contract.
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    const candidate = error ?? {};
    const details = [
      candidate.message,
      candidate.code !== undefined && `code: ${candidate.code}`,
      candidate.signal && `signal: ${candidate.signal}`,
      candidate.killed && 'killed: true',
      `outer timeout limit: ${timeoutMs}ms`,
      candidate.stdout && `stdout: ${candidate.stdout}`,
      candidate.stderr && `stderr: ${candidate.stderr}`,
    ].filter(Boolean);
    throw new Error(details.join('\n'));
  }
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
