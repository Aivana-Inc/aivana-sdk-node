import { readConfiguration } from './config.mjs';
import { BlueprintError, loadBlueprint } from './blueprint.mjs';
try {
  await import('@aivana/sdk');
  await import('./app.mjs');
  const { port } = readConfiguration();
  const blueprint = loadBlueprint();
  console.log(blueprint ? 'Blueprint definition is valid and supported. Loaded locally; no saved-agent service is used.' : 'Using default chat settings. No blueprint definition file was found.');
  console.log(`Local configuration and dependencies are ready. Start with npm start, then open http://127.0.0.1:${port}.`);
  console.log('No API request was made. Key validity, account credit and port availability are checked when used.');
  console.log('After npm start, send a test message, check live streaming, and ask a follow-up. These requests use account credit.');
} catch (error) {
  console.error(error instanceof BlueprintError ? error.message : 'Not ready. Run npm ci and check AIVANA_API_KEY, AIVANA_API_BASE and PORT in your local .env.');
  process.exitCode = 1;
}
