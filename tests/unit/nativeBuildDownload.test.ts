// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

it('keeps the native-build HTTP client alive when a peer ends a backpressured response', () => {
  const result = spawnSync(process.execPath, ['-e', String.raw`
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const { createRequire } = require('node:module');
    const fromGyp = createRequire(require.resolve('node-gyp'));
    const { Agent, fetch } = fromGyp('undici');
    const payload = Buffer.alloc(64 * 1024, 97);
    const agent = new Agent();
    let sendBody;
    const server = net.createServer(socket => {
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: ' + payload.length + '\r\nConnection: close\r\n\r\n');
        sendBody = () => socket.end(payload);
      });
    });
    (async () => {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port, { dispatcher: agent });
        sendBody();
        // Deliberately leave the body unread while FIN arrives: undici#5360.
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
        console.log('complete download after backpressure');
      } finally {
        await agent.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 8000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('complete download after backpressure');
});
