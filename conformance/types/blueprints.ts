import Aivana, { BlueprintGenerateResponse, UnsupportedAPIError } from '../../src/index.js';
const client = new Aivana({ apiKey: 'synthetic-not-a-real-key' });
const result: Promise<BlueprintGenerateResponse> = client.blueprints.generate({ id: 'bp_example', version: 3, prompt: 'hello' });
result.then(r => { const version: number = r.blueprint.version; return version; });
client.blueprints.stream({ id: 'bp_example', version: 'latest', messages: [{role: 'user', content: 'hello'}] });
// @ts-expect-error A version is mandatory.
client.blueprints.generate({ id: 'bp_example', prompt: 'hello' });
// @ts-expect-error Saved configuration cannot be overridden.
client.blueprints.generate({ id: 'bp_example', version: 3, system: 'override' });
// @ts-expect-error Numeric strings must not silently become versions.
client.blueprints.generate({ id: 'bp_example', version: '3' });
const error: Error = new UnsupportedAPIError('unsupported');
void error;
