# Basic AI Chat

A small browser chat application using the **released `@aivana/sdk`**.
Send a message, get an Aivana answer, then ask a follow-up. The API key stays on the
Node.js server. There is no frontend build step, account system or database.

This is the reference application for
[Node SDK #24](https://github.com/Aivana-Inc/aivana-sdk-node/issues/24) and the
[AI Studio developer journey](https://github.com/Aivana-Inc/aivana-ai-studio/issues/149).

## Standalone download (no Git required)

Download the approved `aivana-basic-chat.zip` release and extract it into a new
folder. Requires Node.js 20.6+ and npm. Open a terminal in that folder and run:

```sh
node setup.mjs
npm ci
```

Setup creates a private `.env` without overwriting an existing one. Open `.env` in
your editor and add your own API key. Then:

```sh
npm run doctor
npm start
```

Open http://127.0.0.1:3006. The same commands work in Windows PowerShell, macOS and
Linux shells. Installation downloads pinned dependencies from npm; no repository
access, build step or global CLI is needed. Doctor checks local configuration and
dependencies without sending a paid request; it cannot verify your key or balance.

For updates, extract the new release into a new folder, run setup/install, and
copy your local `.env` yourself. Keep any application changes in your own Git
repository and review them when upgrading. Stop with Ctrl+C. To uninstall, remove
the extracted folder (including its local key file) after saving your own work.

Release maintainers generate this download with
`node tools/package-basic-chat.mjs NEW_OUTPUT_DIRECTORY` from the SDK repository.
Only an explicit file allowlist is copied; the archive never includes `.env`,
installed dependencies, Git history or other SDK examples. `MANIFEST.json` records
file checksums. The manual `Basic Chat download` workflow tests the extracted
archive on Windows/macOS/Linux and retains the candidate for release review.
A candidate workflow artifact is not a public release until maintainers publish it.

## Use an Agent Kit blueprint

Design and test a text assistant in AI Studio's Agent Kit preview, then use
**Inspect / export Blueprint definition → Download definition JSON**. This is
Caden's existing definition export; the starter does not require the pending
Blueprint storage or invocation backend.

1. Put the downloaded `blueprint-definition.json` beside `server.mjs` (not inside
   `public/`). Keep that filename. The server loads it automatically on startup.
2. Run `npm run doctor` to validate it locally without making an API request.
3. Run `npm start`, or stop and restart an already running server. Reload the
   browser. The page shows **Blueprint loaded**, its history behavior, and whether
   web search is allowed.
4. Send a question related to the assistant you configured. Generation uses the
   API key and account credit from your local `.env`.

For a different filename, set `AIVANA_BLUEPRINT_FILE=./my-agent.json` in `.env`.
Relative paths are resolved from the starter folder, even when launched elsewhere;
absolute paths are also supported. Quote paths with spaces in `.env`.
An explicit missing/unreadable file or an invalid definition stops startup; it
never silently falls back to generic chat. If the variable is unset and the
conventional file is absent, the starter keeps its original default behavior.

**Try the included fictional business:** set the following in `.env`:

```dotenv
AIVANA_BLUEPRINT_FILE=blueprints/landscaping.example.json
```

Then run doctor/start and ask “What services do you offer?” followed by “Help me
prepare an estimate request for the second service.” The sample supplies fictional
service facts and explicitly has no booking or submission integration. Replace
it with your own Agent Kit export to use your own instructions.

The JSON is a local snapshot. Re-export, replace the file, restart, and reload to
apply changes. It does not synchronize with Studio, call a saved Blueprint ID,
carry a display name/version, or create server-side conversation storage. Purpose
is descriptive metadata and is never inserted into the system instructions.

| Export setting | Starter behavior |
| --- | --- |
| System, Effort, Web Search Allowed | Applied to every Generate request using documented SDK options. |
| Temperature, Top-P, Max Tokens | Preserved, including zero. Null leaves the field out so the engine chooses its default; the starter's 800-token default is not added to an imported blueprint. Temperature and Top-P cannot both be set. |
| Stop sequences | Preserved exactly; empty arrays are omitted. |
| Text response format | Supported. JSON Schema (Strict) and other formats are rejected with instructions to explicitly choose Text and re-export. |
| Conversation history: session | The starter's bounded recent turns and continuation context are sent with follow-ups. |
| Conversation history: none | Earlier turns remain visible in this tab, but neither prior messages nor continuation context are sent. The server enforces this even if a browser submits them. |
| Knowledge / Sources | Absent or null only. Source references are rejected; no business-document retrieval is claimed. |

Validation follows the approved definition fields and bounds, refuses unknown
fields and coercion, and limits the compact definition to 64 KiB (file size up to
256 KiB including formatting). No imported file is executed. The browser receives
only three behavior flags; instructions and file paths are not served or logged.
`blueprint-definition.json` is ignored by Git and excluded from the downloadable
package. Keep custom-named private exports out of your own Git commits too.

For the capstone rehearsal, place the export in
`rehearsal/aivana-sdk-node/examples/basic-chat/`, then run the rehearsal launcher's
`stop` and `start` commands and reload Chat. No launcher changes or dependency
installation are needed for the blueprint loader.

## Start from a fresh clone

Requires **Node.js 20.6 or newer**, npm, and an active Aivana API key with available
usage credit. The SDK itself supports Node.js 18; this example uses Node's newer
`--env-file` startup option. No global CLI installation is needed.

```sh
git clone https://github.com/Aivana-Inc/aivana-sdk-node.git
cd aivana-sdk-node/examples/basic-chat
npm ci
```

Copy `.env.example` to `.env`:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Open `.env` in your editor and fill in `AIVANA_API_KEY`. Get a key from
[AI Studio API Keys](https://developers.aivana.ai/api-keys); see
[the key guide](https://developers.aivana.ai/docs/api-keys) and
[Quickstart](https://developers.aivana.ai/docs/quickstart). Keep `.env` local:
it is ignored by Git. Never paste your key into the browser, chat messages, or a report.

```dotenv
AIVANA_API_KEY=YOUR_ACTIVE_KEY
AIVANA_API_BASE=
PORT=3006
```

Leave `AIVANA_API_BASE` blank to use the released SDK's production default,
`https://api.aivana.ai`. An approved development key needs its matching API
environment, for example `https://dev-developers.aivana.ai`. A test key is not a free
sandbox: real generation uses the account's credit.

```sh
npm start
```

Open **http://127.0.0.1:3006**. Enter a message and press Send. Ask a follow-up, use
Stop to stop waiting, or New chat to reset. Enter inserts a new line;
Ctrl+Enter / Command+Enter sends. Change `PORT` if 3006 is already occupied.
Restart after editing `.env`. Existing environment variables override that file.

## Streaming and chat settings

The browser defaults to **Stream responses live**, using the SDK's `generateStream()` method. Text appears progressively. An incomplete stream or provider error is shown as a failed response and is **not** added to conversation history. Stop cancels the request; work already accepted by the API may still consume credit. Turn off streaming to compare the original whole-response behavior.

Without an imported Blueprint, use the settings panel to choose intelligence effort (Auto/Low/Medium/High), output length (400/800/1600 tokens), and whether web search is allowed. These options are validated server-side and are not persisted. **When an Agent Kit Blueprint is loaded, the settings panel is locked** so the starter cannot silently override its configuration.

### First-run verification

1. Run `node setup.mjs`, `npm ci`, and `npm run doctor`. Doctor checks configuration without making a paid request.
2. Start the app with `npm start`, send a short prompt, and confirm that text appears incrementally with streaming enabled.
3. Ask a follow-up to verify conversation context. Switch streaming off and send another prompt to verify non-streaming mode.
4. Try effort and web-search settings only if you have sufficient credits. Stop a request and verify the interrupted response is not added to history.
5. For automated two-turn live verification, run `node --env-file=.env verify-live.mjs` (uses account credit).

## How it works

```text
Browser (plain HTML, CSS and JavaScript)
  → POST /api/chat on the local Node.js app
  → server imports @aivana/sdk from npm
  → client.generate(null, { messages, previousIntent, pendingAction, ... })
  → Aivana Intelligence API
  → answer and continuation context returned to this browser
```

| File | Responsibility |
| --- | --- |
| `server.mjs` | Read environment configuration; construct the official SDK client; listen on loopback. |
| `config.mjs` | Validate the server-only key, API origin and local port. |
| `app.mjs` | Validate requests; forward explicit conversation context; return a small answer envelope and fixed public errors. |
| `blueprint.mjs` | Validate a local Agent Kit export and map its settings to SDK options. |
| `public/app.js` | Keep successful turns in memory; send/reset/cancel; display answers as text. |
| `public/conversation.mjs` | Bound the recent conversation supplied with follow-ups. |
| `public/index.html`, `styles.css` | Responsive browser interface, including OS light/dark theme. |

The starter uses the SDK's documented **explicit messages** pattern rather than one
shared `client.chat()` object. A global chat object on a web server would mix different
browsers' conversations. Only `user` and `assistant` history entries are accepted here;
API keys, system instructions, endpoints and generation controls are not browser inputs.

Replies are displayed as plain text, including any Markdown characters. They are never
inserted as HTML. SDK exceptions and upstream envelopes are not forwarded to the browser.

## Conversation and usage boundaries

- History and continuation context live in browser memory only. This example writes
  no chat data to cookies, local/session storage, disk or a database. Separate tabs
  have separate histories. New chat, reload or closing the page clears this local history.
  This is the starter's storage behavior, not a statement about API retention.
- With session history enabled, each request sends up to **eight recent successful exchanges**, plus the current
  message, within a **24,000-character** context budget. Older exchanges are removed
  as whole pairs. New user messages are limited to 4,000 characters. These are this
  example's limits, not the platform's API limits. JSON requests are bounded to 256 KiB.
- Failed or stopped turns do not enter the next request's history. Failed messages
  remain in the composer for editing and manual resubmission.
- Without a blueprint, live web search is disabled and output is capped at 800 tokens.
  Imported blueprints use their own settings, which can increase credit use. The
  browser answer limit remains 16,000 characters; larger answers are rejected, not
  silently truncated. This is not a spending cap: repeated requests and repeated history consume
  account credit. The server allows at most two concurrent requests.
- Requests have a two-minute deadline. Stop, leaving the page and server shutdown
  forward cancellation. An accepted request may still use credit. No automatic
  generation retry is made, including after uncertain network failures.
- The app serves a fixed list of public files, binds only to `127.0.0.1`, checks Host
  and Origin, and accepts only JSON chat requests. It never serves `.env`, server
  source, the installed SDK, or arbitrary paths. No prompts, answers or keys are logged.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Blueprint validation fails | Check the specific field named in the terminal, choose supported settings in Agent Kit, and export again. Doctor makes no API call. |
| Blueprint changes do not appear | Check AIVANA_BLUEPRINT_FILE, replace the selected file, restart the server, and reload the browser. |
| Startup says the key is missing | Fill in `.env`, run from this example folder, and restart. |
| `--env-file` is unknown | Upgrade to Node.js 20.6 or newer. |
| Aivana rejected the key | Confirm the key is active and matches the configured API environment. Restart after changing it. |
| Access denied | Check key permissions and API environment. |
| Not enough credit | Check the account's Billing page in AI Studio. |
| Rate limit / server busy | Wait for the current requests to finish. Retry manually when ready. |
| Invalid request / oversized history | Shorten the message or choose New chat. |
| Timeout / temporary failure | Check network and [service status](https://status.aivana.ai). The result may be uncertain; no retry is made for you. |
| The browser cannot connect | Check the terminal, local port and the `127.0.0.1` address. This server is intentionally not reachable from other devices. |

Do not deploy this local example as a public shared service. Before hosting, add your
own authentication, per-user authorization and billing/usage limits, HTTPS, operational
monitoring, and an explicit conversation storage/retention policy. Keep credentials
server-side. Streaming, accounts, persistence, attachments, RAG, Actions/MCP and publishing
are outside this small reference application.

## Repeatable verification

From the repository root, run `npm ci`, `npm ci --prefix examples/basic-chat`, then
`npm test` to run the SDK tests and local HTTP
tests for this starter. They use fake credentials and a loopback API fixture; they do
not make billed calls. CI also installs this example's pinned npm dependency on the
Node.js versions it supports. The SDK's Node.js 18 tests remain supported.

For a live check after installing/configuring the example, run:

```sh
cd examples/basic-chat
node --env-file=.env verify-live.mjs
```

This starts the app on a temporary loopback port and makes exactly **two small real
generation requests**: an initial synthetic question and a follow-up. It uses account
credit, prints no prompt, answer or key, and is never run by `npm test` or CI. It checks
that both requests return answers and that the follow-up recalls the synthetic nickname;
broader answer quality still needs human inspection.

For manual end-to-end verification, start the app and check:

1. Send “For this conversation, the project nickname is Juniper. Acknowledge briefly.”
2. Ask “What nickname did I give the project?” and confirm the follow-up uses that context.
3. Choose New chat; confirm the earlier messages disappear and a new question starts fresh.
4. Reload and open a second tab; confirm neither receives the earlier conversation.
5. Check Stop, keyboard navigation, 320px/390px layouts and light/dark theme. The theme
   starts with the OS preference; the header button overrides it for this page only.

Record the tested SDK version/environment and which checks were live versus fixture-based.
