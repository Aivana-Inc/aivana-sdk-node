# Production smoke test

`smoke.mjs` answers one question before a release goes out: **does the SDK, installed the way a developer installs it,
work against the real Aivana API?** It is a few minutes of the things a new developer does first.

| # | Check | Cost |
|---|---|---|
| 1 | The installed SDK is the version being released | free |
| 2 | A made-up key is refused with `AuthError` (401) | free |
| 3 | The real key is accepted (`quotas()` answers) | free |
| 4 | A bad request comes back as a typed `InvalidRequestError` with a request id | free (refused before any work) |
| 5 | One tiny generation | billed, call 1 of 3 |
| 6 | One tiny streamed generation | billed, call 2 of 3 |
| 7 | One request cancelled with an `AbortSignal` | may be billed, call 3 of 3 |

It checks the **shape** of answers (not empty, token counts above zero, ids present), never their wording, because a
live model's words change.

## What it deliberately does not do

- **Provoke a rate limit.** The API's counters are per server task, so the point where blocking starts is not
  predictable, and deliberate bursts put blocked requests in the production logs. The retry logic is proved offline
  (`test/retry.test.mjs`); the on-site rehearsal is where a real limit is tried.
- **Test timeouts.** A client that gives up does not stop the server's work, so a timed-out call can still be billed.
  Cancelling is tested once (check 7); a timeout uses the same code path.
- **Say anything about a particular network.** A GitHub runner sits in a data centre, not on a campus. See
  [EVENT-REHEARSAL.md](EVENT-REHEARSAL.md).

## Safety

- At most **three billed calls** per run (`MAX_PAID_CALLS`), counted in one place. A fourth is refused by the script.
- The key is sent only to an `https` address (or to this machine, for the offline tests), and every line the script
  prints passes through `redact()`, so the key never reaches a log.
- SDK retries are **off** in the smoke test, so a 429 is reported on the first try instead of hidden behind a retry.
- A real run needs real money's worth of caution, not much money: the calls are a few dozen tokens each. The hard
  stop on spending is the test account's own balance (see below), not anything in this script.

## Running it

```bash
# nothing is called: checks the key is set and the address is acceptable
AIVANA_API_KEY=ai_live_xxx node smoke/smoke.mjs --dry-run

# the real thing (three tiny billed calls); EXPECTED_SDK_VERSION is optional
AIVANA_API_KEY=ai_live_xxx EXPECTED_SDK_VERSION=0.8.0 node smoke/smoke.mjs
```

Exit code `0` means every check passed, `1` means a check failed, `2` means the setup is wrong and nothing was called.

In GitHub it is the **Production smoke test** workflow (`.github/workflows/smoke.yml`): started by hand
(Actions → Production smoke test → Run workflow) and run automatically as the gate in `publish.yml`, so nothing is
published to npm unless it passed. It tests the **built** package (`npm pack`, installed into an empty folder), not
the source tree.

The script's own tests run offline against a local stand-in for the API: `npm test` (`test/smoke.test.mjs`,
`test/smoke-workflow.test.mjs`). Most of them make the stand-in misbehave and check the script says FAIL.

## One-time setup (a person with GitHub admin and AI Studio access)

The workflow cannot work, and the release gate will block every release, until this is done.

1. **A dedicated test account.** Sign up in AI Studio with an address used for nothing else, named so nobody
   mistakes it for a customer (it will appear in the funnel and in Customers). Keep it to **promotional tokens only**:
   an account that has never bought credit can spend nothing but those tokens, which is the real spending cap. Check
   its balance in Billing.
2. **A key for it.** AI Studio → API Keys → create a key with the **default scopes** (`generate` and `metrics`: the
   quotas check needs `metrics`).
3. **A GitHub Environment named `production-smoke`.** Repository → Settings → Environments → New environment:
   - **Required reviewers:** add yourself. Every run, including the one inside a release, then waits for your click.
   - **Deployment branches and tags:** *Selected branches and tags*, add `main` and the tag pattern `v*`. Without
     this, anyone who can push a branch can run the job and read the key.
   - **Environment secrets:** `AIVANA_API_KEY` = the key from step 2. Not a repository secret.
4. **After the event**, revoke the key in AI Studio and delete the secret, or rotate it.

## If a check fails the first time

The first run against production is also a calibration. If check 5 says *the answer was empty (finish_reason length)*,
the token cap in `TINY` is too small for the model's hidden reasoning: raise `maxTokens` in `smoke.mjs` and rerun.
Anything else is a finding: quote the request id the script prints.
