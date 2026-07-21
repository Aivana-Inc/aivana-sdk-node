// One-shot SDK runner. Reads JSON config from stdin, prints a JSON result to
// stdout, exits 0 on success / non-zero on failure. Used by the engine's
// dev-only /v1/dev/node-sdk route to exercise the real JS SDK code path
// from the server (the browser case still works directly).
//
// Stdin payload:
//   {
//     "prompt": string,
//     "output_shape": "auto" | "text" | "recommendation" | ...,
//     "api_base": "http://localhost:8088",
//     "api_key":  "ai_live_..." | null
//   }
//
// Stdout payload (success):
//   { "ok": true, "via": "node-sdk", "result": <GenerateResponse> }
//
// Stdout payload (failure):
//   { "ok": false, "via": "node-sdk",
//     "error": { "type": string, "message": string, "code": string, "request_id": string|null } }

import { Aivana } from "../src/index.js";

async function readStdin() {
  return await new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

(async () => {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false, via: "node-sdk",
      error: { type: "BadInput", message: "stdin was not valid JSON: " + e.message, code: "invalid_request", request_id: null },
    }));
    process.exit(2);
  }

  const ai = new Aivana({
    apiKey: payload.api_key || null,
    apiBase: payload.api_base || "http://localhost:8088",
    timeoutMs: 120_000,
  });

  try {
    const result = await ai.generate(payload.prompt, {
      outputShape: payload.output_shape || "auto",
    });
    process.stdout.write(JSON.stringify({ ok: true, via: "node-sdk", result }));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false, via: "node-sdk",
      error: {
        type: e.name || "Error",
        message: (e.message || String(e)).slice(0, 1000),
        code: e.code || "internal_error",
        request_id: e.requestId || null,
        status: e.status || 0,
      },
    }));
    process.exit(1);
  }
})();
