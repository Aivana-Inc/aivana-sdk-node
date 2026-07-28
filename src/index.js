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

// The apex `developers.aivana.ai` has no DNS record yet, so 0.3.0's default sent
// every caller who did not pass `apiBase` straight into a DNS failure. Point at
// the host that actually resolves until that record exists.
const DEFAULT_BASE = "https://dev-developers.aivana.ai";
const DEFAULT_TIMEOUT_MS = 120_000;
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
  constructor(message, { code = "internal_error", requestId = null, status = 0 } = {}) {
    super(message);
    this.name = "AivanaError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}
export class AuthError extends AivanaError { constructor(m, o) { super(m, o); this.name = "AuthError"; } }
export class RateLimitError extends AivanaError { constructor(m, o) { super(m, o); this.name = "RateLimitError"; } }
export class ForbiddenError extends AivanaError { constructor(m, o) { super(m, o); this.name = "ForbiddenError"; } }
export class InvalidRequestError extends AivanaError { constructor(m, o) { super(m, o); this.name = "InvalidRequestError"; } }
export class UpstreamError extends AivanaError { constructor(m, o) { super(m, o); this.name = "UpstreamError"; } }


function _classify(status, payload) {
  const err = (payload && payload.error) || {};
  const opts = { code: err.code || "internal_error", requestId: err.request_id || null, status };
  const msg = err.message || `request failed (HTTP ${status})`;
  if (status === 401 || opts.code === "auth") return new AuthError(msg, opts);
  if (status === 403 || opts.code === "forbidden") return new ForbiddenError(msg, opts);
  if (status === 429 || opts.code === "rate_limit_exceeded") return new RateLimitError(msg, opts);
  if (status === 400 || opts.code === "invalid_request") return new InvalidRequestError(msg, opts);
  if (status === 502 || opts.code === "upstream") return new UpstreamError(msg, opts);
  return new AivanaError(msg, opts);
}


/** Main client class. */
export class Aivana {
  /**
   * @param {object} cfg
   * @param {string} [cfg.apiKey]   — X-API-Key for server-to-server use.
   * @param {string} [cfg.apiBase]  — API base URL. Defaults to the hosted API.
   * @param {number} [cfg.timeoutMs] — Per-request timeout in ms.
   * @param {object} [cfg.fetch]    — Custom fetch (e.g. for testing).
   */
  constructor({ apiKey = null, apiBase = DEFAULT_BASE, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl = null } = {}) {
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  _headers(extra = {}) {
    const h = { "Content-Type": "application/json", ...extra };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  _body({ prompt, mode = "aivana_mmi", temperature, maxTokens, messages, previousIntent,
          outputShape, metadata, attachments, system }) {
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
    if (outputShape) b.output_shape = outputShape;
    if (metadata) b.metadata = metadata;
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
    // from "I chose this value", and would permanently shadow the engine's
    // per-intent temperature and depth-derived token budget.
    if (temperature !== undefined && temperature !== null) b.temperature = temperature;
    if (maxTokens !== undefined && maxTokens !== null) b.max_tokens = maxTokens;
    return b;
  }

  async _post(path, body, { stream = false, signal = null } = {}) {
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
      });
      if (!resp.ok) {
        let payload = null;
        try { payload = await resp.json(); } catch { /* fall through */ }
        throw _classify(resp.status, payload);
      }
      if (stream) return resp;       // caller iterates the body
      return await resp.json();
    } finally {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
    }
  }

  /** Sync-style generation. Returns the full GenerateResponse JSON. */
  async generate(prompt, opts = {}) {
    return this._post("/v1/generate", this._body({ prompt, ...opts }), { signal: opts.signal });
  }

  /** Streaming generation. Yields { event, data } chunks. */
  async *generateStream(prompt, opts = {}) {
    const resp = await this._post(
      "/v1/generate:stream",
      this._body({ prompt, ...opts }),
      { stream: true, signal: opts.signal },
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
    const resp = await this._fetch(this.apiBase + "/v1/quotas", {
      headers: this._headers(),
      credentials: "omit",
    });
    if (!resp.ok) {
      let payload = null;
      try { payload = await resp.json(); } catch { /* */ }
      throw _classify(resp.status, payload);
    }
    return await resp.json();
  }
}


/** Stateful multi-turn helper. Tracks messages + previous intent across turns. */
export class Chat {
  constructor(client, { mode = "aivana_mmi", temperature, maxTokens, outputShape = "auto",
                        system } = {}) {
    this.client = client;
    this.mode = mode;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.outputShape = outputShape;
    // Sticky for the whole conversation, and therefore RE-SENT ON EVERY TURN — it is
    // not stored server-side (the API is stateless), so a long persona is billed
    // again on each turn.
    this.system = system;
    this.messages = [];
    this._lastIntent = null;
  }

  async send(content, opts = {}) {
    this.messages.push({ role: "user", content });
    const resp = await this.client.generate(null, {
      mode: this.mode,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      outputShape: this.outputShape,
      system: this.system,
      ...opts,
      messages: this.messages,
      previousIntent: this._lastIntent,
    });
    this.messages.push({ role: "assistant", content: resp.answer || "" });
    this._lastIntent = resp.intent ? resp.intent.name : null;
    return resp;
  }

  reset() {
    this.messages = [];
    this._lastIntent = null;
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
