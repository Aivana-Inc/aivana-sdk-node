# Basic AI Chat

A small browser chat application using the **released `@aivana/sdk` 0.7.1**.
Send a message, get an Aivana answer, then ask a follow-up. The API key stays on the
Node.js server. There is no frontend build step, account system or database.

This is the reference application for
[Node SDK #24](https://github.com/Aivana-Inc/aivana-sdk-node/issues/24) and the
[AI Studio developer journey](https://github.com/Aivana-Inc/aivana-ai-studio/issues/149).

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
- Each request sends up to **eight recent successful exchanges**, plus the current
  message, within a **24,000-character** context budget. Older exchanges are removed
  as whole pairs. New user messages are limited to 4,000 characters. These are this
  example's limits, not the platform's API limits. JSON requests are bounded to 256 KiB.
- Failed or stopped turns do not enter the next request's history. Failed messages
  remain in the composer for editing and manual resubmission.
- Live web search is disabled and answers are capped at 800 output tokens for this
  example. This is not a spending cap: repeated requests and repeated history consume
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
