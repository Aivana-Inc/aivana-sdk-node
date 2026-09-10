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
  pendingAction: previous.pending_action,
});
```

A `"system"` message in the array is lifted into the `system` field for you, so
these are equivalent:

```js
await client.generate(null, { messages: [
  { role: "system", content: "Answer in bullets." },
  { role: "user",   content: "Why did latency spike?" },
]});

await client.generate("Why did latency spike?", { system: "Answer in bullets." });
```

If you pass **both**, the explicit `system` option wins and the system message is
ignored — the two are never concatenated, because a merge order you cannot see is
worse than a rule you can.

### Limits

| | current default |
|---|---|
| Messages per request | 40 |
| Characters per message | 200,000 |
| Characters per prompt | 200,000 |

History is re-sent on every turn and **billed every turn**, because nothing is
stored server-side. On a long conversation, trim or summarise old turns rather
than replaying all 40 — it is the single biggest lever on what a chat costs.

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

## Documents (PDF, Word, Excel)

**Only images can be attached** — see above. PDF, Word and Excel files are **not**
supported; sending one throws `InvalidRequestError` rather than being silently
ignored. The message is deliberately terse ("request input was rejected") — it
tells you the request was at fault, not which type was refused, so check the list
above rather than the error text.

To ask about a document, extract its text yourself and pass that as the prompt. The
libraries below are not dependencies of this SDK — install whichever you need:

**PDF** — `npm install pdf-parse`

```js
import pdf from "pdf-parse";
const { text } = await pdf(readFileSync("report.pdf"));
```

**Word** — `npm install mammoth`

```js
import mammoth from "mammoth";
const { value: text } = await mammoth.extractRawText({ path: "contract.docx" });
```

**Excel** — `npm install xlsx`

```js
import * as XLSX from "xlsx";
const wb = XLSX.readFile("q3.xlsx");
const text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
```

Then send the text as the prompt:

```js
const res = await client.generate(
  `Summarise the three biggest risks in this document.\n\n${text}`,
  { system: "Quote the passage each risk comes from." },
);
```

Two things worth doing:

- **Send text, not markup.** Stripped text costs far fewer tokens than raw HTML or
  XML, and answers are usually better for it.
- **Watch the size.** A long document can approach the 200,000-character prompt
  limit. For a large file, extract the relevant sections rather than the whole
  thing — every character is billed.

A scanned PDF with no text layer extracts to nothing. Render those pages to PNG and
send them as image attachments instead.

## Options

Every option is optional. Omitting one is not a gap to fill in — it hands the
decision to Aivana, which tunes temperature, answer length and web search per
question. Pass a value when you specifically need to override that.

| option | type | default when omitted |
|---|---|---|
| `system` | string | no persona — Aivana's own voice |
| `assistantName` | string | the assistant does not name itself |
| `webSearch` | boolean | Aivana decides from the question |
| `temperature` | 0.0–2.0 | chosen per request |
| `topP` | 0.0–1.0 | each model's own default |
| `stopSequences` | string[] | none — the answer ends naturally |
| `maxTokens` | integer | sized to the question |
| `outputShape` | see below | `"auto"` |
| `messages` | array | single-turn |
| `attachments` | array | none |

All of them work the same on `generate()`, `generateStream()` and `chat()`.

## Give the assistant a persona

`system` is your own instructions — tone, format, domain, things to refuse:

```js
const res = await client.generate("A customer wants a refund after 40 days.", {
  system: "You are a support lead for a UK retailer. Answer in three short "
        + "bullets. Cite the policy rule you applied. Never promise a refund "
        + "outside policy.",
});
```

`assistantName` sets the name it presents as:

```js
const res = await client.generate("Who are you?", {
  assistantName: "Acme Copilot",
});
// → "I'm Acme Copilot..."
```

Use `assistantName` rather than writing "your name is Acme" inside `system`. A
name asked for in a system prompt is only a request the model may or may not
honour — we measured roughly one time in three. `assistantName` is substituted
before the model sees anything, so it always holds.

Two things to know:

**`system` is additive, not a replacement.** Aivana keeps its own instructions
and they win on conflict. You can shape persona, tone, format and domain focus —
you cannot use it to make Aivana reveal which underlying models produced an
answer, and no instruction in `system` unlocks that.

**Keep it short.** Aivana may re-send your system prompt internally more than once
while answering, so a long persona costs more tokens than its length suggests.
Include what changes the answer and nothing else. The 8000-character limit is
checked client-side, so an oversized prompt throws before the round trip.

## Web search

### Randomness: `temperature` or `topP`, not both

Both control how varied an answer is; they just do it differently. `temperature`
reshapes the whole probability distribution, `topP` narrows the pool to the most
likely tokens whose probabilities add up to your value.

```js
await client.generate("Extract the invoice number", { topP: 0.1 });      // tight
await client.generate("Ten campaign taglines", { temperature: 1.2 });    // varied
```

Set **one** of the two. Sending both is accepted, but you are then steering the
same thing with two dials and the result is harder to reason about — and for some
questions Aivana cannot pass both through, in which case `topP` wins and the
temperature is dropped for that call.

`topP: 0` is legal and is the most deterministic setting there is. Omitting the
option is **not** the same as `1`: omitted leaves the choice to Aivana.

### Stop sequences

Up to four strings. The answer ends where the first one appears, and the string
itself is not returned.

```js
await client.generate("Answer, then stop.", { stopSequences: ["###", "\n\nUser:"] });
```

Useful when you are parsing the answer and know its end marker. Two things to
know: it shapes the output you receive, so it behaves the same on every question
— and the text past the marker is still generated and still billed, so this is not
a way to spend less.

`webSearch` has **three** states, and the third is the useful one:

```js
await client.generate("What did the EU AI Act change in August?", { webSearch: true });
await client.generate("Explain how quicksort works",              { webSearch: false });
await client.generate("Is our pricing still competitive?");        // Aivana decides
```

| value | behaviour |
|---|---|
| `true` | always search the web before answering |
| `false` | never search |
| *omitted* | Aivana judges whether the question depends on fresh data |

**Omitting it is not the same as `false`.** Omitted means "decide for me"; `false`
means "definitely don't". They are different requests.

On an API key the default is **off** — a search never happens unless you ask for
one, so it can't turn up unannounced on your bill. Grounding costs extra tokens
and latency, so reach for `true` on current events, prices, releases, competitors
and anything else that dates; leave it off for reasoning, code, writing and
explanation, which don't improve with a web lookup.

## Temperature and length

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

## Recipes

**A support assistant that never searches the web.** Persona and search policy are
fixed for the whole conversation, so set them once on `chat()`:

```js
const support = client.chat({
  assistantName: "Acme Support",
  system: "You are a support lead for Acme. Three bullets maximum. "
        + "If the answer isn't in policy, say so and offer to escalate.",
  webSearch: false,     // answers come from policy, not the open web
  temperature: 0.2,     // consistent phrasing across tickets
});

await support.send("Customer wants a refund after 40 days.");
await support.send("They're now threatening a chargeback.");   // remembers the above
```

**A research assistant that always searches**, overriding per turn where it doesn't
need to:

```js
const research = client.chat({ webSearch: true });

await research.send("What are Anthropic's current enterprise pricing tiers?");
await research.send("Summarise that as a table", { webSearch: false });  // no lookup needed
```

Options set on `chat()` apply to every turn; options passed to `send()` win for
that turn only.

**Structured output you can parse.** Combine a low temperature with `outputShape`:

```js
const res = await client.generate(transcript, {
  outputShape: "extract",
  temperature: 0,
  system: "Return only the fields asked for. Use null when a field is absent.",
});

console.log(res.structured);        // parsed object, or null
console.log(res.structured_error);  // why parsing failed, if it did
```

**Streaming with a persona.** Options behave identically on the streaming call:

```js
const stream = client.generateStream("Explain our outage to a customer.", {
  assistantName: "Acme Copilot",
  system: "Plain language. No blame. Lead with impact, then the fix.",
  maxTokens: 300,
});

for await (const chunk of stream) {
  if (chunk.event === "delta") process.stdout.write(chunk.data.text);
}
```

**One-off overrides on a configured client.** Because per-call options win, one
client can serve several behaviours:

```js
const base = { assistantName: "Acme Copilot", system: HOUSE_STYLE };

const quick = await client.generate(q, { ...base, maxTokens: 150 });
const deep  = await client.generate(q, { ...base, webSearch: true });
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
