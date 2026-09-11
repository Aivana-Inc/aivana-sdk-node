// Type definitions for @aivana/sdk

/** Generation is a single tier. The engine's own complexity gate decides
 *  single-model vs. multi-model panel per request — there is nothing to select. */
export type Mode = "aivana_mmi";
export type OutputShape =
  | "auto"
  | "text"
  | "recommendation"
  | "summary"
  | "tradeoffs"
  | "decision"
  | "extract";

export interface AivanaConfig {
  apiKey?: string;
  apiBase?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** An inline image for the current turn. Max 6 per request, 8 MiB each (decoded). */
export interface Attachment {
  /** One of: image/png, image/jpeg, image/webp, image/gif. */
  mimeType?: string;
  /** Accepted as an alias for `mimeType`. */
  mime_type?: string;
  /** Raw base64, or a full data: URL ("data:image/png;base64,..."). */
  data: string;
}

export interface GenerateOptions {
  mode?: Mode;
  /** Omit to let the engine pick its per-intent default. */
  temperature?: number;
  /** Ceiling on answer length. Omit to use the engine's depth-derived budget; a
   *  supplied value can only lower that budget, never raise it. */
  maxTokens?: number;
  messages?: ChatMessage[];
  /** Images for this turn only — not replayed on later turns. */
  attachments?: Attachment[];
  previousIntent?: string;
  /** The action the previous assistant turn offered, from that response's
   *  `pending_action`. Send it back so a bare "yes" resolves against what was
   *  actually proposed. `chat()` tracks this for you. */
  pendingAction?: string;
  outputShape?: OutputShape;
  metadata?: Record<string, unknown>;
  /** Your own system prompt: persona, tone, format, domain focus.
   *
   *  Additive — Aivana keeps its own instructions and they win on conflict, so this
   *  cannot change what Aivana discloses about how an answer was produced.
   *
   *  Max 8000 chars, enforced client-side. Aivana may re-send it internally more
   *  than once while answering, so a long system prompt can cost more tokens than
   *  its length alone suggests — keep it to what actually changes the answer. */
  system?: string;
  /** The name the assistant presents as ("Acme Copilot"). Renaming is all it
   *  does: which underlying models produced the answer stays undisclosable, and
   *  no instruction in `system` can unlock that. Max 64 chars. */
  assistantName?: string;
  /** Whether to ground this request in a live web search.
   *
   *  THREE states, not two:
   *    `true`     always search
   *    `false`    never search
   *    *omitted*  Aivana decides from the question (it judges whether the answer
   *               depends on fresh data)
   *
   *  Omitting it is not the same as `false`. On an API key the default is OFF, so
   *  a search only happens when you ask for one — it is never a surprise on your
   *  bill. Grounding costs extra tokens and latency, so reach for `true` on
   *  questions about current events, prices, releases or anything time-sensitive,
   *  and leave it alone otherwise. */
  webSearch?: boolean;
  /** Nucleus sampling, 0-1: consider only the most likely tokens whose
   *  probabilities add up to this. Controls randomness the same way
   *  `temperature` does, by a different mechanism, so set ONE of the two.
   *
   *  Omitting it is NOT the same as 1.0 — omitted leaves every model on its own
   *  default. `0` is legal and is the most deterministic setting there is.
   *  Where a model cannot accept both, Aivana honours `topP` and drops the
   *  temperature for that call. */
  topP?: number;
  /** Up to 4 strings. The answer ends where the first one appears, and the
   *  string itself is not returned.
   *
   *  Applied to the answer you receive, so it behaves the same on every
   *  question — but the text past the marker is still generated and still
   *  billed. This shapes output; it does not save tokens. */
  stopSequences?: string[];
  /** Ask Aivana to explain how it handled this request. Off unless you set it.
   *
   *  `resp.trace` then carries the ordered steps it went through (with
   *  timings), a summary of the route it chose, and why — for example whether a
   *  second independent perspective was engaged, and whether live sources were
   *  needed. On `generateStream` the same information arrives as `trace` chunks
   *  while the answer is being produced.
   *
   *  It describes decisions and outcomes, never which underlying models
   *  answered. */
  intelligenceTrace?: boolean;
  signal?: AbortSignal;
}

export interface IntentEnvelope {
  name: string;
  confidence: number;
  signal: string;
}

export interface UsageEnvelope {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  credits: number;
}

/** Exactly the fields /v1/generate returns. Anything absent here is absent at
 *  runtime — declaring more does not make TypeScript catch the difference, it
 *  just hands you a typed `undefined`. */
export interface GenerateResponse {
  id: string;
  answer: string;
  intent: IntentEnvelope;
  structured: Record<string, unknown> | null;
  structured_error: string | null;
  /** The Aivana model id (e.g. `["aivana-mmi"]`) — not the models behind it. */
  models_used: string[];
  usage: UsageEnvelope;
  latency_ms: number;
  finish_reason: string;
  pending_action?: string | null;
  /** Present only when `intelligenceTrace` was requested. Left untyped beyond
   *  this: the step vocabulary is the server's to evolve, and a modelled shape
   *  here would go stale the first time a step is added. */
  trace?: Record<string, unknown> | null;
}

export interface StreamChunk {
  event: string;
  data: Record<string, unknown>;
}

/** `limit` and `pending` are null when the window is unmetered — no plan sets an
 *  hourly ceiling, so `hour` reports usage only. */
export interface QuotaCounter {
  used: number;
  limit: number | null;
  pending: number | null;
}

export interface QuotaWindow {
  input_tokens: QuotaCounter;
  output_tokens: QuotaCounter;
}

export interface QuotaResponse {
  windows: {
    hour: QuotaWindow;
    day: QuotaWindow;
    month: QuotaWindow;
  };
}

/** One field the API rejected, from the `details` list on a 422. */
export interface ErrorDetail {
  loc: string[];
  msg: string;
  type: string;
}

export class AivanaError extends Error {
  code: string;
  requestId: string | null;
  status: number;
  /** Per-field validation errors on a 422 — which field is wrong, and why.
   *  Empty on every other error. */
  details: ErrorDetail[];
}
export class AuthError extends AivanaError {}
export class ForbiddenError extends AivanaError {}
export class RateLimitError extends AivanaError {}
export class InvalidRequestError extends AivanaError {}
export class UpstreamError extends AivanaError {}

export interface ChatOptions {
  mode?: Mode;
  temperature?: number;
  maxTokens?: number;
  outputShape?: OutputShape;
  assistantName?: string;
  /** Whether to ground this request in a live web search.
   *
   *  THREE states, not two:
   *    `true`     always search
   *    `false`    never search
   *    *omitted*  Aivana decides from the question (it judges whether the answer
   *               depends on fresh data)
   *
   *  Omitting it is not the same as `false`. On an API key the default is OFF, so
   *  a search only happens when you ask for one — it is never a surprise on your
   *  bill. Grounding costs extra tokens and latency, so reach for `true` on
   *  questions about current events, prices, releases or anything time-sensitive,
   *  and leave it alone otherwise. */
  webSearch?: boolean;
  /** Nucleus sampling, 0-1: consider only the most likely tokens whose
   *  probabilities add up to this. Controls randomness the same way
   *  `temperature` does, by a different mechanism, so set ONE of the two.
   *
   *  Omitting it is NOT the same as 1.0 — omitted leaves every model on its own
   *  default. `0` is legal and is the most deterministic setting there is.
   *  Where a model cannot accept both, Aivana honours `topP` and drops the
   *  temperature for that call. */
  topP?: number;
  /** Up to 4 strings. The answer ends where the first one appears, and the
   *  string itself is not returned.
   *
   *  Applied to the answer you receive, so it behaves the same on every
   *  question — but the text past the marker is still generated and still
   *  billed. This shapes output; it does not save tokens. */
  stopSequences?: string[];
  /** Ask Aivana to explain how it handled this request. Off unless you set it.
   *
   *  `resp.trace` then carries the ordered steps it went through (with
   *  timings), a summary of the route it chose, and why — for example whether a
   *  second independent perspective was engaged, and whether live sources were
   *  needed. On `generateStream` the same information arrives as `trace` chunks
   *  while the answer is being produced.
   *
   *  It describes decisions and outcomes, never which underlying models
   *  answered. */
  intelligenceTrace?: boolean;
  /** Applied to every turn. The API is stateless, so it is re-sent (and re-billed)
   *  on each turn rather than stored server-side. */
  system?: string;
}

export class Chat {
  messages: ChatMessage[];
  system?: string;
  send(content: string, opts?: GenerateOptions): Promise<GenerateResponse>;
  reset(): void;
}

export class Aivana {
  apiKey: string | null;
  apiBase: string;
  constructor(cfg?: AivanaConfig);
  /** Pass `null` for `prompt` when supplying `opts.messages` instead. */
  generate(prompt: string | null, opts?: GenerateOptions): Promise<GenerateResponse>;
  generateStream(prompt: string | null, opts?: GenerateOptions): AsyncGenerator<StreamChunk>;
  chat(opts?: ChatOptions): Chat;
  quotas(): Promise<QuotaResponse>;
}

export default Aivana;
