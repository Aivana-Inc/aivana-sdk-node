# Saved Blueprint invocation — unreleased candidate

Implements the SDK portion of [API #367](https://github.com/Aivana-Inc/aivana-intelligence-api/issues/367)
and [Iteration 6 SDK integration](https://trello.com/c/0Rb6idgP).
These methods are candidate code, not an available published release. Do not publish or
enable them until the API routes are deployed and verified in production and SDK maintainers approve release.

Create and save the Blueprint in AI Studio. Invocation uses only its ID, an explicit
version and runtime input; management from scoped API keys belongs to API #366.

## Contract

- Normal: `POST /v1/blueprints/{id}/versions/{version}/generate`.
- Stream: the same path with `generate:stream`.
- Version is a positive safe integer, or the literal `latest` explicitly. Nothing defaults to latest.
- Runtime fields: prompt, messages, attachments, metadata, previous intent, pending action,
  continuation, assistant name and Intelligence Trace. Unknown options and saved generation
  settings are rejected locally, including settings explicitly passed as null.
- No retries and no fallback to `/v1/generate`, even for an unsupported route.
- A router 404 raises `UnsupportedAPIError`, code `blueprint_invocation_unsupported`.
  A resource 404 keeps code `blueprint_not_found` and does not disclose workspace ownership.
- A normal response exposes `result.blueprint.id` and numeric `result.blueprint.version`.
  Streams expose these in `done.data.blueprint`; a missing, mismatched or nonnumeric
  reference is an error, including for latest. Such errors do not mean the run was free;
  do not automatically repeat the request.
- HTTP errors preserve SDK error classes and validation details. Mid-stream error events
  raise, and a stream ending without done is reported as incomplete. Stop/cancel releases
  the response; no saved settings or conversation state are fetched or inferred client-side.

## Candidate examples

From this source checkout, configure the approved environment and a saved Blueprint:
`AIVANA_API_KEY`, `AIVANA_API_BASE`, `AIVANA_BLUEPRINT_ID`, `AIVANA_BLUEPRINT_VERSION`.
Do not put keys in source files or logs. Each example run can consume normal generation credit.

```sh
node examples/blueprints/invoke.mjs
node examples/blueprints/invoke.mjs --stream
```

```js
const result = await client.blueprints.generate({ id: 'bp_example', version: 3, prompt: 'Draft a reply.' });
console.log(result.blueprint); // the configuration that actually ran
for await (const chunk of client.blueprints.stream({ id: 'bp_example', version: 3, prompt: 'Draft a reply.' })) {
  if (chunk.event === 'delta') process.stdout.write(chunk.data.text);
  if (chunk.event === 'done') console.log(chunk.data.blueprint);
}
```

Pass an AbortSignal as `signal` to either method; streaming keeps cancellation and
the configured timeout active until the body finishes. Breaking the loop cancels it.
The example intentionally requires an API base instead of guessing the test environment.

## Repeatable checks and release gate

```sh
npm ci
npm ci --prefix examples/basic-chat
npm test
npm run test:types
npm pack --dry-run
```

`conformance/blueprints.json` is synthetic and byte-identical in both SDK repositories.
Tests capture the request path, auth, runtime body, errors, done reference and stream
completion; they do not prove server authorization, persistence, billing or deployment.

Before release, Person 1/API owner must supply a deployed candidate, a synthetic workspace,
a saved Blueprint and its version, and authorized test configuration. Run both examples
normally and streaming with a pinned version and explicit latest. Record the resolved
reference, request IDs, outcomes and date; verify missing/foreign versions, invalid
credentials, insufficient scope and unsupported routes without generation fallback.
Confirm the API's isolation and billing gates, then get SDK-maintainer review and production
API verification. Only afterwards update AI Studio Docs (cURL, Python, Node.js), bump the
SDK/CLI version together following RELEASING.md, and publish. This change does not publish.
