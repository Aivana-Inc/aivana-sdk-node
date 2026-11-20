// @aivana/sdk — JavaScript / TypeScript client for the Aivana Intelligence API.
//
// Quickstart:
//   import { Aivana } from "@aivana/sdk";
//   const aivana = new Aivana({ apiKey: "ai_live_..." });
//   const r = await aivana.generate("Should we enter the EU market?");
//   console.log(r.answer);
//
// Streaming:
//   for await (const chunk of aivana.generateStream("Explain CAP theorem")) {
//     if (chunk.event === "delta") process.stdout.write(chunk.data.text);
//   }
//
// Your own system prompt (persona / tone / format / domain focus):
//   await aivana.generate("Summarize this contract", {
//     system: "You are a tax specialist. Answer in bullets. Never give legal advice.",
//   });
//   const chat = aivana.chat({ system: "You are a tax specialist." });  // every turn
//
// The SDK is fetch-only and needs no build step — it runs on Node 18+, Deno, Bun,
// and edge runtimes.
//
// SERVER-SIDE ONLY. Authentication is a long-lived API key, so this client belongs
// on a server you control. Anything shipped to a browser — bundled app, edge
// function that echoes its config — exposes the key to every visitor via devtools
// or the network tab, and a leaked key is usable until you revoke it. To call
// Aivana from a browser, proxy through your own backend and keep the key there.

// Production API. It was `developers.aivana.ai` until 2026-10-11, when that name
// became AI Studio (the website); the API moved to its own host so the two never
// share one. Releases up to 0.7.0 default to the old name. Callers who want dev
// must pass `apiBase` explicitly.
const DEFAULT_BASE = "https://api.aivana.ai";
const DEFAULT_TIMEOUT_MS = 120_000;
// Automatic retries. Only a per-minute rate limit is ever retried (see _retryDelayMs): the
// API refuses those before it does any work, so asking again cannot bill twice. Anything
// else, a timeout, a 5xx, a dropped connection, may have been billed, and is never repeated
// behind the caller's back.
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_WAIT_MS = 30_000;
// Your own system prompt is ADDITIVE: Aivana keeps its own instructions and they
// win on conflict, so `system` shapes persona, tone, format and domain focus but
// cannot change what Aivana will disclose about how an answer was produced.
//
// Aivana may also re-send it internally more than once while answering, so a long
// system prompt can cost more tokens than its length alone suggests. Checked here
// so an oversized prompt fails at the call site instead of after a round trip.
const MAX_SYSTEM_CHARS = 8000;


/** Custom error mirroring the engine's error envelope shape. */
export class AivanaError extends Error {
  constructor(message, { code = "internal_error", requestId = null, status = 0, details = [] } = {}) {
    super(message);
    this.name = "AivanaError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    // The API's per-field validation list on a 422: [{ loc, msg, type }]. It is the
    // only part of the error that says WHICH field is wrong, so it is kept rather
    // than collapsed into the one-line message. Empty for every other error, and
    // the same field the Python SDK's errors carry.
    this.details = details;
  }
}
export class AuthError extends AivanaError { constructor(m, o) { super(m, o); this.name = "AuthError"; } }
export class RateLimitError extends AivanaError {
  constructor(m, o = {}) {
    super(m, o);
    this.name = "RateLimitError";
    // How long the API said to wait, in SECONDS (its Retry-After), or null when it did not
    // say. Several developers behind one office or campus network share the API's
    // per-address allowance, so this is how long until it frees up, not a fixed penalty.
    this.retryAfter = o.retryAfter ?? null;
  }
}
export class ForbiddenError extends AivanaError { constructor(m, o) { super(m, o); this.name = "ForbiddenError"; } }
export class InvalidRequestError extends AivanaError { constructor(m, o) { super(m, o); this.name = "InvalidRequestError"; } }
export class UpstreamError extends AivanaError { constructor(m, o) { super(m, o); this.name = "UpstreamError"; } }


const REQUEST_MISTAKE_CODES = new Set([
  "invalid_request", "invalid_response_schema", "response_format_not_available",
  "structured_output_streaming_not_supported",
]);

// Retry-After is whole seconds or an HTTP date. Anything else, a negative number or text,
// is treated as "not said", never as a wait.
function _parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  // Date.parse is lenient (it reads "-5" as a year), and a real HTTP date always has a month name.
  if (!/[A-Za-z]{3}/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, (at - now) / 1000);
}

function _classify(status, payload, retryAfter = null) {
  const err = (payload && payload.error) || {};
  const opts = {
    code: err.code || "internal_error",
    requestId: err.request_id || null,
    status,
    details: Array.isArray(err.details) ? err.details : [],
  };
  const msg = err.message || `request failed (HTTP ${status})`;
  if (status === 401 || opts.code === "auth") return new AuthError(msg, opts);
  if (status === 403 || opts.code === "forbidden") return new ForbiddenError(msg, opts);
  if (status === 429 || opts.code === "rate_limit_exceeded") {
    // The header is the API's own word; the body's retry_after_ms is the fallback for routes
    // that put it there instead.
    let wait = retryAfter;
    if (wait === null && typeof err.retry_after_ms === "number" && err.retry_after_ms >= 0) {
      wait = err.retry_after_ms / 1000;
    }
    return new RateLimitError(msg, { ...opts, retryAfter: wait });
  }
  // A schema the API refuses, a strict schema asked to stream, and a strict schema asked of
  // an environment that does not serve it (`response_format_not_available`: nothing is
  // wrong with the schema) are the caller's request to fix like any other 422: codes of their own so a caller can tell them
  // apart (`.code`), the same class so one `instanceof InvalidRequestError` covers
  // every request mistake. Mirrors from_error_payload() in the Python SDK.
  if (status === 400 || REQUEST_MISTAKE_CODES.has(opts.code)) {
    return new InvalidRequestError(msg, opts);
  }
  if (status === 502 || opts.code === "upstream") return new UpstreamError(msg, opts);
  return new AivanaError(msg, opts);
}

// Redirects are never followed (`redirect: "manual"` on every fetch). fetch drops
// only `Authorization` when a redirect crosses to another host, not a custom
// header, so following one would hand X-API-Key to wherever the Location points.
// A 3xx is reported instead, and the key only ever goes to the configured apiBase.
function _isRedirect(resp) {
  return resp.type === "opaqueredirect" || (resp.status >= 300 && resp.status < 400);
}

async function _errorFrom(resp, hasKey) {
  if (_isRedirect(resp)) {
    const status = resp.status ? ` (HTTP ${resp.status})` : "";
    return new AivanaError(
      `the API answered with a redirect${status}, which the SDK does not follow so ` +
      "your API key is only sent to the host you configured. Set apiBase to the " +
      "API's final URL.",
      { code: "redirect", status: resp.status },
    );
  }
  let payload = null;
  try { payload = await resp.json(); } catch { /* fall through */ }
  const header = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
  const err = _classify(resp.status, payload, _parseRetryAfter(header));
  // A request with no key is still sent (a caller's own proxy may add one), so the
  // missing key is only named here, once the API has refused it.
  if (err instanceof AuthError && !hasKey) {
    err.message += " No API key was set: pass one as new Aivana({ apiKey: " +
                   "process.env.AIVANA_API_KEY }).";
  }
  return err;
}

// A 200 whose body is not JSON (a proxy's HTML page, a truncated body) is an
// AivanaError like every other failure, not a bare SyntaxError from resp.json().
async function _json(resp) {
  try {
    return await resp.json();
  } catch {
    throw new AivanaError(`the API sent a response that is not valid JSON (HTTP ${resp.status}).`,
                          { code: "invalid_response", status: resp.status });
  }
}


// A strict schema is answered whole, so it cannot be streamed: the answer is
// checked against the schema before any of it is sent, which a stream cannot wait
// for. The API refuses it too, with this same code; refusing here saves the round
// trip and fails the same way in both SDKs. (generateStream is an async generator,
// so this throws when the stream is first read.)
function _refuseStrictStream(body) {
  const fmt = body.response_format;
  if (fmt && typeof fmt === "object" && fmt.type === "json_schema") {
    throw new InvalidRequestError(
      "A responseFormat of type json_schema cannot be streamed: its answer is " +
      "checked against your schema before it is sent. Call generate() instead, " +
      "or drop responseFormat.",
      { code: "structured_output_streaming_not_supported" },
    );
  }
}


function _checkRetries(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidRequestError(`${name} must be a whole number, 0 or more.`, { code: "invalid_request" });
  }
}

function _checkRetryWait(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidRequestError("maxRetryWaitMs must be a number of milliseconds, 0 or more.",
                                  { code: "invalid_request" });
  }
}

// How long to wait before asking again, in ms, or null for "do not retry". Only a per-minute
// rate limit qualifies. A quota or spend limit is also a 429, but it clears in hours or at
// the next period, so retrying it is wasted time (its own code says which it is). A timeout,
// a 5xx or a dropped connection is never retried: the work may have been done and billed,
// and asking again could bill it twice.
function _retryDelayMs(err, attempt, maxRetries, maxWaitMs) {
  if (!(err instanceof RateLimitError) || err.code !== "rate_limit_exceeded") return null;
  if (attempt >= maxRetries) return null;
  const base = err.retryAfter !== null && err.retryAfter !== undefined
    ? err.retryAfter * 1000
    : Math.min(1000 * 2 ** attempt, maxWaitMs);
  if (base > maxWaitMs) return null;
  // Everyone behind one address is told the same wait, so spread them a little: a room of
  // developers retrying in the same instant would hit the limit together again.
  const jitter = Math.random() * Math.min(base * 0.25, 1000);
  return Math.min(base + jitter, maxWaitMs);
}


/** Main client class. */
export class Aivana {
  /**
   * @param {object} cfg
   * @param {string} [cfg.apiKey]   — X-API-Key for server-to-server use.
   * @param {string} [cfg.apiBase]  — API base URL. Defaults to the hosted API.
   * @param {number} [cfg.timeoutMs] — Per-request timeout in ms.
   * @param {number} [cfg.maxRetries] — How many times to ask again after a per-minute rate
   *   limit (default 2; 0 turns it off). Nothing else is ever retried automatically.
   * @param {number} [cfg.maxRetryWaitMs] — The longest single wait before such a retry, in ms
   *   (default 30000). A longer wait is not taken: the RateLimitError is thrown instead.
   * @param {object} [cfg.fetch]    — Custom fetch (e.g. for testing).
   */
  constructor({ apiKey = null, apiBase = DEFAULT_BASE, timeoutMs = DEFAULT_TIMEOUT_MS,
                maxRetries = DEFAULT_MAX_RETRIES, maxRetryWaitMs = DEFAULT_MAX_RETRY_WAIT_MS,
                fetch: fetchImpl = null } = {}) {
    _checkRetries(maxRetries, "maxRetries");
    _checkRetryWait(maxRetryWaitMs);
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.maxRetryWaitMs = maxRetryWaitMs;
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  _headers(extra = {}) {
    const h = { "Content-Type": "application/json", ...extra };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  _body({ prompt, mode = "aivana_mmi", temperature, maxTokens, messages, previousIntent,
          pendingAction, outputShape, metadata, attachments, system, assistantName,
          webSearch, topP, stopSequences, intelligenceTrace, effort, responseFormat,
          continue: continueFlag }) {
    const b = { mode };
    if (prompt) b.prompt = prompt;
    if (system != null && String(system).trim() !== "") {
      const s = String(system);
      if (s.length > MAX_SYSTEM_CHARS) {
        throw new InvalidRequestError(
          `system prompt is ${s.length} chars; the maximum is ${MAX_SYSTEM_CHARS}. ` +
          "Keep it to the persona, format and constraints that actually change " +
          "the answer.",
          { code: "invalid_request" },
        );
      }
      b.system = s;
    }
    if (messages) b.messages = messages;
    if (previousIntent) b.previous_intent = previousIntent;
    if (pendingAction) b.pending_action = pendingAction;
    if (outputShape) b.output_shape = outputShape;
    // Renaming is all it does: which underlying models answered stays undisclosable.
    if (assistantName) b.assistant_name = assistantName;
    // `continue` rides inside `metadata` rather than as its own top-level field.
    // The API's request model already forwards `metadata` to the engine
    // untouched, and the engine already treats `metadata.continue` as an
    // explicit continuation signal — so this needs no server-side change on
    // either side, just this client folding the flag into the object it was
    // already sending.
    if (continueFlag) b.metadata = { ...(metadata || {}), continue: true };
    else if (metadata) b.metadata = metadata;
    // Images for THIS turn. Accepts { mimeType, data } and sends the wire's
    // snake_case. `data` may be raw base64 or a full data: URL — the server
    // accepts both. Attachments are per-turn and are never replayed on later
    // turns, so a follow-up question about the same image must resend it.
    if (attachments && attachments.length) {
      b.attachments = attachments.map((a) => ({
        mime_type: a.mimeType ?? a.mime_type,
        data: a.data,
      }));
    }
    // Generation params are OMITTED unless the caller set one. Sending a
    // client-side default here would make "I didn't choose" indistinguishable
    // from "I chose this value", and would permanently override the values
    // Aivana picks for each request.
    if (temperature !== undefined && temperature !== null) b.temperature = temperature;
    if (maxTokens !== undefined && maxTokens !== null) b.max_tokens = maxTokens;
    // Web search is THREE-state, so `false` has to reach the wire: it means "never
    // search this request", a different instruction from an absent field ("apply
    // the default"). A truthiness check would silently discard every opt-out.
    if (webSearch !== undefined && webSearch !== null) b.web_search = Boolean(webSearch);
    // `!= null` for the same reason, though for a different value: topP 0 is legal
    // and is the most deterministic setting the parameter has.
    if (topP !== undefined && topP !== null) b.top_p = Number(topP);
    if (stopSequences && stopSequences.length) b.stop_sequences = stopSequences.map(String);
    // Sent only when set. An explicit false is still sent: the server treats it as
    // omitted, but echoing the caller's own choice is easier to reason about.
    if (intelligenceTrace !== undefined && intelligenceTrace !== null) {
      b.intelligence_trace = Boolean(intelligenceTrace);
    }
    // Normalised so "High" and "high" are one request, not two.
    if (effort) b.effort = String(effort).trim().toLowerCase();
    // `{ type: "json_schema", schema: {...} }` asks for an answer that validates
    // against the caller's own JSON Schema, or an explicit error: never malformed
    // data with a 200. The SCHEMA IS SENT EXACTLY AS GIVEN: its keys are the
    // caller's own field names, so nothing here may re-case or reorder them (this
    // is the one place a snake_case conversion would do damage), and which
    // keywords Aivana supports is the API's to decide, not this client's. Only the
    // wrapper is copied, so the caller's object is never mutated.
    if (responseFormat !== undefined && responseFormat !== null) {
      if (typeof responseFormat !== "object" || Array.isArray(responseFormat)) {
        throw new InvalidRequestError(
          'responseFormat must be an object like { type: "json_schema", schema: {...} }.',
          { code: "invalid_request" },
        );
      }
      b.response_format = { ...responseFormat };
    }
    return b;
  }

  // Waits, and stops early if the caller aborts: an abort during the wait ends the call as an
  // abort does anywhere else, with no further request.
  _sleep(ms, signal = null) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      const timer = setTimeout(() => { if (signal) signal.removeEventListener("abort", onAbort); resolve(); }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async _retrying(attemptOnce, { signal = null, maxRetries = this.maxRetries } = {}) {
    _checkRetries(maxRetries, "maxRetries");
    for (let attempt = 0; ; attempt++) {
      try {
        return await attemptOnce();
      } catch (err) {
        const wait = _retryDelayMs(err, attempt, maxRetries, this.maxRetryWaitMs);
        if (wait === null) throw err;
        await this._sleep(wait, signal);
      }
    }
  }

  async _post(path, body, { stream = false, signal = null, maxRetries = this.maxRetries } = {}) {
    return this._retrying(() => this._postOnce(path, body, { stream, signal }), { signal, maxRetries });
  }

  async _postOnce(path, body, { stream = false, signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const userSignal = signal;
    const onUserAbort = () => controller.abort();
    if (userSignal) userSignal.addEventListener("abort", onUserAbort, { once: true });

    try {
      const resp = await this._fetch(this.apiBase + path, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
        // The SDK authenticates via X-API-Key. Don't pick up browser
        // session cookies — that path is for the cookie-auth UI and would
        // trigger CSRF middleware that the SDK has no business satisfying.
        credentials: "omit",
        redirect: "manual",          // see _isRedirect
      });
      if (!resp.ok) throw await _errorFrom(resp, Boolean(this.apiKey));
      if (stream) return resp;       // caller iterates the body
      return await _json(resp);
    } finally {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
    }
  }

  /** Sync-style generation. Returns the full GenerateResponse JSON. */
  async generate(prompt, opts = {}) {
    return this._post("/v1/generate", this._body({ prompt, ...opts }),
                      { signal: opts.signal, maxRetries: opts.maxRetries });
  }

  /** Streaming generation. Yields { event, data } chunks. */
  async *generateStream(prompt, opts = {}) {
    const body = this._body({ prompt, ...opts });
    _refuseStrictStream(body);
    const resp = await this._post(
      "/v1/generate:stream",
      body,
      { stream: true, signal: opts.signal, maxRetries: opts.maxRetries },
    );
    yield* _parseSSE(resp.body);
  }

  /** Stateful multi-turn helper. */
  chat(opts = {}) {
    return new Chat(this, opts);
  }

  /**
   * GET /v1/quotas — tokens used and still available, by hour / day / month.
   *
   * Returns `{ windows: { hour|day|month: { input_tokens, output_tokens } } }`,
   * each carrying `{ used, limit, pending }`. `limit` and `pending` are null
   * when the window is unmetered — no plan sets an hourly ceiling, so `hour`
   * reports usage only.
   */
  async quotas() {
    return this._retrying(async () => {
      const resp = await this._fetch(this.apiBase + "/v1/quotas", {
        headers: this._headers(),
        credentials: "omit",
        redirect: "manual",            // see _isRedirect
      });
      if (!resp.ok) throw await _errorFrom(resp, Boolean(this.apiKey));
      return await _json(resp);
    });
  }
}


/** Stateful multi-turn helper. Tracks messages, previous intent and the last offer
 *  across turns. */
export class Chat {
  constructor(client, { outputShape = "auto", ...options } = {}) {
    this.client = client;
    // Every option generate() accepts, applied to every turn; a send()'s own options
    // win for that turn. Same as the Python SDK's `Chat(**options)`. This used to
    // keep only five options and drop the rest, so `chat({ webSearch: false })`
    // quietly let Aivana search anyway.
    //
    // All of it is RE-SENT ON EVERY TURN — nothing is stored server-side (the API
    // is stateless), so a long `system` persona is billed again on each turn.
    this.options = { outputShape, ...options };
    this.messages = [];
    this._lastIntent = null;
    this._pendingAction = null;
  }

  /** The conversation's system prompt, if one was set. */
  get system() {
    return this.options.system;
  }

  /** The name the assistant presents as in this conversation, if one was set. */
  get assistantName() {
    return this.options.assistantName;
  }

  /** The conversation's web-search setting (`true` or `false`), if one was set. */
  get webSearch() {
    return this.options.webSearch;
  }

  async send(content, opts = {}) {
    this.messages.push({ role: "user", content });
    const resp = await this.client.generate(null, {
      ...this.options,
      ...opts,
      messages: this.messages,
      previousIntent: this._lastIntent,
      pendingAction: this._pendingAction,
    });
    this.messages.push({ role: "assistant", content: resp.answer || "" });
    this._lastIntent = resp.intent ? resp.intent.name : null;
    // Carry forward only the most recent offer ("want me to apply these fixes?").
    // A turn that made none clears it, so a later bare "yes" can't resolve against
    // an offer from three turns ago.
    this._pendingAction = resp.pending_action || null;
    return resp;
  }

  /**
   * Resume the last answer after it was cut off (`finish_reason === "length"`).
   * Rare — Aivana sizes its own output budget, so this is for the occasional
   * hard provider cutoff, not a normal way to get longer answers.
   *
   * Sends the existing history with `continue: true` and no new user turn, then
   * appends the continuation onto the last assistant message in place (so a
   * second `continue()` picks up from the full stitched-together answer, and
   * the next ordinary `send()` sees one complete prior turn, not two).
   */
  async continue(opts = {}) {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "assistant") {
      throw new InvalidRequestError(
        "chat.continue() needs a cut-off assistant answer to resume — call send() first.",
        { code: "invalid_request" },
      );
    }
    const resp = await this.client.generate(null, {
      ...this.options,
      ...opts,
      messages: this.messages,
      previousIntent: this._lastIntent,
      continue: true,
    });
    last.content = `${last.content}${resp.answer || ""}`;
    return resp;
  }

  reset() {
    this.messages = [];
    this._lastIntent = null;
    this._pendingAction = null;
  }
}


// ---- SSE parser -----------------------------------------------------------

async function* _parseSSE(stream) {
  if (!stream) return;
  // Node fetch + browser fetch both expose a ReadableStream on resp.body.
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const evt = _parseSSEBlock(block);
        if (evt) yield evt;
      }
    }
    if (buf.trim()) {
      const evt = _parseSSEBlock(buf);
      if (evt) yield evt;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
  }
}


function _parseSSEBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const dataStr = dataLines.join("\n");
  let data;
  try { data = JSON.parse(dataStr); } catch { data = { raw: dataStr }; }
  return { event, data };
}


export default Aivana;
