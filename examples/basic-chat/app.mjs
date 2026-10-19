import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { LIMITS } from "./public/conversation.mjs";

const ASSETS = new Map([
  ["/", ["text/html; charset=utf-8", "index.html"]],
  ["/app.js", ["text/javascript; charset=utf-8", "app.js"]],
  ["/conversation.mjs", ["text/javascript; charset=utf-8", "conversation.mjs"]],
  ["/styles.css", ["text/css; charset=utf-8", "styles.css"]],
].map(([route, [type, file]]) => [route, { type, data: readFileSync(new URL(`./public/${file}`, import.meta.url)) }]));

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function invalid(message = "Check your message and start a new chat if its history is too large.") {
  return new RequestError(400, "invalid_request", message);
}

function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !["message", "history", "context"].includes(key)) ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > LIMITS.messageChars) {
    throw invalid(`Enter a message of 1 to ${LIMITS.messageChars.toLocaleString("en-US")} characters.`);
  }
  const history = value.history ?? [];
  if (!Array.isArray(history) || history.length > LIMITS.historyMessages || history.length % 2 !== 0) throw invalid();
  let chars = value.message.length;
  for (const [index, item] of history.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some((key) => !["role", "content"].includes(key)) ||
        item.role !== (index % 2 === 0 ? "user" : "assistant") ||
        typeof item.content !== "string" || !item.content.trim() || item.content.length > 16_000) throw invalid();
    chars += item.content.length;
  }
  if (chars > LIMITS.contextChars) throw invalid();
  const context = value.context ?? {};
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      Object.keys(context).some((key) => !["previousIntent", "pendingAction"].includes(key))) throw invalid();
  for (const [key, max] of [["previousIntent", 256], ["pendingAction", 8_000]]) {
    if (context[key] !== undefined && (typeof context[key] !== "string" || context[key].length > max)) throw invalid();
  }
  return { message: value.message.trim(), history: history.map(({ role, content }) => ({ role, content })), context };
}

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new RequestError(413, "request_too_large", "This chat request is too large. Start a new chat.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw invalid("Send a valid JSON chat request."); }
}

function publicFailure(error, timedOut) {
  if (timedOut || error?.name === "AbortError" || error?.name === "TimeoutError") {
    return [504, "timeout", "Aivana did not finish in time. The request may have used credit. Try a shorter message when ready."];
  }
  const failures = {
    401: [502, "authentication_failed", "Aivana rejected the server's API key. Check .env and restart the app."],
    402: [402, "insufficient_credit", "The Aivana account needs more credit. Check Billing in AI Studio."],
    403: [403, "access_denied", "This API key cannot make this request. Check its permissions and API environment."],
    400: [400, "invalid_request", "Aivana could not accept this request. Try a shorter message or start a new chat."],
    422: [400, "invalid_request", "Aivana could not accept this request. Try a shorter message or start a new chat."],
    429: [429, "rate_limited", "Too many requests. Wait a moment before trying again."],
  };
  return failures[error?.status] ?? [502, "unavailable", "Aivana could not complete the request. Check your connection and API environment. No automatic retry was made."];
}

/** Stateless chat handler; inject an SDK client rather than sharing one SDK chat() across browsers. */
export function createChatServer({ client, timeoutMs = 120_000 } = {}) {
  if (typeof client?.generate !== "function") throw new Error("An Aivana SDK client is required.");
  const activeRequests = new Set();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: { code: "forbidden", message: "Open this starter on its local address." } });

    const path = req.url;
    if (req.method === "GET" && ASSETS.has(path)) {
      const asset = ASSETS.get(path);
      res.writeHead(200, { "Content-Type": asset.type });
      return res.end(asset.data);
    }
    if (path !== "/api/chat") return json(res, 404, { error: { code: "not_found", message: "Not found." } });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: { code: "method_not_allowed", message: "Use POST for chat." } }); }
    if (req.headers.origin !== `http://${req.headers.host}` || req.headers["sec-fetch-site"] === "cross-site") {
      return json(res, 403, { error: { code: "forbidden", message: "Send messages from this app's local page." } });
    }
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json(res, 415, { error: { code: "unsupported_media_type", message: "Send application/json." } });
    }
    if (activeRequests.size >= 2) return json(res, 429, { error: { code: "busy", message: "Two requests are already running. Wait before sending another." } });

    const controller = new AbortController();
    activeRequests.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", disconnected);
    try {
      const { message, history, context } = validate(await readBody(req));
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const result = await client.generate(null, {
        messages: [...history, { role: "user", content: message }], ...context,
        maxTokens: 800, webSearch: false, signal: controller.signal,
      });
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (typeof result?.answer !== "string" || !result.answer.trim() || result.answer.length > 16_000) {
        throw new Error("Invalid answer");
      }
      const nextContext = {};
      if (typeof result.intent?.name === "string" && result.intent.name.length <= 256) nextContext.previousIntent = result.intent.name;
      if (typeof result.pending_action === "string" && result.pending_action.length <= 8_000) nextContext.pendingAction = result.pending_action;
      json(res, 200, { answer: result.answer, context: nextContext });
    } catch (error) {
      const [status, code, message] = error instanceof RequestError
        ? [error.status, error.code, error.message] : publicFailure(error, timedOut);
      if (status === 413) { res.setHeader("Connection", "close"); req.resume(); }
      json(res, status, { error: { code, message } });
    } finally {
      clearTimeout(timer);
      res.off("close", disconnected);
      activeRequests.delete(controller);
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.on("close", () => { for (const request of activeRequests) request.abort(); });
  return server;
}
