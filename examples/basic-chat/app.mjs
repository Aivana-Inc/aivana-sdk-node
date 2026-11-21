import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { compileBlueprint } from "./blueprint.mjs";
import { parseBlueprintName } from "./config.mjs";
import { LIMITS } from "./public/conversation.mjs";

const ASSETS = new Map([
  ["/", ["text/html; charset=utf-8", "index.html"]],
  ["/app.js", ["text/javascript; charset=utf-8", "app.js"]],
  ["/conversation.mjs", ["text/javascript; charset=utf-8", "conversation.mjs"]],
  ["/markdown.mjs", ["text/javascript; charset=utf-8", "markdown.mjs"]],
  ["/highlight.mjs", ["text/javascript; charset=utf-8", "highlight.mjs"]],
  ["/render.mjs", ["text/javascript; charset=utf-8", "render.mjs"]],
  ["/typing.mjs", ["text/javascript; charset=utf-8", "typing.mjs"]],
  ["/assets/aivana-logo.avif", ["image/avif", "assets/aivana-logo.avif"]],
  ["/assets/aivana-sparkle.avif", ["image/avif", "assets/aivana-sparkle.avif"]],
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
      Object.keys(value).some((key) => !["message", "history", "context", "settings"].includes(key)) ||
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
  const settings = value.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      Object.keys(settings).some(key => !["effort", "webSearch", "maxTokens"].includes(key)) ||
      (settings.effort !== undefined && !["auto", "low", "medium", "high"].includes(settings.effort)) ||
      (settings.webSearch !== undefined && typeof settings.webSearch !== "boolean") ||
      (settings.maxTokens !== undefined && ![400, 800, 1600].includes(settings.maxTokens))) throw invalid("Choose supported chat settings.");
  return { message: value.message.trim(), history: history.map(({ role, content }) => ({ role, content })), context, settings };
}

const wholeCount = (value) => (Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined);

/** What the page may show about the latest request: token counts and time, and only what the response really carried. Never credits or cost. */
function publicUsage(usage, latencyMs) {
  const out = {};
  const input = wholeCount(usage?.input_tokens), output = wholeCount(usage?.output_tokens);
  if (input !== undefined) out.inputTokens = input;
  if (output !== undefined) out.outputTokens = output;
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 3_600_000) out.latencyMs = Math.round(latencyMs);
  return out;
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
  return failures[error?.status] ?? [502, "unavailable", "Aivana could not complete the request. Check your connection and API environment. If Aivana accepted the request, it was not sent again automatically."];
}

/** Stateless chat handler; inject an SDK client rather than sharing one SDK chat() across browsers. */
export function createChatServer({ client, blueprint = null, blueprintName, timeoutMs = 120_000 } = {}) {
  if (typeof client?.generate !== "function") throw new Error("An Aivana SDK client is required.");
  const profile = blueprint === null ? { options: { maxTokens: 800, webSearch: false }, history: "session" } : compileBlueprint(blueprint);
  // A loaded Blueprint's public description and its settings are shown read-only; its instructions are never sent to the browser.
  // The name is the local AIVANA_BLUEPRINT_NAME setting (the export has none) and means nothing without a Blueprint.
  const name = blueprint === null ? undefined : parseBlueprintName(blueprintName);
  const publicConfig = {
    blueprintLoaded: blueprint !== null, history: profile.history, webSearch: profile.options.webSearch,
    ...(blueprint === null ? {} : { blueprint: { ...(name ? { name } : {}), purpose: profile.purpose, effort: profile.options.effort, maxTokens: profile.options.maxTokens ?? null } }),
  };
  const activeRequests = new Set();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: { code: "forbidden", message: "Open this starter on its local address." } });

    const path = req.url;
    if (req.method === "GET" && ASSETS.has(path)) {
      const asset = ASSETS.get(path);
      res.writeHead(200, { "Content-Type": asset.type });
      return res.end(asset.data);
    }
    if (path === "/api/config" && req.method === "GET") return json(res, 200, publicConfig);
    if (path !== "/api/chat" && path !== "/api/chat/stream") return json(res, 404, { error: { code: "not_found", message: "Not found." } });
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
      const { message, history, context, settings } = validate(await readBody(req));
      if (blueprint !== null && Object.keys(settings).length) throw invalid("Imported Blueprint settings are locked. Remove chat overrides.");
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const requestOptions = {
        ...profile.options, ...(blueprint === null ? settings : {}),
        messages: [...(profile.history === "session" ? history : []), { role: "user", content: message }],
        ...(profile.history === "session" ? context : {}), signal: controller.signal,
      };
      if (path === "/api/chat/stream") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", "Cache-Control": "no-store" });
        let answer = "", finished = false, nextContext = {}, usage = {};
        const sendEvent = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify({ event, data }) + "\n"); };
        try {
          for await (const chunk of client.generateStream(null, requestOptions)) {
            if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
            if (chunk.event === "delta" && typeof chunk.data?.text === "string") {
              answer += chunk.data.text;
              if (answer.length > 16_000) throw new Error("Answer exceeded starter limit");
              sendEvent("delta", { text: chunk.data.text });
            } else if (chunk.event === "done") {
              finished = true;
              usage = publicUsage(chunk.data?.usage, chunk.data?.latency_ms);
              if (profile.history === "session" && typeof chunk.data?.intent?.name === "string" && chunk.data.intent.name.length <= 256) nextContext.previousIntent = chunk.data.intent.name;
              if (profile.history === "session" && typeof chunk.data?.pending_action === "string" && chunk.data.pending_action.length <= 8_000) nextContext.pendingAction = chunk.data.pending_action;
            } else if (chunk.event === "error") {
              throw new Error("The upstream stream reported an error");
            }
          }
          if (!finished || !answer.trim()) throw new Error("Incomplete streamed answer");
          sendEvent("done", { context: nextContext, usage });
        } catch {
          sendEvent("error", { message: "The response was interrupted. It may have used credit, and it was not sent again automatically." });
        } finally { res.end(); }
        return;
      }
      const result = await client.generate(null, requestOptions);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (typeof result?.answer !== "string" || !result.answer.trim() || result.answer.length > 16_000) {
        throw new Error("Invalid answer");
      }
      const nextContext = {};
      if (profile.history === "session" && typeof result.intent?.name === "string" && result.intent.name.length <= 256) nextContext.previousIntent = result.intent.name;
      if (profile.history === "session" && typeof result.pending_action === "string" && result.pending_action.length <= 8_000) nextContext.pendingAction = result.pending_action;
      json(res, 200, { answer: result.answer, context: nextContext, usage: publicUsage(result.usage, result.latency_ms) });
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
