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
  structured: null,           // your validated object when you pass `responseFormat`
  latency_ms: 8421,
  finish_reason: "stop"
}
```

## Command line

For the terminal there is an `aivana` command, published as
[`@aivana/cli`](cli/README.md):

```bash
npm install -g @aivana/cli     # or run it without installing: npx @aivana/cli "..."
export AIVANA_API_KEY=ai_live_xxx  # Windows PowerShell: $env:AIVANA_API_KEY = "ai_live_xxx"
git diff | aivana "Review this change" --effort high
```

It is built on this SDK and ships inside it as `@aivana/sdk/cli`, so the two are
released together. The Python SDK installs the same command, and both pass one
shared conformance suite, [`conformance/cli.json`](conformance/cli.json), so they
behave identically.

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
| `trace` | an Intelligence Trace step, when `intelligenceTrace: true` |
| `done` | finished — carries `usage` and `finish_reason` |
| `error` | something failed upstream |

A `responseFormat` of type `json_schema` cannot be streamed: see
[Structured output](#structured-output-your-own-json-schema).

## Structured output (your own JSON Schema)

Pass a JSON Schema and get back an answer that validates against it, or an error.
You never get malformed data with a success status.

```js
const schema = {
  type: "object",
  properties: {
    vendorName: { type: "string" },
    total: { type: "number" },
  },
  required: ["vendorName", "total"],
  additionalProperties: false,
};

const res = await client.generate(
  "Extract the invoice: Acme Ltd, total due 1,250.00",
  { responseFormat: { type: "json_schema", schema } },
);

res.structured;   // { vendorName: "Acme Ltd", total: 1250 }, validated
res.answer;       // the same object as compact JSON
```

- **Your schema is sent exactly as you wrote it.** Property names are not re-cased
  or re-ordered, even though the rest of this SDK's options map to the API's
  snake_case.
- **The root must be an object.** Aivana accepts a bounded subset of JSON Schema.
  A keyword it does not support is refused up front, never silently ignored.
- **It is answered whole, not streamed**, because the answer is checked against your
  schema before any of it is sent. It also cannot be combined with `stopSequences`
  or `continue`. `maxTokens` still works: a cap too small to hold a valid object
  ends as a failed run, below.
- **Two errors, with their own `code`:**

  ```js
  import { InvalidRequestError, UpstreamError } from "@aivana/sdk";

  try {
    await client.generate("...", { responseFormat: { type: "json_schema", schema } });
  } catch (err) {
    if (err instanceof InvalidRequestError && err.code === "invalid_response_schema") {
      // your schema uses something Aivana does not support: fix it
    } else if (err instanceof UpstreamError && err.code === "structured_output_failed") {
      // Aivana could not produce a conforming answer
    } else throw err;
  }
  ```

  A run that ends in `structured_output_failed` is **not billed**. Retrying is your
  decision: it costs time, and a second attempt is billed only if it succeeds.
- **Billing.** The schema counts once, as input tokens, however Aivana answers. A
  successful run is billed the same whether or not it needed a second try.
- **Upgrade first.** An older version of this SDK does not know `responseFormat`
  and drops it silently, so the request would run without your schema.

`{ type: "text" }` is the ordinary answer. `responseFormat` is a different thing
from `outputShape`: the presets ask for a shape and do not guarantee it (`structured`
may be `null`); `responseFormat` guarantees it or throws.

## Conversation history

The Generate API is stateless: each request stands alone. To ask a follow-up, you
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

## Resuming a cut-off answer

Aivana sizes its own output budget per question, so this should be rare — but if a
response ever ends with `finish_reason: "length"` (a real provider cutoff, not just
a long answer), ask it to continue instead of starting a new turn:

```js
const chat = client.chat();
const first = await chat.send("Write the full incident postmortem.");

if (first.finish_reason === "length") {
  const more = await chat.continue();   // resumes exactly where it stopped
  console.log(more.answer);             // just the continuation text
}
```

`chat.continue()` resends the existing history with the previous (truncated)
assistant turn as-is and appends the new text onto it in place — `chat.messages`
ends up with one complete answer, not two turns, so the next `send()` sees normal
history. It requires a prior `send()` whose answer is still the last message.

Managing history yourself? Pass `continue: true` directly, alongside `messages`
ending on the truncated assistant turn:

```js
const more = await client.generate(null, { messages, continue: true });
```

Only set this when you actually mean to resume a cutoff — it's never inferred from
what a message says, and using it without a truncated answer in `messages` gives
the engine nothing to continue from.

## Files and documents

Attach up to **5 files** to a request, in any mix, **40 MiB** in all — chart
screenshots, diagrams, contracts, reports, spreadsheets exported as CSV:

```js
import { readFileSync } from "node:fs";

const res = await client.generate("Summarise the three biggest risks in this contract.", {
  attachments: [
    { mimeType: "application/pdf", data: readFileSync("contract.pdf").toString("base64") },
  ],
});
```

`data` takes raw base64 or a full data URL (`data:image/png;base64,...`) — both work.

| kind | `mimeType` | limit |
|---|---|---|
| Images | `image/png`, `image/jpeg`, `image/webp`, `image/gif` | 8 MiB each |
| PDF | `application/pdf` | 10 MiB each; 150 pages in all |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`) | 10 MiB each |
| CSV | `text/csv` | 10 MiB each |

Word and CSV text together can't exceed 400,000 characters per request. A file that
can't be read (an encrypted PDF or Word document, an old `.doc` file, a CSV that
isn't text) is rejected with an error that says why, and which file. Excel
workbooks aren't supported; export the sheet as CSV. Send two or more documents to
compare them; answers say which document each point comes from.

Files are billed as input tokens and included in `usage.input_tokens`: an image
counts as up to 1,534 tokens, a PDF as 2,300 a page, and a Word or CSV file as one
token per 4 characters of its text.

The `aivana` command is narrower than the API: `--image` attaches images only.

Files attach to the **current turn only** and are never replayed on later turns.
If a follow-up question is about the same file, send it again:

```js
const chat = client.chat();
await chat.send("What's wrong with this architecture?", {
  attachments: [{ mimeType: "image/png", data: diagramB64 }],
});
await chat.send("How would you fix the bottleneck?", {
  attachments: [{ mimeType: "image/png", data: diagramB64 }],   // resend
});
```


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

## More options

Every option is optional, and every entry point (`generate()`, `generateStream()`
and `chat()`) accepts all of them. Omitting one hands that decision to Aivana.

| option | type | when omitted |
|---|---|---|
| `webSearch` | boolean | no search: the default for API keys |
| `effort` | `"auto"` \| `"low"` \| `"medium"` \| `"high"` | `"auto"`: Aivana judges from the question |
| `intelligenceTrace` | boolean | no trace |
| `assistantName` | string | the assistant does not name itself |
| `stopSequences` | up to 4 strings | the answer ends naturally |
| `responseFormat` | `{ type: "json_schema", schema }` \| `{ type: "text" }` | an ordinary answer. See [Structured output](#structured-output-your-own-json-schema) |

**`webSearch`**: `true` always searches, `false` never does. Left out, the API's
default applies, and for an API key that is no search, so a search never turns up on
your bill unannounced. `false` stays "never" even if that default changes.

A request that searches the web is charged every token used to answer it, not just
your prompt and the answer, so it uses more tokens than the same question without
search. If your balance can't cover a search, the request is refused with a 402 that
says so.

If a question asks for the web ("search the web for…", a link to read) while search
is off, the answer is written without searching, and `res.notices` says so. The list
is always present, and each message is safe to show to your own users:

```js
const res = await client.generate("Search the web for today's EU AI Act news");
for (const notice of res.notices) console.log(notice.code, notice.message); // web_search_off ...
```

Set `webSearch: true` to allow the search.

**`effort`** is a ceiling on how much intelligence Aivana may apply: `"low"` sets a
lower reasoning ceiling and can reduce latency on simpler tasks, `"medium"` a middle
one, and `"high"` allows deeper reasoning for more demanding tasks. It bounds
Aivana's judgement rather than replacing it, with no guaranteed number of models or
perspectives. It is not a length control (use `maxTokens` for that) and not a price
setting: pricing is based on the tokens in your request and response.

```js
await client.generate("What's the default port for Postgres?", { effort: "low" });
await client.generate("Should we move billing off Stripe?", { effort: "high", webSearch: true });
```

**`intelligenceTrace: true`** adds `trace` to the response: the steps Aivana took,
with timings, the route it chose and why. On a stream the same arrives as `trace`
events. It describes decisions and outcomes, never which models answered.

**`assistantName`** sets the name the assistant presents as. Prefer it to writing
"your name is Acme" into `system`: it is applied before any model sees the prompt,
so it always holds.

Options given to `chat()` apply to every turn, and options given to `send()` win for
that turn:

```js
const support = client.chat({ assistantName: "Acme Support", webSearch: false });
await support.send("Customer wants a refund after 40 days.");
await support.send("What does the law say now?", { webSearch: true });
```

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
| `InvalidRequestError` | malformed request (400), or a response schema Aivana refuses (422, `code` `invalid_response_schema`) |
| `UpstreamError` | model provider failed (502), or no answer met your response schema (`code` `structured_output_failed`, not billed) |

A validation error (HTTP 422, an `InvalidRequestError`) also carries `details`: one
`{ loc, msg }` per field that was wrong, e.g. `loc: ["body", "temperature"]`.

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
