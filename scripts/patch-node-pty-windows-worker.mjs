import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEGACY_WORKER_PATH = "var scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');";
export const APP_ASAR_WORKER_REWRITE = ".replace('app.asar', 'app.asar.unpacked')";
export const CONPTY_DEFERRED_CONNECT_MARKER = 'JaneT node-pty#885 backport: defer ConPTY connect until worker readiness.';
export const CONPTY_PID_REFRESH_MARKER = 'JaneT node-pty#885 backport: refresh pid after deferred ConPTY connect.';
export const CONPTY_PROCESS_LIST_MARKER = 'JaneT node-pty#885 backport: tolerate an unconnected or exited ConPTY.';
export const WINDOWS_PATCH_POSTCONDITIONS = {
  worker: [
    APP_ASAR_WORKER_REWRITE,
    ".replace('node_modules.asar', 'node_modules.asar.unpacked')",
  ],
  agent: [
    CONPTY_DEFERRED_CONNECT_MARKER,
    'this._pendingPtyInfo = { pty: this._pty, commandLine: commandLine, cwd: cwd, env: env };',
    'WindowsPtyAgent.prototype._completePtyConnection = function ()',
    'this._pendingPtyInfo = undefined;',
    'if (this._innerPid <= 0)',
  ],
  terminal: [
    CONPTY_PID_REFRESH_MARKER,
    '_this._pid = _this._agent.innerPid;',
  ],
  consoleListAgent: [
    CONPTY_PROCESS_LIST_MARKER,
    'if (shellPid > 0)',
    'consoleProcessList = getConsoleProcessList(shellPid);',
  ],
};

function replaceRequired(source, before, after, description) {
  if (!source.includes(before)) {
    throw new Error(`Unsupported node-pty Windows source; expected ${description} was not found.`);
  }
  return source.replace(before, after);
}

function requireMarkers(source, markers, description) {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(`Incomplete node-pty Windows ${description} patch: ${missing.join(', ')}`);
  }
}

export function patchNodePtyWindowsWorkerSource(source) {
  if (source.includes(APP_ASAR_WORKER_REWRITE)) {
    requireMarkers(source, WINDOWS_PATCH_POSTCONDITIONS.worker, 'worker');
    return source;
  }
  const patched = replaceRequired(
    source,
    LEGACY_WORKER_PATH,
    `var scriptPath = __dirname
            .replace('node_modules.asar', 'node_modules.asar.unpacked')
            ${APP_ASAR_WORKER_REWRITE};`,
    'worker path resolver',
  );
  requireMarkers(patched, WINDOWS_PATCH_POSTCONDITIONS.worker, 'worker');
  return patched;
}

export function patchNodePtyWindowsAgentSource(source) {
  if (source.includes(CONPTY_DEFERRED_CONNECT_MARKER)) {
    requireMarkers(source, WINDOWS_PATCH_POSTCONDITIONS.agent, 'agent');
    return source;
  }

  let patched = replaceRequired(
    source,
    `        this._conoutSocketWorker = new windowsConoutConnection_1.ConoutConnection(term.conout, this._useConptyDll);
        this._conoutSocketWorker.onReady(function () {
            _this._conoutSocketWorker.connectSocket(_this._outSocket);
        });`,
    `        this._conoutSocketWorker = new windowsConoutConnection_1.ConoutConnection(term.conout, this._useConptyDll);
        // ${CONPTY_DEFERRED_CONNECT_MARKER}
        var connectionTimeout;
        if (this._useConpty) {
            this._pendingPtyInfo = { pty: this._pty, commandLine: commandLine, cwd: cwd, env: env };
            connectionTimeout = setTimeout(function () {
                if (_this._pendingPtyInfo) {
                    _this._completePtyConnection();
                }
            }, 5000);
        }
        this._conoutSocketWorker.onReady(function () {
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
            }
            _this._conoutSocketWorker.connectSocket(_this._outSocket);
            if (_this._useConpty) {
                _this._completePtyConnection();
            }
        });`,
    'Conout worker readiness block',
  );

  patched = replaceRequired(
    patched,
    `        if (this._useConpty) {
            var connect = this._ptyNative.connect(this._pty, commandLine, cwd, env, this._useConptyDll, function (c) { return _this._$onProcessExit(c); });
            this._innerPid = connect.pid;
        }
    }
    Object.defineProperty(WindowsPtyAgent.prototype, "inSocket", {`,
    `    }
    WindowsPtyAgent.prototype._completePtyConnection = function () {
        var _this = this;
        if (!this._pendingPtyInfo) {
            return;
        }
        var pending = this._pendingPtyInfo;
        this._pendingPtyInfo = undefined;
        var connect = this._ptyNative.connect(pending.pty, pending.commandLine, pending.cwd, pending.env, this._useConptyDll, function (c) { return _this._$onProcessExit(c); });
        this._innerPid = connect.pid;
    };
    Object.defineProperty(WindowsPtyAgent.prototype, "inSocket", {`,
    'synchronous ConPTY connect block',
  );

  patched = replaceRequired(
    patched,
    `    WindowsPtyAgent.prototype.kill = function () {
        var _this = this;`,
    `    WindowsPtyAgent.prototype.kill = function () {
        var _this = this;
        this._pendingPtyInfo = undefined;`,
    'kill method',
  );

  patched = replaceRequired(
    patched,
    `    WindowsPtyAgent.prototype._getConsoleProcessList = function () {
        var _this = this;
        return new Promise(function (resolve) {`,
    `    WindowsPtyAgent.prototype._getConsoleProcessList = function () {
        var _this = this;
        if (this._innerPid <= 0) {
            return Promise.resolve([]);
        }
        return new Promise(function (resolve) {`,
    'console process-list guard',
  );

  requireMarkers(patched, WINDOWS_PATCH_POSTCONDITIONS.agent, 'agent');
  return patched;
}

export function patchNodePtyWindowsTerminalSource(source) {
  if (source.includes(CONPTY_PID_REFRESH_MARKER)) {
    requireMarkers(source, WINDOWS_PATCH_POSTCONDITIONS.terminal, 'terminal');
    return source;
  }
  const patched = replaceRequired(
    source,
    `        _this._socket.on('ready_datapipe', function () {
            // Run deferreds and set ready state once the first data event is received.`,
    `        _this._socket.on('ready_datapipe', function () {
            // ${CONPTY_PID_REFRESH_MARKER}
            _this._pid = _this._agent.innerPid;
            // Run deferreds and set ready state once the first data event is received.`,
    'ready_datapipe handler',
  );
  requireMarkers(patched, WINDOWS_PATCH_POSTCONDITIONS.terminal, 'terminal');
  return patched;
}

export function patchNodePtyConsoleListAgentSource(source) {
  if (source.includes(CONPTY_PROCESS_LIST_MARKER)) {
    requireMarkers(source, WINDOWS_PATCH_POSTCONDITIONS.consoleListAgent, 'console-list agent');
    return source;
  }
  const patched = replaceRequired(
    source,
    `var shellPid = parseInt(process.argv[2], 10);
var consoleProcessList = getConsoleProcessList(shellPid);`,
    `var shellPid = parseInt(process.argv[2], 10);
// ${CONPTY_PROCESS_LIST_MARKER}
var consoleProcessList = [];
if (shellPid > 0) {
    try {
        consoleProcessList = getConsoleProcessList(shellPid);
    }
    catch (_a) {
        consoleProcessList = [];
    }
}`,
    'console process-list agent call',
  );
  requireMarkers(patched, WINDOWS_PATCH_POSTCONDITIONS.consoleListAgent, 'console-list agent');
  return patched;
}

export function patchNodePtyWindowsSources(sources) {
  return {
    worker: patchNodePtyWindowsWorkerSource(sources.worker),
    agent: patchNodePtyWindowsAgentSource(sources.agent),
    terminal: patchNodePtyWindowsTerminalSource(sources.terminal),
    consoleListAgent: patchNodePtyConsoleListAgentSource(sources.consoleListAgent),
  };
}

export function patchNodePtyWindowsWorker(projectRoot) {
  const libRoot = path.join(projectRoot, 'node_modules', 'node-pty', 'lib');
  const targets = {
    worker: path.join(libRoot, 'windowsConoutConnection.js'),
    agent: path.join(libRoot, 'windowsPtyAgent.js'),
    terminal: path.join(libRoot, 'windowsTerminal.js'),
    consoleListAgent: path.join(libRoot, 'conpty_console_list_agent.js'),
  };
  const sources = Object.fromEntries(
    Object.entries(targets).map(([name, target]) => [name, fs.readFileSync(target, 'utf8')]),
  );
  const patched = patchNodePtyWindowsSources(sources);
  for (const [name, target] of Object.entries(targets)) {
    if (patched[name] !== sources[name]) fs.writeFileSync(target, patched[name]);
  }
  return targets.worker;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  patchNodePtyWindowsWorker(path.resolve(path.dirname(scriptPath), '..'));
}
