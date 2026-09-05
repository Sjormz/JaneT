const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

if (process.argv[2] === '--notify') {
  fs.writeFileSync(process.argv[3], process.argv[4]);
} else {
  const directory = process.argv[2];
  const { helper, notify, codexHome } = JSON.parse(fs.readFileSync(path.join(directory, 'harness.json'), 'utf8'));
  let previous = '';
  setInterval(() => {
    try {
      const input = fs.readFileSync(path.join(directory, 'event.json'), 'utf8');
      if (input === previous) return;
      previous = input;
      const data = JSON.parse(input);
      cp.execFileSync(data.type ? notify[0] : process.execPath,
        data.type ? [...notify.slice(1), input] : [helper, ...(data.setup ? ['--setup-codex', '-c', 'notify=[]'] : ['--codex-hook'])],
        { input: data.type || data.setup ? '' : input, env: { ...process.env, CODEX_HOME: codexHome }, timeout: 3000, windowsHide: true });
    } catch (error) { process.stderr.write(String(error)); }
  }, 100);
}
