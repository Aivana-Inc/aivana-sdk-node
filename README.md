# @aivana/sdk

JavaScript / TypeScript client for the [Aivana Intelligence API](https://github.com/Aivana-Inc/aivana-intelligence-api).

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

const client = new Aivana({
  apiKey: process.env.AIVANA_API_KEY,
  apiBase: "https://developers.aivana.ai",
});

const res = await client.generate("Summarise our Q3 churn drivers.");
console.log(res.answer);
```

`apiBase` defaults to `http://localhost:8088` for local development — point it at
your deployment when running against a real environment.

## Generation options

Both generation options are **optional, and omitting them is the recommended
default.** Aivana routes each request across one or more models and picks a
temperature and an output budget suited to the question. Passing a value opts out
of that per-request tuning, so pass one only when you specifically need to.

```js
const res = await client.generate("Draft a launch plan.", {
  temperature: 0.2,   // omit → engine picks per intent
  maxTokens: 500,     // omit → engine sizes the answer to the question
});
```

`temperature` accepts `0.0`–`2.0`. Lower is more deterministic, higher more varied.

`maxTokens` is a **ceiling, not a target.** It can only shorten an answer — it will
never raise the engine's own model-aware limit, so a very large value has no effect.
When you do lower it, the engine shortens what it aims to write rather than letting
a full-length answer get cut off mid-sentence.

Both options work the same way on `generateStream()` and `chat()`.

## Streaming

`generateStream` is an async generator over server-sent events:

```js
for await (const chunk of client.generateStream("Draft a launch plan.")) {
  if (chunk.event === "delta") process.stdout.write(chunk.data.text);
}
```

## Multi-turn chat

`chat()` keeps the message history for you:

```js
const chat = client.chat({ outputShape: "recommendation" });
await chat.send("We're choosing between Postgres and DynamoDB.");
await chat.send("What changes if write volume triples?");
chat.reset();
```

## Quotas

```js
const { plan, limits, counters } = await client.quotas();
```

## Errors

Every failure throws a subclass of `AivanaError`, each carrying `code`,
`status`, and `requestId`:

`AuthError` · `ForbiddenError` · `RateLimitError` · `InvalidRequestError` · `UpstreamError`

```js
import { RateLimitError } from "@aivana/sdk";

try {
  await client.generate("...");
} catch (err) {
  if (err instanceof RateLimitError) await backoff(err.requestId);
  else throw err;
}
```

## License

Apache-2.0
