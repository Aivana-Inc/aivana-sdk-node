# @aivana/sdk

JavaScript / TypeScript client for the Aivana Intelligence API.

Ask a question, get a synthesized answer. Aivana routes each request across one or
more frontier models, reconciles what they say, and returns a single result — you
don't pick models or manage providers.

Requires Node.js 18 or newer (uses the built-in `fetch`). Ships with TypeScript
definitions; no runtime dependencies.

> **Server-side only.** This client authenticates with a long-lived API key. Never
> bundle it into browser code — the key would be readable by any visitor through
> devtools, and stays valid until you revoke it. Call Aivana from your own backend
> and proxy browser requests through it.

## Install

```bash
npm install @aivana/sdk
```

## Quick start

```js
import Aivana from "@aivana/sdk";

const client = new Aivana({ apiKey: process.env.AIVANA_API_KEY });

const res = await client.generate("Summarise our Q3 churn drivers.");
console.log(res.answer);
```

That's the whole setup. Your API key is the only required option.

### What comes back

```js
{
  answer: "...",              // the synthesized response
  intent: { name, confidence },
  models_used: [...],         // the Aivana model id, e.g. ["aivana-mmi"]
  usage: { input_tokens, output_tokens, credits },
  latency_ms: 8421,
  finish_reason: "stop"
}
```

## Streaming

Stream tokens as they're produced instead of waiting for the full answer:

```js
for await (const chunk of client.generateStream("Draft a launch plan.")) {
  if (chunk.event === "delta") process.stdout.write(chunk.data.text);
}
```

Each chunk is `{ event, data }`. The events you'll care about:

| event | meaning |
|---|---|
| `delta` | a piece of the answer — `data.text` |
| `stage` | progress update while the answer is being produced |
| `route` | an outcome-level progress checkpoint |
| `done` | finished — carries `usage` and `finish_reason` |
| `error` | something failed upstream |

## Conversation history

Aivana is stateless: it never stores your conversations. To ask a follow-up, you
send the prior turns back with the next question. There are two ways to do that.

**Let the SDK track it.** `chat()` keeps the history in memory and appends each
turn for you:

```js
const chat = client.chat();

await chat.send("We're choosing between Postgres and DynamoDB.");
await chat.send("What changes if write volume triples?");   // remembers the above

chat.reset();   // start a fresh conversation
```

**Or manage it yourself**, which is what you want when history lives in your own
database and spans processes or requests:

```js
const messages = [
  { role: "user",      content: "We're choosing between Postgres and DynamoDB." },
  { role: "assistant", content: previousAnswer },
  { role: "user",      content: "What changes if write volume triples?" },
];

const res = await client.generate(null, { messages });
```

Pass `messages` **instead of** a prompt — the last `user` message is the current
question. Each item is `{ role, content }` where role is `"user"`, `"assistant"`,
or `"system"`, in chronological order.

For best results on follow-ups, also pass `previousIntent` from the prior
response. It helps Aivana resolve replies like "yes, do that" against what was
actually offered:

```js
const res = await client.generate(null, {
  messages,
  previousIntent: previous.intent.name,
});
```

## Images

Send images inline with a question — chart screenshots, diagrams, photos of a
whiteboard:

```js
import { readFileSync } from "node:fs";

const res = await client.generate("What's driving the dip in this chart?", {
  attachments: [
    { mimeType: "image/png", data: readFileSync("chart.png").toString("base64") },
  ],
});
```

`data` takes raw base64 or a full data URL (`data:image/png;base64,...`) — both work.

| | |
|---|---|
| Formats | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| Max per request | 6 images |
| Max size | 8 MiB each, decoded |

Images attach to the **current turn only** and are never replayed on later turns.
If a follow-up question is about the same image, send it again:

```js
const chat = client.chat();
await chat.send("What's wrong with this architecture?", {
  attachments: [{ mimeType: "image/png", data: diagramB64 }],
});
await chat.send("How would you fix the bottleneck?", {
  attachments: [{ mimeType: "image/png", data: diagramB64 }],   // resend
});
```

Nothing is stored server-side — the bytes are used for that request and discarded.

## Generation options

Both generation options are **optional, and omitting them is the recommended
default.** Aivana picks a temperature and an output budget suited to each question.
Passing a value opts out of that per-request tuning, so pass one only when you
specifically need to.

```js
const res = await client.generate("Draft a launch plan.", {
  temperature: 0.2,   // omit → chosen per request
  maxTokens: 500,     // omit → sized to the question
});
```

`temperature` accepts `0.0`–`2.0`. Lower is more deterministic, higher more varied.

`maxTokens` is a **ceiling, not a target.** It can only shorten an answer — it never
raises the model-aware limit, so a very large value has no effect. When you lower it,
Aivana shortens what it aims to write rather than letting a full-length answer get
cut off mid-sentence.

Both work the same on `generate()`, `generateStream()`, and `chat()`.

## Quotas

```js
const { windows } = await client.quotas();

// Tokens used and still available, per window:
//   windows.hour  / .day / .month
//     .input_tokens  { used, limit, pending }
//     .output_tokens { used, limit, pending }
//
// `limit` and `pending` are null when a window is unmetered — no plan sets an
// hourly ceiling, so `hour` reports usage only.
console.log(windows.day.input_tokens.used, "of", windows.day.input_tokens.limit);
```

## Errors

Every failure throws a subclass of `AivanaError`, each carrying `code`, `status`,
and `requestId` — quote `requestId` when reporting a problem.

| error | when |
|---|---|
| `AuthError` | missing or invalid API key (401) |
| `ForbiddenError` | key lacks access (403) |
| `RateLimitError` | rate limit or quota exhausted (429) |
| `InvalidRequestError` | malformed request (400) |
| `UpstreamError` | model provider failed (502) |

```js
import { RateLimitError } from "@aivana/sdk";

try {
  await client.generate("...");
} catch (err) {
  if (err instanceof RateLimitError) await backoff(err.requestId);
  else throw err;
}
```

## Configuration

```js
new Aivana({
  apiKey: process.env.AIVANA_API_KEY,
  timeoutMs: 120_000,   // default
  apiBase: "...",       // override the API endpoint
  fetch: customFetch,   // inject your own fetch
});
```

Cancel an in-flight request with an `AbortSignal`:

```js
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000);
await client.generate("...", { signal: ac.signal });
```

## License

Apache-2.0
