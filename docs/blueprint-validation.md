# Blueprint SDK validation

Sections are dated and kept as the record of what was true then; the newest result is at the bottom.
The first sections describe November 11, when no API had the routes, and are superseded by the later ones.

## November 11, 2026

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

## Completion gate (pending on November 11; see the later sections)

Person 1/API owner must deploy the candidate routes and provide an authorized saved
synthetic Blueprint/version. Then run the examples against that candidate and record
success, resolved version, authorization/isolation and API billing acceptance evidence.
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

## Run against the development API, November 24, 2026

Environment: the development API at `https://dev-developers.aivana.ai`, after the API change that adds
the routes (aivana-intelligence-api#400) was deployed there by its normal pipeline that day. The deployed
revision identifier was not recorded. A scoped, spend-limited development key from a synthetic workspace
was used and never printed. Only requests for a deliberately nonexistent Blueprint id were sent, so
nothing was generated or charged. The SDK was run from the head of the pull request that added it.

Passing, from this SDK against the deployed API:

- Pinned version 1, `latest`, and the streaming route each answered `blueprint_not_found`: the routes
  are deployed and Blueprint storage is configured. None was reported as `UnsupportedAPIError`.
  Request ids: `req_f3434b605bb334306216cca4`, `req_1ea7949c48e248d45429f955`, `req_5026e7f0d0445b4fbcddbfd5`.
- Version `0`, `"Latest"` and a saved-settings override are refused client-side with nothing sent.

Direct probes of the same routes returned `422` for a malformed version, with the API's own wording.

**Not verified as of this record:** a successful pinned or `latest` run, normal or streaming, against a
saved Blueprint on a deployed environment; workspace isolation, member permissions and billing on a
deployed environment; the routes on production; a real model's answer; the rolling-deploy 404 on a real
deploy. Update this section with the date and request ids when any of these is run.
