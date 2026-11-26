// Candidate source checkout only. Do not publish/enable before API rollout verification.
import Aivana from '../../src/index.js';

const { AIVANA_API_KEY, AIVANA_API_BASE, AIVANA_BLUEPRINT_ID, AIVANA_BLUEPRINT_VERSION } = process.env;
if (!AIVANA_API_KEY || !AIVANA_API_BASE || !AIVANA_BLUEPRINT_ID || !AIVANA_BLUEPRINT_VERSION) {
  throw new Error('Set AIVANA_API_KEY, AIVANA_API_BASE, AIVANA_BLUEPRINT_ID and AIVANA_BLUEPRINT_VERSION.');
}
const version = AIVANA_BLUEPRINT_VERSION === 'latest' ? 'latest'
  : /^[1-9][0-9]*$/.test(AIVANA_BLUEPRINT_VERSION) ? Number(AIVANA_BLUEPRINT_VERSION) : NaN;
const client = new Aivana({ apiKey: AIVANA_API_KEY, apiBase: AIVANA_API_BASE });
const input = { id: AIVANA_BLUEPRINT_ID, version, prompt: 'Explain DNS resolution in three short bullets.', intelligenceTrace: true };

try {
  if (process.argv.includes('--stream')) {
    for await (const chunk of client.blueprints.stream(input)) {
      if (chunk.event === 'delta') process.stdout.write(chunk.data.text ?? '');
      if (chunk.event === 'done') console.log('\nResolved Blueprint:', chunk.data.blueprint);
    }
  } else {
    const result = await client.blueprints.generate(input);
    console.log(result.answer);
    console.log('Resolved Blueprint:', result.blueprint);
  }
} catch (error) {
  console.error(`Blueprint request failed (${error.code ?? error.name}). No automatic retry or Generate fallback was made.`);
  process.exitCode = 1;
}
