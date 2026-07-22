// Request-body construction. The contract under test: generation options are
// OMITTED unless the caller set one, so the engine can apply its own per-intent
// temperature and depth-derived token budget. A client-side default here would
// silently shadow both — see _body() in src/index.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana from "../src/index.js";

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

test("omits both generation options when the caller passes neither", () => {
  const b = body({ prompt: "hi" });
  assert.equal("temperature" in b, false);
  assert.equal("max_tokens" in b, false);
});

test("forwards temperature only when supplied", () => {
  assert.equal(body({ prompt: "hi", temperature: 0.15 }).temperature, 0.15);
});

test("forwards maxTokens as snake_case max_tokens", () => {
  assert.equal(body({ prompt: "hi", maxTokens: 250 }).max_tokens, 250);
});

// 0 and 0.0 are falsy: a truthiness check here would silently drop a deliberate
// request for fully deterministic output.
test("keeps temperature 0 rather than treating it as unset", () => {
  const b = body({ prompt: "hi", temperature: 0 });
  assert.equal("temperature" in b, true);
  assert.equal(b.temperature, 0);
});

test("treats explicit null as unset", () => {
  const b = body({ prompt: "hi", temperature: null, maxTokens: null });
  assert.equal("temperature" in b, false);
  assert.equal("max_tokens" in b, false);
});

test("always sends the single generation tier", () => {
  assert.equal(body({ prompt: "hi" }).mode, "aivana_mmi");
});

test("maps camelCase options onto the wire's snake_case", () => {
  const b = body({ prompt: "hi", previousIntent: "code_review", outputShape: "summary" });
  assert.equal(b.previous_intent, "code_review");
  assert.equal(b.output_shape, "summary");
});

// --- attachments -----------------------------------------------------------

test("maps mimeType to the wire's mime_type", () => {
  const b = body({ prompt: "what is this?", attachments: [{ mimeType: "image/png", data: "AAAA" }] });
  assert.deepEqual(b.attachments, [{ mime_type: "image/png", data: "AAAA" }]);
});

test("accepts snake_case mime_type as an alias", () => {
  const b = body({ prompt: "hi", attachments: [{ mime_type: "image/jpeg", data: "BBBB" }] });
  assert.equal(b.attachments[0].mime_type, "image/jpeg");
});

test("omits attachments entirely when none or empty", () => {
  assert.equal("attachments" in body({ prompt: "hi" }), false);
  assert.equal("attachments" in body({ prompt: "hi", attachments: [] }), false);
});
