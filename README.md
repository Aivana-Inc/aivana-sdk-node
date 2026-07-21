# @aivana/sdk

JavaScript / TypeScript client for the [Aivana Intelligence API](https://github.com/Aivana-Inc/aivana-intelligence-api).

Requires Node.js 18 or newer (uses the built-in `fetch`). Ships with TypeScript
definitions; no runtime dependencies.

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
