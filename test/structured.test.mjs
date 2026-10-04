// Strict JSON Schema output (`responseFormat`): what the SDK sends and refuses.
//
// The API either answers with a `structured` object that validates against the
// caller's schema or fails, so this client's jobs are small and easy to get wrong
// silently: send the schema EXACTLY as given (its keys are the caller's own field
// names, and this SDK otherwise speaks snake_case on the wire), refuse to stream
// it before any network call, and throw the errors the API sends as the classes a
// caller catches. Parity with the Python SDK is pinned in its
// tests/test_structured_output.py; the wire field list is pinned in parity.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana, { AivanaError, InvalidRequestError, UpstreamError } from "../src/index.js";

// camelCase keys, a nested object, an array: anything that would show a re-casing,
// a re-ordering or a dropped key.
const SCHEMA = {
  type: "object",
  properties: {
    vendorName: { type: "string" },
    lineItems: {
      type: "array",
      items: { type: "object", properties: { unitPrice: { type: "number" } } },
    },
  },
  required: ["vendorName"],
  additionalProperties: false,
};
const STRICT = { type: "json_schema", schema: SCHEMA };
const VALID = { vendorName: "Acme", lineItems: [{ unitPrice: 12.5 }] };

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

/** A client over a fake API that records the bodies it is sent and answers a strict run. */
function recording() {
  const sent = [];
  const c = new Aivana({
    apiKey: "k",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          id: "g", request_id: "req_1", answer: JSON.stringify(VALID),
          intent: { name: "general", confidence: 1, signal: "" },
          structured: VALID, structured_error: null, models_used: ["aivana-mmi"],
          usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 1,
          finish_reason: "stop", notices: [],
        }),
      };
    },
  });
  return { client: c, sent };
}

/** A client that fails the test if any request is made at all. */
const noNetwork = new Aivana({
  apiKey: "k",
  fetch: async () => { throw new Error("a request was made"); },
});

const failing = (status, payload) => new Aivana({
  apiKey: "k", fetch: async () => ({ ok: false, status, json: async () => payload }),
});
const envelope = (code) => ({ error: { type: code, code, message: "nope", request_id: "req_1" } });

// ---- the wire ------------------------------------------------------------------

test("omitted unless the caller sets it", () => {
  assert.equal("response_format" in body({ prompt: "hi" }), false);
});

test("the schema is sent exactly as given, in the caller's own key names and order", () => {
  const sentSchema = body({ prompt: "hi", responseFormat: STRICT }).response_format.schema;
  assert.deepEqual(sentSchema, SCHEMA);
  // deepEqual ignores key order; the caller's field order is part of what they wrote.
  assert.equal(JSON.stringify(sentSchema), JSON.stringify(SCHEMA));
  assert.equal("vendor_name" in sentSchema.properties, false, "keys must not be snake_cased");
});

test("the callers object is never mutated", () => {
  const fmt = structuredClone(STRICT);
  const b = body({ prompt: "hi", responseFormat: fmt });
  b.response_format.type = "changed";
  assert.deepEqual(fmt, STRICT, "the wrapper must be a copy");
});

test("a text format is sent as it is", () => {
  assert.deepEqual(body({ prompt: "hi", responseFormat: { type: "text" } }).response_format,
                   { type: "text" });
});

test("it is not confused with outputShape", () => {
  assert.equal("output_shape" in body({ prompt: "hi", responseFormat: STRICT }), false);
});

test("a non-object is refused before any request", async () => {
  for (const bad of ["json_schema", ["json_schema"], 7, true]) {
    await assert.rejects(noNetwork.generate("hi", { responseFormat: bad }), (err) => {
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.code, "invalid_request");
      return true;
    });
  }
});

test("a whole call sends it and returns the validated object", async () => {
  const { client: c, sent } = recording();
  const resp = await c.generate("Extract the invoice.", { responseFormat: STRICT });
  assert.deepEqual(sent[0].response_format, STRICT);
  assert.deepEqual(resp.structured, VALID);
  assert.deepEqual(JSON.parse(resp.answer), VALID);
});

test("chat sends it on every turn", async () => {
  const { client: c, sent } = recording();
  const chat = c.chat({ responseFormat: STRICT });
  await chat.send("first");
  await chat.send("second");
  assert.deepEqual(sent.map((b) => b.response_format), [STRICT, STRICT]);
});

// ---- streaming ----------------------------------------------------------------

test("a strict schema cannot be streamed, and no request is made", async () => {
  await assert.rejects(
    async () => { for await (const _ of noNetwork.generateStream("hi", { responseFormat: STRICT })) { /* never */ } },
    (err) => {
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.code, "structured_output_streaming_not_supported");
      return true;
    },
  );
});

test("a plain text format may still stream", async () => {
  const stream = noNetwork.generateStream("hi", { responseFormat: { type: "text" } });
  // Building it must not throw; nothing is requested until it is read.
  assert.equal(typeof stream[Symbol.asyncIterator], "function");
});

// ---- errors -------------------------------------------------------------------

for (const code of ["invalid_response_schema", "structured_output_streaming_not_supported"]) {
  test(`a 422 ${code} is the callers to fix`, async () => {
    await assert.rejects(failing(422, envelope(code)).generate("hi"), (err) => {
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.code, code);
      return true;
    });
  });
}

test("a failed run is an UpstreamError with its own code", async () => {
  await assert.rejects(failing(502, envelope("structured_output_failed")).generate("hi"), (err) => {
    assert.ok(err instanceof UpstreamError);
    assert.equal(err.code, "structured_output_failed");
    return true;
  });
});

test("other 422 codes are unchanged", async () => {
  await assert.rejects(failing(422, envelope("something_new")).generate("hi"), (err) => {
    assert.equal(err.constructor, AivanaError);
    return true;
  });
});
