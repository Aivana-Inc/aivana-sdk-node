# Aivana Node SDK - validation matrix

@aivana/sdk 0.7.1 | Node 25.1.0 | darwin | live base https://dev-developers.aivana.ai | key set: yes | 2026-10-20T22:15:39

Totals: DEFECT (known) 18, FIXED? (re-check) 2, PASS 106

| ID | Area | Check | Mode | Result | Finding | Detail |
|---|---|---|---|---|---|---|
| NODE-INS-01 | Install | Package installs from npm and reports its version | offline | PASS |  |  |
| NODE-INS-02 | Install | Runs on the documented minimum (Node >= 18) | offline | PASS |  |  |
| NODE-INS-03 | Install | Every name the docs use is exported (default + named) | offline | PASS |  |  |
| NODE-CFG-01 | Configure | apiKey option is sent as X-API-Key | offline | PASS |  |  |
| NODE-CFG-05 | Configure | No key: no header sent; 401 is AuthError and names the missing key | offline | PASS |  |  |
| NODE-CFG-06 | Configure | Default apiBase is the documented hosted API; trailing slash normalised | offline | PASS |  |  |
| NODE-CFG-07 | Configure | Docs Quickstart Node snippet runs as written (default import, intelligenceTrace) | offline | PASS |  |  |
| NODE-CFG-08 | Configure | Requests omit cookies and never follow redirects | offline | PASS |  |  |
| NODE-GEN-01 | Generate | Parses a real dev-API response: answer, usage, finish_reason, notices | offline | PASS |  |  |
| NODE-GEN-02 | Generate | POSTs /v1/generate with prompt; unset options are omitted | offline | PASS |  |  |
| NODE-GEN-03 | Generate | camelCase options reach the wire in snake_case | offline | PASS |  |  |
| NODE-GEN-04 | Generate | System prompt > 8000 chars rejected before any request | offline | PASS |  |  |
| NODE-GEN-05 | Generate | Attachments: mimeType normalised to mime_type | offline | PASS |  |  |
| NODE-GEN-06 | Generate | responseFormat sent exactly as given (schema keys not re-cased); non-object rejected | offline | PASS |  |  |
| NODE-GEN-07 | Generate | Tolerates new fields the server adds (forward compatible) | offline | PASS |  |  |
| NODE-GEN-08 | Generate | Non-JSON 200 (proxy page) throws AivanaError, not SyntaxError | offline | PASS |  |  |
| NODE-GEN-09 | Generate | Redirects are reported, so the key never leaves apiBase | offline | PASS |  |  |
| NODE-GEN-10 | Generate | An AbortSignal cancels an in-flight generate() (README > Configuration) | offline | PASS |  |  |
| NODE-GEN-11 | Generate | messages are sent instead of prompt (manual history) | offline | PASS |  |  |
| NODE-GEN-12 | Generate | continue: true is sent as metadata.continue (README > Resuming) | offline | PASS |  |  |
| NODE-STR-01 | Streaming | generateStream yields deltas that join into the answer; done carries usage | offline | PASS |  |  |
| NODE-STR-02 | Streaming | Streams POST /v1/generate:stream with the same body | offline | PASS |  |  |
| NODE-STR-03 | Streaming | responseFormat json_schema + stream refused client-side with the documented code | offline | PASS |  |  |
| NODE-STR-04 | Streaming | HTTP 401 on the stream throws AuthError | offline | PASS |  |  |
| NODE-STR-05 | Streaming | Leaving a for-await loop early cancels the response body | offline | DEFECT (known) | N2 | AssertionError: body still open after break: the server keeps generating (and billing) the rest |
| NODE-STR-06 | Streaming | Unknown/trace events pass through without breaking iteration | offline | PASS |  |  |
| NODE-STR-07 | Streaming | Mid-stream `error` event throws AivanaError ('every failure throws') | offline | DEFECT (known) | F1 | AssertionError: expected a rejection, got success |
| NODE-STR-08 | Streaming | An AbortSignal stops a stream that is already sending | offline | DEFECT (known) | N1 | AssertionError: abort after the first chunks had no effect |
| NODE-STR-09 | Streaming | timeoutMs still applies while a stream is being read | offline | DEFECT (known) | N1 | AssertionError: stream kept running past timeoutMs |
| NODE-ERR-01 | Errors | Each documented status maps to the documented AivanaError subclass + code | offline | PASS |  |  |
| NODE-ERR-02 | Errors | 422 details (which field is wrong) are kept on the error | offline | PASS |  |  |
| NODE-ERR-03 | Errors | Any 422 is an InvalidRequestError (README: validation error = InvalidRequestError) | offline | DEFECT (known) | F3 | AssertionError: expected InvalidRequestError, got AivanaError: x |
| NODE-ERR-04 | Errors | requestId available on errors (falls back to X-Request-Id header) | offline | DEFECT (known) | F4 | AssertionError: Expected values to be strictly equal: |
| NODE-ERR-05 | Errors | Network failure throws an AivanaError subclass ('every failure throws') | offline | DEFECT (known) | F5 | AssertionError: expected AivanaError, got TypeError: fetch failed |
| NODE-ERR-06 | Errors | timeoutMs expiry throws an AivanaError subclass | offline | DEFECT (known) | F5 | AssertionError: expected AivanaError, got DOMException: This operation was aborted |
| NODE-ERR-07 | Errors | RateLimitError exposes the Retry-After wait the docs say to honour | offline | DEFECT (known) | F6 | AssertionError: no retry-after on the error |
| NODE-ERR-08 | Errors | 504 (documented retryable) throws a retryable error class | offline | DEFECT (known) | F7 | AssertionError: expected UpstreamError, got AivanaError: x |
| NODE-CHT-01 | Conversations | chat() sends full history plus previous_intent / pending_action | offline | PASS |  |  |
| NODE-CHT-02 | Conversations | chat options apply every turn; send() options win for that turn | offline | PASS |  |  |
| NODE-CHT-03 | Conversations | reset() starts a fresh conversation | offline | PASS |  |  |
| NODE-CHT-04 | Conversations | A failed send() does not corrupt history (retry is safe) | offline | DEFECT (known) | F8 | AssertionError: Expected values to be strictly deep-equal: |
| NODE-CHT-05 | Conversations | chat.continue() appends the continuation onto the last answer | offline | PASS |  |  |
| NODE-QTA-01 | Quotas | quotas() GETs /v1/quotas with the key and returns windows | offline | PASS |  |  |
| NODE-LIV-01 | Auth | Invalid key -> AuthError with code, status and message | live | PASS |  |  |
| NODE-LIV-02 | Auth | Errors carry requestId (dev host) | live | PASS |  |  |
| NODE-LIV-03 | Auth | A test key on the default (production) host is refused, and the error says it is from another environment (Docs > API Keys) | live | DEFECT (known) | F2 | AssertionError: The input did not match the regular expression /environment\|test key/i. Input: |
| NODE-LIV-04 | Auth | Errors from the default (production) host also carry requestId | live | FIXED? (re-check) | F4 |  |
| NODE-LIV-10 | Generate | Quickstart call returns answer, usage, finish_reason, notices | live | PASS |  |  |
| NODE-LIV-11 | Generate | maxTokens is a ceiling: output_tokens <= maxTokens | live | FIXED? (re-check) | F11 |  |
| NODE-LIV-12 | Generate | intelligenceTrace returns trace with steps and summary | live | PASS |  |  |
| NODE-LIV-13 | Generate | Trace stays customer-safe: no provider/model names leak | live | PASS |  |  |
| NODE-LIV-14 | Generate | assistantName is honoured | live | PASS |  |  |
| NODE-LIV-15 | Generate | messages with a system message work (manual history) | live | PASS |  |  |
| NODE-LIV-16 | Generate | webSearch false + a question asking for the web -> web_search_off notice | live | PASS |  |  |
| NODE-LIV-17 | Generate | stopSequences: the marker is not returned | live | PASS |  |  |
| NODE-LIV-18 | Generate | outputShape 'extract' returns structured or structured_error | live | PASS |  |  |
| NODE-LIV-19 | Structured | responseFormat json_schema -> validated structured (or response_format_not_available) | live | PASS |  |  |
| NODE-LIV-20 | Structured | Unsupported schema -> InvalidRequestError invalid_response_schema | live | PASS |  |  |
| NODE-LIV-21 | Errors | Out-of-range parameter (temperature 5) -> InvalidRequestError with details | live | PASS |  |  |
| NODE-LIV-22 | Structured | A successful json_schema answer reports its output tokens | live | DEFECT (known) | F13 | AssertionError: output_tokens is 0 |
| NODE-LIV-23 | Generate | effort is a ceiling: effort 'low' keeps a decision question below the top level (Premium) | live | DEFECT (known) | F16 | AssertionError: Expected "actual" to be strictly unequal to: |
| NODE-LIV-30 | Streaming | Stream completes: deltas join into the answer; done carries usage/notices | live | PASS |  |  |
| NODE-LIV-37 | Streaming | A long answer streams incrementally (first text well before the end) | live | DEFECT (known) | F15 | AssertionError: first text at 5626 ms of 6834 ms |
| NODE-LIV-31 | Streaming | Stream + intelligenceTrace emits trace events | live | PASS |  |  |
| NODE-LIV-32 | Streaming | Invalid key on the stream throws AuthError | live | PASS |  |  |
| NODE-LIV-34 | Streaming | Without intelligenceTrace, a stream sends only documented events | live | DEFECT (known) | F14 | AssertionError: Expected values to be strictly deep-equal: |
| NODE-LIV-35 | Streaming | Stream route/stage/trace payloads stay customer-safe | live | PASS |  |  |
| NODE-LIV-36 | Streaming | An AbortSignal stops a live stream mid-answer | live | DEFECT (known) | N1 | AssertionError: after abort: ended normally |
| NODE-LIV-40 | Conversations | chat() remembers earlier turns | live | PASS |  |  |
| NODE-LIV-50 | Quotas | quotas() returns hour/day/month windows (README > Quotas) | live | PASS |  |  |
| NODE-CLI-01 | CLI | `aivana --version` runs from the installed bin and names the version | offline | PASS |  |  |
| NODE-CLI-02 | CLI | @aivana/cli and @aivana/sdk are released together (same version) | offline | PASS |  |  |
| NODE-CLI-03 | CLI | `aivana --help` lists every option Docs > Command Line documents, and both env vars | offline | PASS |  |  |
| NODE-CLI-04 | CLI | --help's exit-code table matches the Docs/README table (0-6, 130) | offline | PASS |  |  |
| NODE-CLI-05a | CLI | No --model option exists (Docs: 'No model picker, on purpose') | offline | PASS |  |  |
| NODE-CLI-05b | CLI | No --provider option exists (Docs: 'No model picker, on purpose') | offline | PASS |  |  |
| NODE-CLI-06 | CLI | `aivana help` prints help and exits 0 | offline | PASS |  |  |
| NODE-CLI-10 | CLI | Basic question: answer on stdout only, exit 0, POST /v1/generate:stream with X-API-Key | offline | PASS |  |  |
| NODE-CLI-11 | CLI | `aivana "..." > answer.md` saves just the answer | offline | PASS |  |  |
| NODE-CLI-12 | CLI | Every documented option reaches the wire under its API name (README option table) | offline | PASS |  |  |
| NODE-CLI-13 | CLI | Options left off are not sent (left to Aivana); --no-web sends web_search=false | offline | PASS |  |  |
| NODE-CLI-14 | CLI | Reserved word is refused with a hint; `aivana ask ...` is the way around it | offline | PASS |  |  |
| NODE-CLI-15 | CLI | Abbreviated options are refused (`--temp` is not --temperature) | offline | PASS |  |  |
| NODE-CLI-20 | CLI | Piped text is sent ahead of the question (`git diff \| aivana "Review this change"`) | offline | PASS |  |  |
| NODE-CLI-21 | CLI | Piped text alone is the question; `aivana "..." < contract.txt` works | offline | PASS |  |  |
| NODE-CLI-22 | CLI | Docs: with nothing piped, `< /dev/null` answers at once (no 3 s wait, no note) | offline | PASS |  |  |
| NODE-CLI-23 | CLI | Docs: an open-but-silent stdin waits about 3 s, says so on stderr, then sends just the question | offline | PASS |  |  |
| NODE-CLI-24 | CLI | Binary piped input is refused locally with a pointer to --image (exit 2) | offline | PASS |  |  |
| NODE-CLI-30 | CLI | --json waits for the whole response (POST /v1/generate) and prints parseable JSON | offline | PASS |  |  |
| NODE-CLI-31 | CLI | --trace prints the Intelligence Trace on stderr after the answer; stdout stays the answer | offline | PASS |  |  |
| NODE-CLI-32a | CLI | --image refuses PDF locally (exit 2) with how to send a document instead | offline | PASS |  |  |
| NODE-CLI-32b | CLI | --image refuses DOCX locally (exit 2) with how to send a document instead | offline | PASS |  |  |
| NODE-CLI-33 | CLI | --image with a missing file names the file (exit 2, nothing sent) | offline | PASS |  |  |
| NODE-CLI-34 | CLI | A 200 --json response missing a required field ends in a clean `aivana: error:` or prints it, never a stack trace | offline | PASS |  |  |
| NODE-CLI-40 | CLI | No AIVANA_API_KEY: exit 3 before any request, with how to set it | offline | PASS |  |  |
| NODE-CLI-41 | CLI | Each documented HTTP error maps to the documented exit code, message + request id on stderr (stream and --json) | offline | PASS |  |  |
| NODE-CLI-42 | CLI | A 422 validation error names the flag to fix (exit 1) | offline | PASS |  |  |
| NODE-CLI-43 | CLI | Bad usage exits 2 with no request (unknown --effort, non-number --max-tokens, no question) | offline | PASS |  |  |
| NODE-CLI-44 | CLI | Unreachable API: exit 6 ('safe to retry') | offline | PASS |  |  |
| NODE-CLI-45 | CLI | An error frame inside a 200 stream exits 6, and partial text is flagged as incomplete | offline | PASS |  |  |
| NODE-CLI-46 | CLI | A cut-off answer (finish_reason=length) says so on stderr | offline | PASS |  |  |
| NODE-CLI-47 | CLI | The API key never appears in stdout or stderr, on success or failure | offline | PASS |  |  |
| NODE-CLI-50 | CLI | AIVANA_API_BASE that is not a URL is refused locally (exit 2) | offline | PASS |  |  |
| NODE-CLI-51 | CLI | Plain http:// to a non-local host warns the key travels unencrypted | offline | PASS |  |  |
| NODE-CLI-52 | CLI | Plain http:// to localhost is ordinary local development (no warning) | offline | PASS |  |  |
| NODE-CLI-53 | CLI | With AIVANA_API_BASE unset the CLI calls the documented default (https://api.aivana.ai) | offline | PASS |  |  |
| NODE-CLI-L01 | CLI | Live: basic question streams an answer to stdout, nothing on stderr, exit 0 | live | PASS |  |  |
| NODE-CLI-L02 | CLI | Live: --json prints a GenerateResponse with answer, usage and request_id | live | PASS |  |  |
| NODE-CLI-L03 | CLI | Live: --trace shows the Intelligence Trace on stderr only, with no model/provider names | live | PASS |  |  |
| NODE-CLI-L04 | CLI | Live: piped text is answered (`echo ... \| aivana "..."`) | live | PASS |  |  |
| NODE-CLI-L05 | CLI | Live: an invalid key exits 3 with a request id, and the key is not echoed | live | PASS |  |  |
| NODE-CLI-L06 | CLI | Live: `--shape extract --json` (Docs/README example) returns a structured result | live | PASS |  |  |
| NODE-CLI-L07 | CLI | Live: --image attaches a PNG and the request is accepted | live | PASS |  |  |
| NODE-CLI-L08 | CLI | Live: a test key with AIVANA_API_BASE unset (production) exits 3 and says the key is from another environment | live | DEFECT (known) | F2 | AssertionError: The input did not match the regular expression /environment\|test key/i. Input: |
| NODE-DOC-README | Docs parity | Every Node.js example on README runs against the installed SDK (20) | offline | PASS |  |  |
| NODE-DOC-QUICKSTART | Docs parity | Every Node.js example on docs/quickstart runs against the installed SDK (2) | offline | PASS |  |  |
| NODE-DOC-SDKS | Docs parity | Every Node.js example on docs/sdks runs against the installed SDK (5) | offline | PASS |  |  |
| NODE-DOC-API-KEYS | Docs parity | Every Node.js example on docs/api-keys runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-GENERATE | Docs parity | Every Node.js example on docs/generate runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-STREAMING | Docs parity | Every Node.js example on docs/streaming runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-PARAMETERS | Docs parity | Every Node.js example on docs/parameters runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-ERRORS-RETRIES | Docs parity | Every Node.js example on docs/errors-retries runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-FILES-DOCUMENTS | Docs parity | Every Node.js example on docs/files-documents runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-STRUCTURED-OUTPUTS | Docs parity | Every Node.js example on docs/structured-outputs runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-INTELLIGENCE-TRACE | Docs parity | Every Node.js example on docs/intelligence-trace runs against the installed SDK (1) | offline | PASS |  |  |
| NODE-DOC-CONVERSATIONS | Docs parity | Every Node.js example on docs/conversations runs against the installed SDK (1) | offline | PASS |  |  |
