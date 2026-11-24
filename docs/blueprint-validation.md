# Blueprint SDK validation — November 11, 2026

Scope: [Iteration 6 SDK card](https://trello.com/c/0Rb6idgP), SDK portion of API #367.
Windows, Node.js 22.14.0. Both SDK repositories were freshly cloned and then
`git pull --ff-only origin main` reported up to date before implementation.

## Delivered and checked

- Dedicated normal and streaming invocation, explicit version/latest, runtime-only bodies.
- Resolved Blueprint reference checks, unsupported-route versus missing-resource errors.
- No automatic generation retry, no Generate fallback and no settings override.
- Stream error/truncation detection, cancellation after headers and CRLF/UTF-8 framing.
- TypeScript declarations and a compiler check in CI.
- Candidate examples and a byte-identical synthetic contract fixture in both SDKs.
- All **71 Blueprint tests** pass, including four real loopback-HTTP example executions
  (normal/streaming, pinned/latest). Both SDKs' examples total eight such executions.
- TypeScript check, dry-run pack, actual tarball installation and export import pass.
- Full Node suite before the four example tests were added: 245 passed, one failed.
  The failure is **Ctrl-C mid-answer exits 130**, reproduced separately on unchanged
  main `d5def45`; it is the existing Windows test issue [#27](https://github.com/Aivana-Inc/aivana-sdk-node/issues/27).
  The four subsequently added example tests also pass. GitHub Linux CI is a separate check.

## Live endpoint result

The API documentation names `https://dev-developers.aivana.ai` as dev (API README,
CLAUDE.md hostname guidance and `script/test_live_e2e.sh`). The existing approved
development test configuration was used, with no secret values printed or committed.

Both normal and streaming calls to a fresh, deliberately nonexistent Blueprint ID
returned HTTP **404**, mapped to **blueprint_invocation_unsupported**, on November 11.
No fallback request was sent. This checks unavailable-route handling; it does not
demonstrate a successful Blueprint execution or independently audit server billing.

## Completion gate still pending

Person 1/API owner must deploy the candidate routes and provide an authorized saved
synthetic Blueprint/version. Then run the examples against that candidate and record
success, resolved version, authorization/isolation and API billing acceptance evidence.
The Trello card remains incomplete until its live candidate acceptance requirement is met.
SDK-maintainer approval and production API verification remain required before public
release. No package, production deployment or release was published by this work.

See [integration and repeat instructions](blueprint-invocation.md).

## Run against the merged API, November 24, 2026

The API half (aivana-intelligence-api#400, merged) now exists, so this SDK was driven against it
for the first time. Not a deployed environment: the real API application ran on loopback under
uvicorn with its real middleware, routes, admission, billing and Blueprint store, a governed
organization and a real API key; only the model engine's answer was faked, as in the API's own
`script/test_blueprint_invocation.py`. The real SDK (Node 22) made the calls over actual HTTP.

Checked and passing:

- A pinned version returns the resolved `blueprint` reference.
- `latest` names the version that ran.
- Streaming: the `done` frame carries the resolved Blueprint.
- A missing Blueprint (unknown id, missing version) is `blueprint_not_found`, never reported as
  "unsupported by this API".
- A settings override, version `0` and `"Latest"` are refused client-side.
- No key is a 401.
- An API without the routes (the router's own 404, as an older task in a rolling deploy
  answers) raises `UnsupportedAPIError` (`blueprint_invocation_unsupported`) and nothing else is
  sent: no fallback to ordinary Generate.

The full suite after merging current main (0.8.1: automatic rate-limit retries, which Blueprint
calls deliberately bypass): 404 passed, 3 skipped, 0 failed; the TypeScript declaration check passes.

Still not proved: a run against a DEPLOYED environment, a real model's answer, and the
rolling-deploy 404 on a real deploy. Those remain release gates, with SDK-maintainer review.
