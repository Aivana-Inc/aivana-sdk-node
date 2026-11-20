## Validation complete: @aivana/sdk + @aivana/cli 0.7.1 (Node SDK + CLI)

Run as an external developer on 2026-10-20: macOS arm64, Node 25.1 (installs also checked on Node 18, 20 and 22), team test key on `dev-developers.aivana.ai`. The suite is repeatable (`run_validation.sh`, `install_check.sh`) and writes a matrix with one row per case, plus redacted live evidence. Case IDs mirror the Python suite (`PY-CLI-10` ↔ `NODE-CLI-10`), and F-numbers mean the same thing in both (see Aivana-Inc/aivana-sdk-python#15). It is committed on branch `aaronzheng/node-sdk-validation` (in `validation/`) and will be pushed once I have write access to this repo.

**Totals: 126 cases: 106 pass, 18 known defects, 2 passing again since Oct 5, 0 unexpected failures.** Install checks: 9/9 pass.

| Area | Cases | Result |
|---|---|---|
| Install: fresh `npm install @aivana/sdk` on Node 18 / 20 / 22 / 25, no runtime dependencies, `npm install -g @aivana/cli` (Node 18 + 25), `npx @aivana/cli` | 9 | all pass |
| SDK offline: config, request building, parsing, streaming, cancellation, errors, chat, quotas | 43 | 32 pass, 11 known defects |
| SDK live: auth, generate options, effort, trace, structured output, streaming, abort, chat, quotas | 27 | 19 pass, 6 known defects, 2 passing again |
| CLI offline (installed `aivana` from `@aivana/cli` as a real process): options, pipes, `--json`, `--trace`, `--image`, exit codes 0-6, API base | 36 | all pass |
| CLI live: basic, `--json`, `--trace`, pipe, invalid key, `--shape extract`, `--image`, default host | 8 | 7 pass, 1 known defect |
| Docs parity: every Node.js example on the Docs (16) and in the npm README (20) runs against the installed SDK | 12 (one per page, 36 examples) | all pass |

### Acceptance criteria
- [x] Clean-install test completed (npm on 4 Node versions, `npm install -g`, `npx`).
- [x] Basic SDK request passes (live).
- [x] Streaming SDK request passes (live). Reproducible issues with failed and cancelled streams are below (F1, N1, N2).
- [x] CLI basic / JSON / Trace paths are validated (offline + live).
- [x] Representative failure behavior is validated (CLI exit codes 0-6 all correct; SDK gaps documented below).
- [x] Published docs/examples are checked against actual behavior (36 examples, /docs/cli statement by statement).
- [x] Every failed case has reproducible evidence (test ID, request id, repro snippet).
- [x] Substantive defects are documented below with reproductions (kept in this issue rather than opened separately).
- [ ] Results feed the AI Studio integrated developer journey (summary for Aivana-Inc/aivana-ai-studio#149 is next).

### Changed since the Oct 5 report (0.7.0)
- 0.7.1 moved the default host to `api.aivana.ai`; the suite follows it.
- **F4 server half fixed:** production 401s now include `request_id` (`req_1c2186ac4b8a3c8a3775cb39`).
- **F2 reframed, High -> Low:** test keys are documented (Docs > API Keys) as accepted only in their own environment, so the 401 on production is by design. What remains is the misleading error text.
- **F11 passed this run** (40 output tokens with `maxTokens: 40`), but it is intermittent: the Python run against the same API the same day got 57. It stays open as an API issue.
- **F12 now seen on Node too:** `outputShape: "extract"` returned `{"response": "..."}` (`req_8fb5f848a95e37c985e55838`).
- **New:** F16 (effort is not a ceiling), reproduced on Node (`req_69883241cb6dde0b324b81bc`).
- **New coverage:** the `aivana` CLI from `@aivana/cli` passes every offline case and matches /docs/cli completely. Unlike the Python CLI, it does not crash on an unparseable 200 (Python's F17 does not apply).

### Findings

| ID | Finding | Severity | Owner | Suite case |
|---|---|---|---|---|
| F1 | A failed stream ends silently with a partial answer | High | SDK | NODE-STR-07 |
| N1 | Once a stream starts, an `AbortSignal` can't stop it and `timeoutMs` no longer applies | High | SDK | NODE-STR-08/09, NODE-LIV-36 |
| N2 | Leaving a `for await` loop early doesn't cancel the request | Medium | SDK | NODE-STR-05 |
| F5 | Network failures and timeouts aren't `AivanaError`s | Medium | SDK | NODE-ERR-05/06 |
| F8 | Retrying a failed `chat.send()` sends the question twice | Medium | SDK | NODE-CHT-04 |
| F15 | Streaming barely starts before the answer is done | Medium | API | NODE-LIV-37 |
| F11, F13, F16 | `maxTokens` not a ceiling; JSON Schema answers report 0 output tokens; `effort: "low"` doesn't bound intelligence | Medium | API | NODE-LIV-11/22/23 |
| F3, F4, F6, F7 | Error classes vs. the retry and support docs | Low | SDK | NODE-ERR-03/04/07/08 |
| F2 | Test key on production: misleading error message | Low | API + CLI | NODE-LIV-03, NODE-CLI-L08 |
| P1 | The two SDKs send `continue` differently | Low | SDK (parity) | NODE-GEN-12 |
| N3, F10, F12, F14 | Docs: `quotas()` `requests` window, `topP`, extract fallback shape, stream events | Low | Docs | NODE-LIV-50/18/34 |

Details and reproductions for each:

<details>
<summary><b>F1: A failed stream ends silently with a partial answer</b></summary>

#### What happens
An `error` event that arrives mid-stream is yielded like any other chunk. The documented loop (`if (chunk.event === "delta") ...`) ignores it and ends normally with half an answer: no exception, nothing to tell the caller the answer is incomplete. The `aivana` CLI handles this correctly (exit 6, "The text above is incomplete.", `NODE-CLI-45`) because it checks the event itself.

#### Docs say
README > Errors: "Every failure throws a subclass of `AivanaError`". The streaming examples in the README and on Docs > SDKs / Streaming check only for `delta`.

#### Reproduce (@aivana/sdk 0.7.1)
```js
import { Aivana } from "@aivana/sdk";
const sse = (...ev) => ev.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const fetch = async () => new Response(sse(
  ["delta", { text: "Partial" }],
  ["error", { type: "upstream_error", message: "engine error" }],
  ["done", { finish_reason: "error", usage: {} }]), { status: 200, headers: { "Content-Type": "text/event-stream" } });

const client = new Aivana({ apiKey: "ai_test_x", fetch });
for await (const chunk of client.generateStream("hi")) {     // the documented loop
  if (chunk.event === "delta") process.stdout.write(chunk.data.text);
}
// prints "Partial" and the loop ends normally; expected: an AivanaError (e.g. UpstreamError)
```
Suite case: `NODE-STR-07`. Same as Python F1.

#### Suggested fix
Throw the mapped `AivanaError` subclass when an `error` event arrives (after yielding what was received): `upstream_error`/`timeout` -> `UpstreamError`, `invalid_request` -> `InvalidRequestError`.

</details>

<details>
<summary><b>N1: Once a stream starts, an AbortSignal can't stop it and timeoutMs no longer applies</b></summary>

#### What happens
The SDK detaches the caller's `signal` and clears the `timeoutMs` timer as soon as the response headers arrive. After that, aborting does nothing and a stalled stream waits forever.

Live on 2026-10-20 (`NODE-LIV-36`): aborted at the first piece of text (5.1 s in); the stream kept going, delivered 11 more chunks and ended normally 2.6 s after the abort, still billed. Offline:
```js
const ac = new AbortController();
for await (const chunk of client.generateStream("hi", { signal: ac.signal })) {
  ac.abort();        // after the first chunk
}
// 0.7.1: the loop kept reading (21 chunks in 420 ms) and fetch never saw the abort
```

#### Docs say
README > Configuration: "Cancel an in-flight request with an `AbortSignal`", and `timeoutMs` (default 120 000) is documented without exceptions for streams.

Suite cases: `NODE-STR-08` (signal), `NODE-STR-09` (timeout), `NODE-LIV-36` (live). Node only.

#### Suggested fix
Keep the abort and timeout wiring until the body is fully read or the generator exits, and cancel the body in the generator's `finally`.

</details>

<details>
<summary><b>N2: Leaving a for-await loop early doesn't cancel the request</b></summary>

#### What happens
`break` out of `for await (... of client.generateStream(...))` releases the reader but never cancels the response body, so the connection stays open and the server can keep generating, and charging for, the rest.
```js
for await (const chunk of client.generateStream("hi")) break;
// 0.7.1: the response body's cancel() is never called
```

#### Docs say
Docs > Streaming, "Stopping a stream": "If you stop reading before the stream ends, the request is charged for its prompt and the part of the answer you received." That holds only if stopping reading actually closes the request.

Suite case: `NODE-STR-05`. Node only: Python closes the connection when the loop exits.

#### Suggested fix
Call `reader.cancel()` in the generator's `finally`.

</details>

<details>
<summary><b>F5: Network failures and timeouts aren't AivanaErrors</b></summary>

#### What happens
A dropped connection throws fetch's `TypeError: fetch failed`; a `timeoutMs` expiry throws a bare `DOMException` (`AbortError`), indistinguishable from the caller's own abort. Code written to the docs (`catch (err) { if (err instanceof AivanaError) ... }`) misses both, though these are the failures the docs say are safe to retry.
```js
const client = new Aivana({ apiKey: "ai_test_x", apiBase: "http://127.0.0.1:9" });   // nothing listening
await client.generate("hi");
// 0.7.1: throws TypeError; err instanceof AivanaError === false
```
Suite cases: `NODE-ERR-05`, `NODE-ERR-06`. Same as Python F5. (The CLI wraps both: exit 6, `NODE-CLI-44`.)

#### Suggested fix
Wrap both in `AivanaError` subclasses with distinct codes, e.g. `network` and `timeout`.

</details>

<details>
<summary><b>F8: Retrying a failed chat.send() sends the question twice</b></summary>

#### What happens
`chat.send()` adds the user turn to the history before the request. If the request fails, the turn stays, so the natural retry sends the question twice.
```js
const chat = client.chat();
try { await chat.send("What changed in Q3?"); }                   // 429
catch (e) { if (e instanceof RateLimitError) await chat.send("What changed in Q3?"); }
// 0.7.1: the retry's messages are ["What changed in Q3?", "What changed in Q3?"]
```
Suite case: `NODE-CHT-04`. Same as Python F8.

#### Suggested fix
Add the turn to the history only after a successful response.

</details>

<details>
<summary><b>F15: Streaming barely starts before the answer is done (API)</b></summary>

#### What happens
For a long answer (1 439 characters), the first text arrived 5.6 s into a 6.8 s request (82%); the remaining five chunks came within about 1 s (`NODE-LIV-37`, 2026-10-20; Oct 5: 86%). A streamed answer reaches the user only slightly sooner than a non-streamed one.

#### Docs say
Docs > Streaming: streaming "matters most for long answers, because the non-streaming call waits for the complete response".

#### Question for Aivana
Is this expected (for example, because perspectives are combined before any text is written)? If so, the Streaming page should set expectations for time to first text. API behavior, so it affects both SDKs and the CLI.

</details>

<details>
<summary><b>F11, F13, F16: maxTokens, structured-output usage and effort (API, same as Python)</b></summary>

These come from the service, so they affect both SDKs. Full write-ups with tables and reproductions are on Aivana-Inc/aivana-sdk-python#15. Node evidence from 2026-10-20:

- **F11, `maxTokens` is not a ceiling.** This run returned exactly 40 output tokens for `maxTokens: 40` (`req_431843da181b77198577491a`, passes), but it is intermittent: Oct 5 Node got 63; the Python run the same day got 57 (`req_17cb14c01671d3bb49a952a0`). README: "`maxTokens` is a **ceiling, not a target.** It can only shorten an answer".
- **F13, JSON Schema answers report `output_tokens: 0`.** Reproduced: `{"vendorName":"Acme Ltd","total":1250}` with `usage: {input_tokens: 50, output_tokens: 0, credits: 0.00005}` (`req_3ad7b2fa070404471bbafa96`).
- **F16, `effort: "low"` doesn't bound intelligence.** Reproduced: the Stripe decision question at `effort: "low"` came back `intelligence_level: "Premium"`, "Multi-model collaboration" (`req_69883241cb6dde0b324b81bc`), the same as `"high"` in the Python comparison.

</details>

<details>
<summary><b>F3, F4, F6, F7: Error classes vs. the retry and support docs</b></summary>

Same as Python; each has an offline test.

| # | What happens | Suite case |
|---|---|---|
| F7 | Only 502 maps to `UpstreamError`; 504, 500 and 503 become the base `AivanaError`, so the Docs > Errors & Retries example (`err instanceof RateLimitError \|\| err instanceof UpstreamError`) never retries a 504, which that page says to retry. | `NODE-ERR-08` |
| F6 | `RateLimitError` exposes neither `retry_after_ms` nor `Retry-After`, though the docs say to "Wait that long, then send it again." | `NODE-ERR-07` |
| F3 | Only allowlisted 422 codes become `InvalidRequestError`; other 422s are the base class. (A real bad parameter was classified correctly live, so this is hardening.) | `NODE-ERR-03` |
| F4 | `requestId` is read only from the body, with no `X-Request-Id` header fallback. The production host now includes it in 401 bodies, so the server half is fixed (`NODE-LIV-04` passes). | `NODE-ERR-04` |

#### Suggested fix
Map 504 (and every 5xx) to `UpstreamError`; add `RateLimitError.retryAfter`; map every 422 to `InvalidRequestError`; fall back to the `X-Request-Id` header.

</details>

<details>
<summary><b>F2: A test key on production gets "Invalid or expired API key", not the environment mismatch the Docs describe</b></summary>

Docs > API Keys says test keys are accepted only in the environment that issued them and "won't work against api.aivana.ai", and that an unauthorized `ai_test_` key most likely means "a key from another environment". Neither the API nor the CLI says so:

- SDK (default `apiBase`): `AuthError` `invalid_api_key`, "Invalid or expired API key. Generate a new key or check its expiry." (`req_3dc48b00da0c048d77e035c4`)
- CLI (`AIVANA_API_BASE` unset), exit 3:
  ```
  aivana: error: Invalid or expired API key. Generate a new key or check its expiry. (request id: req_acde02a6893fba4f1d09f924)
    Create a new key in AI Studio > API Keys, then run:
      export AIVANA_API_KEY=ai_live_...
  ```
The same key works on `dev-developers.aivana.ai`. Suggested fix (same as Python): a distinct API code such as `key_wrong_environment`, and in the CLI/SDK a hint when an `ai_test_` key is refused on the default host. Suite cases: `NODE-LIV-03`, `NODE-CLI-L08`.

</details>

<details>
<summary><b>P1: The two SDKs send `continue` differently</b></summary>

Node sends `continue: true` inside `metadata` (`{"metadata": {"continue": true}}`); Python sends a top-level `"continue": true`. The Node source says the engine already treats `metadata.continue` as a continuation, and both READMEs describe the feature, but the two SDKs can't both match one API contract. Suite case: `NODE-GEN-12` (and Python `PY-GEN-03`). Suggest Aivana confirm which wire format the API expects and align both SDKs.

</details>

<details>
<summary><b>N3, F10, F12, F14: Docs parity</b></summary>

Every Node.js example on the Docs (16) and in the npm README (20) runs against the installed SDK (one README block only shows the response's shape), and every statement on /docs/cli holds for `@aivana/cli`, including `npm install -g` and `npx`. Left over:

- [ ] **N3 - `quotas()` returns a `requests` window the README doesn't describe.** README > Quotas lists `input_tokens` and `output_tokens` per window; the API also returns `requests` (`{used: 152, limit: 500, pending: 348}` for the day on 2026-10-20). A 500-requests-per-day cap matters to anyone running a test suite. Suite: `NODE-LIV-50`.
- [ ] **F10 - `topP` is undocumented.** `generate()` accepts `topP` (sent as `top_p`, and `topP: 0` is kept), but it appears in neither the README nor Docs > Parameters.
- [ ] **F12 - `outputShape: "extract"` fallback shape is undocumented.** When the prompt names no fields, the answer can be prose wrapped as `{"response": "Thank you for providing the details ..."}` (`req_8fb5f848a95e37c985e55838`); a prompt that names the fields returns them (`--shape extract --json`, `NODE-CLI-L06`). Suggest documenting the fallback and pointing to `responseFormat` (JSON Schema) for guaranteed fields. Suite: `NODE-LIV-18`.
- [ ] **F14 - two stream events are undocumented (question, not a break).** Every stream sends `stage` events and a `route` event (`{"model": "aivana-mmi", "provider": "aivana", "role": "mmi"}`); the Streaming page lists `delta`, `done`, `error`, `trace` and correctly says to skip unknown events. No underlying model or provider names appear (`NODE-LIV-35` passes). Suite: `NODE-LIV-34`.

Verified 2026-10-20 against aivana-ai-studio `main` and the @aivana/sdk 0.7.1 README on npm.

</details>

**Note for maintainers:** F11, F13, F15, F16 and the 401 wording in F2 are server-side. `Aivana-Inc/aivana-intelligence-api` isn't visible to our account, so they are recorded here; please move them to the owning repo if useful.
