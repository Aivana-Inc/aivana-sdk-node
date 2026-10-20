// A fake fetch for offline tests. The SDK accepts `fetch` as a constructor option, so
// no global patching is needed. Each mock records what the SDK sent.

export const OFFLINE_BASE = "https://api.aivana.test";

// A real 200 body from dev-developers.aivana.ai (first-call test, Sept 29 2026).
export const REAL_OK = {
  id: "gen_d609a1c17aad8a8cf6a5d2f5", request_id: "req_79a1dfa9af6fd183c9869f1b",
  answer: "Moon pulls silver tides  \nSalt wind braids the dusk with foam  \nDeep songs kiss the shore",
  intent: { name: "creative", confidence: 0.0, signal: "" },
  structured: null, structured_error: null, models_used: ["aivana-mmi"],
  usage: { input_tokens: 7, output_tokens: 23, cached_tokens: 0, credits: 0.000099 },
  latency_ms: 4628, finish_reason: "stop", notices: [], pending_action: null, trace: null,
};
// A real 401 body from developers.aivana.ai - note: no request_id in it.
export const REAL_401 = { error: { type: "auth", code: "invalid_api_key",
  message: "Invalid or expired API key. Generate a new key or check its expiry." } };

export const err = (code, extra = {}) =>
  ({ error: { type: code, code, message: "x", request_id: "req_test", ...extra } });

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export const sse = (...events) =>
  events.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join("");

export const sseResponse = (text) =>
  new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });

/**
 * mockFetch(responder) -> fetch function with .calls
 * responder: Response | (url, init, callIndex) => Response | throws
 */
export function mockFetch(responder) {
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : null,
                   headers: Object.fromEntries(Object.entries(init.headers || {})) };
    calls.push(call);
    const r = typeof responder === "function" ? await responder(url, init, calls.length - 1) : responder;
    return r instanceof Response ? r : r;
  };
  f.calls = calls;
  f.last = () => calls[calls.length - 1];
  return f;
}

/**
 * A stream whose body never ends on its own (like a long answer). Records whether the
 * consumer cancelled it and honours the fetch AbortSignal like real fetch does.
 */
export function endlessStream(init) {
  const state = { cancelled: false, aborted: false };
  const enc = new TextEncoder();
  let timer;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(sse(["delta", { text: "first " }])));
      let n = 0;
      timer = setInterval(() => {
        try { controller.enqueue(enc.encode(sse(["delta", { text: `more${n++} ` }]))); } catch { clearInterval(timer); }
      }, 20);
      if (init && init.signal) {
        init.signal.addEventListener("abort", () => {
          state.aborted = true;
          clearInterval(timer);
          try { controller.error(new DOMException("aborted", "AbortError")); } catch { /* */ }
        }, { once: true });
      }
    },
    cancel() { state.cancelled = true; clearInterval(timer); },
  });
  const stop = () => clearInterval(timer);
  return { response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }), state, stop };
}
