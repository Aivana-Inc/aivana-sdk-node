import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileBlueprint, loadBlueprint, BlueprintError } from '../examples/basic-chat/blueprint.mjs';

const definition = (configuration = {}, history = 'session') => ({ purpose: 'Help users',
  configuration: { system: 'Be clear', effort: 'auto', web_search: false, temperature: 0.7,
    top_p: null, max_tokens: 2048, stop_sequences: [], response_format: { type: 'text' }, ...configuration },
  conversation: { history } });

test('blueprint: unsupported features and malformed settings are refused without coercion', () => {
  const invalid = [
    null, [], {}, { ...definition(), id: 'bp_1' }, { ...definition(), knowledge: { source_set_id: 'source', requirement: 'required' } },
    { ...definition(), purpose: ' ' }, { ...definition(), purpose: 'x'.repeat(1001) },
    definition({ system: 'x'.repeat(8001) }), definition({ system: null }), definition({ effort: 'HIGH' }),
    definition({ web_search: 'false' }), definition({ temperature: -1 }), definition({ temperature: 2.1 }),
    definition({ top_p: 1.1, temperature: null }), definition({ temperature: 0, top_p: 0 }),
    definition({ temperature: NaN }), definition({ temperature: Infinity }), definition({ temperature: '0' }),
    definition({ max_tokens: 0 }), definition({ max_tokens: 1.5 }), definition({ max_tokens: 32001 }),
    definition({ stop_sequences: [''] }), definition({ stop_sequences: [false] }), definition({ stop_sequences: Array(5).fill('END') }),
    definition({ response_format: { type: 'json_schema', schema: { type: 'object' } } }),
    definition({ response_format: { type: 'text', schema: {} } }), definition({ response_format: { type: 'text', extra: true } }),
    definition({ output_shape: 'json' }), definition({}, 'forever'),
    { ...definition(), conversation: { history: 'none', maxTurns: 5 } },
    definition({ stop_sequences: ['漢'.repeat(23000)] }),
  ];
  for (const value of invalid) assert.throws(() => compileBlueprint(value), BlueprintError);
  const missing = definition(); delete missing.configuration.top_p;
  assert.throws(() => compileBlueprint(missing), /Required fields/);
  assert.doesNotThrow(() => compileBlueprint({ ...definition({ response_format: { type: 'text', schema: null } }), knowledge: null }));
});

test('blueprint: compiled options are independent of later file-object changes', () => {
  const original = definition({ stop_sequences: ['END'] });
  const compiled = compileBlueprint(original);
  original.configuration.system = 'Later'; original.configuration.stop_sequences.push('STOP');
  assert.equal(compiled.options.system, 'Be clear');
  assert.deepEqual(compiled.options.stopSequences, ['END']);
  assert.throws(() => { compiled.options.stopSequences.push('STOP'); }, TypeError);
  assert.throws(() => { compiled.options.system = 'Changed'; }, TypeError);
});

test('blueprint: conventional filename is optional; explicit paths and invalid files never fall back', t => {
  const directory = mkdtempSync(join(tmpdir(), 'blueprint with spaces '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(loadBlueprint({}, directory), null);
  assert.throws(() => loadBlueprint({ AIVANA_BLUEPRINT_FILE: 'missing.json' }, directory), /Cannot open/);
  const path = join(directory, 'blueprint-definition.json');
  writeFileSync(path, JSON.stringify(definition()));
  assert.deepEqual(loadBlueprint({}, directory), definition());
  assert.deepEqual(loadBlueprint({ AIVANA_BLUEPRINT_FILE: path }, '/unrelated'), definition());
  writeFileSync(path, '\ufeff' + JSON.stringify(definition()));
  assert.deepEqual(loadBlueprint({}, directory), definition());
  for (const contents of ['{"private_secret":', Buffer.from([0xff, 0xfe]), ' '.repeat(256 * 1024 + 1)]) {
    writeFileSync(path, contents);
    assert.throws(() => loadBlueprint({}, directory), (error) => error instanceof BlueprintError && !error.message.includes('private_secret'));
  }
  mkdirSync(join(directory, 'folder'));
  assert.throws(() => loadBlueprint({ AIVANA_BLUEPRINT_FILE: 'folder' }, directory), BlueprintError);
});
