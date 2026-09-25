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

/** How much intelligence to spend. `"auto"` (the default) lets Aivana judge from the
 *  question; `"low"` is the fastest, cheapest path; `"medium"` compares two
 *  independent perspectives; `"high"` engages three or more. A bound on Aivana's own
 *  judgement, not a length control — use `maxTokens` for that. */
export type Effort = "auto" | "low" | "medium" | "high";

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
  /** The `pending_action` from the previous response, so a bare "yes" resolves
   *  against what was actually offered. `chat()` passes it for you. */
  pendingAction?: string;
  outputShape?: OutputShape;
  metadata?: Record<string, unknown>;
  /** The name the assistant presents as ("Acme Copilot"). Substituted before any
   *  model sees the prompt, so it always holds — unlike a name asked for in
   *  `system`. Renaming is all it does. */
  assistantName?: string;
  /** THREE states: `true` always searches the web first, `false` never does, and
   *  omitting it lets Aivana judge whether the question needs fresh data. Omitted is
   *  not the same as `false`. On an API key the default is off. */
  webSearch?: boolean;
  /** How much intelligence to spend on this request. */
  effort?: Effort;
  /** Ask Aivana to explain how it handled the request: the response's `trace`, or
   *  `trace` events on a stream. Off unless set. Describes decisions and outcomes,
   *  never which underlying models answered. */
  intelligenceTrace?: boolean;
  /** Nucleus sampling, 0.0–1.0. Controls randomness like `temperature` does, by a
   *  different mechanism, so set one or the other. `0` is legal and is sent. */
  topP?: number;
  /** Up to four strings; the answer ends where the first one appears, and the
   *  string itself is not returned. The text past it is still generated and billed. */
  stopSequences?: string[];
  /** Your own system prompt: persona, tone, format, domain focus.
   *
   *  Additive — Aivana keeps its own instructions and they win on conflict, so this
   *  cannot change what Aivana discloses about how an answer was produced.
   *
   *  Max 8000 chars, enforced client-side. Aivana may re-send it internally more
   *  than once while answering, so a long system prompt can cost more tokens than
   *  its length alone suggests — keep it to what actually changes the answer. */
  system?: string;
  /** Resume an answer cut off by a real provider length limit
   *  (`finish_reason === "length"`) instead of starting a new turn.
   *
   *  Only takes effect when explicitly `true` — never inferred from message
   *  content — and only makes sense paired with `messages` ending on the
   *  truncated assistant turn, so the engine knows what to continue. Prefer
   *  `chat().continue()`, which manages the history for you; set this directly
   *  only when you manage history yourself. Rare in practice: Aivana sizes its
   *  own output budget, so this is for the occasional hard cutoff, not a normal
   *  path to longer answers. */
  continue?: boolean;
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
  /** The Intelligence Trace when `intelligenceTrace: true` was requested, otherwise
   *  null: the ordered steps with timings, a summary of the route chosen, and why.
   *  A plain object on purpose — the step vocabulary is the server's to evolve. */
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

/** One entry of a 422's per-field validation list. */
export interface ErrorDetail {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
}

export class AivanaError extends Error {
  code: string;
  requestId: string | null;
  status: number;
  /** Which fields were wrong, on a validation error (422). Empty otherwise. */
  details: ErrorDetail[];
}
export class AuthError extends AivanaError {}
export class ForbiddenError extends AivanaError {}
export class RateLimitError extends AivanaError {}
export class InvalidRequestError extends AivanaError {}
export class UpstreamError extends AivanaError {}

/** Every generation option, applied to every turn; a `send()`'s own options win for
 *  that turn. The API is stateless, so all of it — a `system` persona included — is
 *  re-sent (and re-billed) on each turn rather than stored server-side. */
export type ChatOptions = Omit<
  GenerateOptions,
  "messages" | "previousIntent" | "pendingAction" | "continue" | "signal"
>;

export class Chat {
  messages: ChatMessage[];
  options: ChatOptions;
  readonly system?: string;
  send(content: string, opts?: GenerateOptions): Promise<GenerateResponse>;
  /** Resume the last answer after a real provider cutoff
   *  (`finish_reason === "length"`). Requires the last turn in history to be
   *  the truncated assistant answer — call `send()` first. Appends the
   *  continuation onto that message in place rather than adding a new turn. */
  continue(opts?: GenerateOptions): Promise<GenerateResponse>;
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
