import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
const root = resolve(process.argv[2]);
const run = (...args) => {
  const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, AIVANA_API_KEY: 'synthetic-fixture-key', AIVANA_API_BASE: 'http://127.0.0.1:1', PORT: '3006' } });
  assert.equal(child.status, 0, child.stderr);
};
run(join(root, 'setup.mjs'));
run('--env-file=.env', join(root, 'doctor.mjs'));
const { createChatServer } = await import(pathToFileURL(join(root, 'app.mjs')));
let calls = 0;
const server = createChatServer({ client: { generate: async () => { calls++; return { answer: 'Packaged fixture answer' }; } } });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  const response = await fetch(`${origin}/api/chat`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hello' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).answer, 'Packaged fixture answer');
  assert.equal(calls, 1);
  console.log('Extracted Chat download passed setup, dependency checks, static serving and mocked chat. No billed calls.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
