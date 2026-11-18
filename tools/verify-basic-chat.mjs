import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, unlink } from 'node:fs/promises';
const root = resolve(process.argv[2]);
const run = (expected, ...args) => {
  const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, AIVANA_API_KEY: 'synthetic-fixture-key', AIVANA_API_BASE: 'http://127.0.0.1:1', PORT: '3006', AIVANA_BLUEPRINT_FILE: '' } });
  assert.equal(child.status, expected, child.stderr);
  return child;
};
run(0, join(root, 'setup.mjs'));
run(0, '--env-file=.env', join(root, 'doctor.mjs'));
const { createChatServer } = await import(pathToFileURL(join(root, 'app.mjs')));
const { loadBlueprint } = await import(pathToFileURL(join(root, 'blueprint.mjs')));
const { default: Aivana } = await import(pathToFileURL(join(root, 'node_modules/@aivana/sdk/src/index.js')));
const sample = JSON.parse(await readFile(join(root, 'blueprints/landscaping.example.json'), 'utf8'));
const definitionPath = join(root, 'blueprint-definition.json');
try {
  for (const historyMode of [null, 'session', 'none']) {
    if (historyMode) {
      sample.conversation.history = historyMode;
      await writeFile(definitionPath, JSON.stringify(sample));
      run(0, '--env-file=.env', join(root, 'doctor.mjs'));
    }
    const wire = [];
    const client = new Aivana({ apiKey: 'synthetic-key', fetch: async (_url, init) => {
      wire.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ answer: 'Packaged fixture answer', intent: { name: 'fixture' }, pending_action: 'next' }));
    } });
    const server = createChatServer({ client, blueprint: loadBlueprint({}, root) });
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(origin)).status, 200);
      for (const path of ['/.env', '/blueprint-definition.json', '/blueprint.mjs']) assert.equal((await fetch(`${origin}${path}`)).status, 404);
      assert.deepEqual(await (await fetch(`${origin}/api/config`)).json(), { blueprintLoaded: !!historyMode, history: historyMode || 'session', webSearch: false });
      const response = await fetch(`${origin}/api/chat`, { method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hello',
          history: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Answer' }], context: { pendingAction: 'earlier' } }) });
      assert.equal(response.status, 200); const answer = await response.json();
      assert.equal(answer.answer, 'Packaged fixture answer'); assert.equal(wire.length, 1);
      assert.equal(wire[0].system, historyMode ? sample.configuration.system : undefined);
      assert.equal(wire[0].messages.length, historyMode === 'none' ? 1 : 3);
      assert.equal(wire[0].pending_action, historyMode === 'none' ? undefined : 'earlier');
      if (historyMode === 'none') assert.deepEqual(answer.context, {});
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  sample.knowledge = { source_set_id: 'unavailable', requirement: 'required' };
  await writeFile(definitionPath, JSON.stringify(sample));
  assert.match(run(1, '--env-file=.env', join(root, 'doctor.mjs')).stderr, /Sources/);
  assert.match(run(1, '--env-file=.env', join(root, 'server.mjs')).stderr, /Sources/);
  console.log('Extracted Chat passed setup, default/blueprint chat, history policy, real SDK mapping, and unsupported-file startup refusal. No billed calls.');
} finally { await unlink(definitionPath).catch(() => {}); }
