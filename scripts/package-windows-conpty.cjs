const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');

module.exports = function packageWindowsConpty({ appOutDir, electronPlatformName, arch }) {
  if (electronPlatformName !== 'win32') return;
  const root = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  const payload = path.join(root, 'prebuilds', 'win32-' + Arch[arch], 'conpty');
  // electron-rebuild creates the native module but does not copy its adjacent DLL payload.
  // node-pty prefers build/Release or build/Debug over the shipped prebuild.
  for (const mode of ['Release', 'Debug']) {
    const nativeRoot = path.join(root, 'build', mode);
    if (!fs.existsSync(path.join(nativeRoot, 'conpty.node'))) continue;
    fs.mkdirSync(path.join(nativeRoot, 'conpty'), { recursive: true });
    for (const file of ['conpty.dll', 'OpenConsole.exe']) {
      fs.copyFileSync(path.join(payload, file), path.join(nativeRoot, 'conpty', file));
    }
  }
};
