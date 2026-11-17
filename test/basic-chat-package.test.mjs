import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageChat, FILES } from '../tools/package-basic-chat.mjs';
test('standalone Chat release excludes credentials and preserves user setup in a path with spaces', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aivana package '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = await packageChat(join(root, 'My Chat'));
  const manifest = JSON.parse(await readFile(join(target, 'MANIFEST.json')));
  assert.deepEqual(Object.keys(manifest.sha256).sort(), [...FILES, 'LICENSE'].sort());
  assert.equal((await readdir(target)).includes('.env'), false);
  assert.equal((await readdir(target)).includes('node_modules'), false);
  const run = () => spawnSync(process.execPath, [join(target, 'setup.mjs')], { cwd: root, encoding: 'utf8' });
  if (Number(process.versions.node.split(".")[0]) < 20) { assert.equal(run().status, 1); return; }
  assert.equal(run().status, 0);
  assert.equal(await readFile(join(target, '.env'), 'utf8'), await readFile(join(target, '.env.example'), 'utf8'));
  const secret = 'AIVANA_API_KEY=synthetic_test_key';
  await writeFile(join(target, '.env'), secret);
  const again = run(); assert.equal(again.status, 0); assert.ok(!again.stdout.includes(secret));
  assert.equal(await readFile(join(target, '.env'), 'utf8'), secret);
  await assert.rejects(packageChat(target), { code: 'EEXIST' });
});
