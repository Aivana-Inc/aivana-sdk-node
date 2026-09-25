// Test doubles for the CLI suites: a fake Intelligence API behind an injected fetch,
// and stand-ins for the process's streams. Not a test file itself.

import { Readable } from "node:stream";

const encoder = new TextEncoder();

/** Frames exactly as /v1/generate:stream writes them. */
export function sse(events) {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/**
 * A fetch that answers every request with `api.response`, recording what was sent.
 * `response` has the conformance suite's shape (conformance/README.md):
 * {status, events} for a stream, {status, json} for a JSON body,
 * {network_error: "connect" | "timeout"}, and then: "disconnect".
 */
export function fakeApi(response = { status: 200, events: [] }) {
  const api = {
    response,
    requests: [],
    get sent() {
      return JSON.parse(api.requests.at(-1).body);
    },
    fetch: async (url, init = {}) => {
      api.requests.push({ url: String(url), headers: lowercase(init.headers), body: init.body });
      const spec = api.response;
      if (spec.network_error === "connect") {
        // How Node's fetch reports a refused connection.
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        });
      }
      if (spec.network_error === "timeout") {
        throw new DOMException("This operation was aborted", "AbortError");
      }
      if (spec.network_error) throw new Error(`unknown network_error ${spec.network_error}`);
      const status = spec.status ?? 200;
      if (spec.events) {
        const bytes = encoder.encode(sse(spec.events));
        let sent = false;
        // Pull-based, so the events are read before a disconnect: erroring a stream
        // discards whatever is still queued in it.
        const body = new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(bytes);
            } else if (spec.then === "disconnect") {
              controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
            } else {
              controller.close();
            }
          },
        });
        return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify(spec.json ?? {}), {
        status, headers: { "content-type": "application/json" },
      });
    },
  };
  return api;
}

function lowercase(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** A writable stand-in for stdout/stderr that keeps what was written. */
export function capture({ tty = false } = {}) {
  return {
    text: "",
    isTTY: tty,
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}

/** stdin: an interactive terminal (text === null), or piped text that then ends. */
export function stdin(text) {
  if (text === null) return { isTTY: true };
  return Readable.from([Buffer.from(text)]);
}
