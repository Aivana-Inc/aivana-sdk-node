// Docs parity: every Node.js example a developer can copy is run against the installed SDK.
//
// Sources, as a developer meets them:
//   README  the README of the installed @aivana/sdk (node_modules/@aivana/sdk/README.md), i.e.
//           what npm shows for this release, not whatever is on GitHub main.
//   Docs    AI Studio > Docs (aivana-ai-studio src/data/docsData.ts and docsPagesV2.ts). Set
//           AIVANA_STUDIO_REPO to the checkout; default: an aivana-ai-studio folder next to this
//           suite or next to the SDK repo. Without one, only the README examples run.
//
// Each example runs as its own ES module in a child process, the way it would after being pasted
// into a file. An example that uses `client` without creating it gets the Quickstart's one-line
// setup (that is how the Docs pages read). `fetch` is replaced with a mock that answers in the
// real API's shapes, so nothing is sent and nothing is charged: what this proves is that every
// example uses names, options and response fields the SDK has.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { kase, ROOT } from "../lib/harness.mjs";

function findStudio() {
  if (process.env.AIVANA_STUDIO_REPO) return process.env.AIVANA_STUDIO_REPO;
  let dir = ROOT;
  for (let i = 0; i < 3; i++) {
    dir = dirname(dir);
    if (existsSync(join(dir, "aivana-ai-studio", "src", "data"))) return join(dir, "aivana-ai-studio");
  }
  return join(dirname(ROOT), "aivana-ai-studio");
}
const STUDIO = findStudio();

// ------------------------------------------------------------------ extraction

function tsBlocks(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  const re = /language:\s*"(typescript|javascript)"\s*,\s*code:\s*`/g;
  let m;
  while ((m = re.exec(text))) {
    let i = re.lastIndex, code = "";
    while (text[i] !== "`") {
      if (text[i] === "\\") { code += text[i + 1]; i += 2; continue; }
      code += text[i++];
    }
    const slugs = [...text.slice(0, m.index).matchAll(/\bslug:\s*"([^"]+)"/g)];
    const line = text.slice(0, m.index).split("\n").length;
    out.push({ page: slugs.length ? slugs.at(-1)[1] : "?", where: `${file.split("/").at(-1)}:${line}`, code });
  }
  return out;
}

function snippets() {
  const out = [];
  const readme = readFileSync(join(ROOT, "node_modules/@aivana/sdk/README.md"), "utf8");
  [...readme.matchAll(/```(?:js|javascript|mjs)\n([\s\S]*?)```/g)].forEach((m, n) =>
    out.push({ page: "README", where: `README (npm) block ${n + 1}`, code: m[1] }));
  for (const f of ["docsData.ts", "docsPagesV2.ts"]) {
    const p = join(STUDIO, "src", "data", f);
    if (existsSync(p)) for (const b of tsBlocks(p)) out.push({ ...b, page: `docs/${b.page}` });
  }
  return out;
}

// ------------------------------------------------------------------ the module each example runs in

const PRELUDE = `
// A developer's machine: key exported, fetch answered by a mock in the API's own shapes.
process.env.AIVANA_API_KEY ||= "ai_test_docs_snippet_not_real";
const TRACE = { status: "completed",
  steps: [{ id: "understanding", title: "Understanding Request", detail: "Single question", status: "ok", at_ms: 900 }],
  summary: { intelligence_level: "Advanced", route: "2-model verification", perspectives: 2,
             fresh_data: "not_required", elapsed_ms: 9000, complexity: "Medium", sources_used: null },
  why_this_route: ["A second perspective was worth it"] };
const valueFor = (s = {}) => {
  let t = Array.isArray(s.type) ? (s.type.find((x) => x !== "null") || "null") : s.type;
  if (s.enum) return s.enum[0];
  if (t === "object" || s.properties) return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, valueFor(v)]));
  if (t === "array") return [valueFor(s.items)];
  return { string: "x", integer: 1, number: 1.5, boolean: true, null: null }[t] ?? "x";
};
const usage = { input_tokens: 10, output_tokens: 5, cached_tokens: 0, credits: 0.0001 };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.endsWith("/v1/quotas")) {
    const w = { input_tokens: { used: 10, limit: 500000, pending: 0 }, output_tokens: { used: 5, limit: 100000, pending: 0 } };
    return new Response(JSON.stringify({ windows: { hour: w, day: w, month: w } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/v1/generate:stream")) {
    const ev = [["stage", { stage: "Selecting the right intelligence" }], ["delta", { text: "An " }], ["delta", { text: "answer." }]];
    if (body.intelligence_trace) ev.push(["trace", TRACE]);
    ev.push(["done", { finish_reason: "stop", usage }]);
    return new Response(ev.map(([e, d]) => "event: " + e + "\\ndata: " + JSON.stringify(d) + "\\n\\n").join(""),
                        { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  const res = { id: "gen_doc", request_id: "req_doc", answer: "An answer.", intent: { name: "direct_chat", confidence: 0.9, signal: "" },
                models_used: ["aivana-mmi"], latency_ms: 500, finish_reason: "stop", notices: [], usage,
                structured: null, structured_error: null, pending_action: null, trace: null };
  if (body.intelligence_trace) res.trace = TRACE;
  const rf = body.response_format || {};
  if (rf.type === "json_schema") { res.structured = valueFor((rf.json_schema || {}).schema || rf.schema); res.answer = JSON.stringify(res.structured); }
  if (body.output_shape === "extract") res.structured = { field: "value" };
  return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json" } });
};
`;

// What a reader is assumed to bring to an example, so a fragment can run: the placeholders
// README examples name for the reader's own data.
const READER_CONTEXT = {
  previousAnswer: '"Postgres if you need joins; DynamoDB for predictable key lookups."',
  messages: '[{ role: "user", content: "We\'re choosing between Postgres and DynamoDB." }]',
  transcript: '"Call with ACME on 3 Oct. Budget $40k. Decision by Friday."',
  schema: '{ type: "object", properties: { vendor: { type: "string" } }, required: ["vendor"], additionalProperties: false }',
  previous: '{ intent: { name: "general", confidence: 1 }, pending_action: null, answer: "Earlier answer." }',
  diagramB64: '"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="',
  customFetch: "globalThis.fetch",
};

// A block that only pictures a value's shape (`{ answer: "...", intent: { name, confidence } }`)
// is documentation of a response, not code to run.
const isIllustration = (code) => /^\s*\{/.test(code) && !/[;=]\s*$/m.test(code.split("\n")[0]);

function moduleFor(code) {
  const lines = [];
  const declares = (name) => new RegExp(`\\b(const|let|var|function)\\s+${name}\\b|import\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(code);
  if (/\bclient\./.test(code) && !declares("client")) {
    if (!/import\s+Aivana\b/.test(code)) lines.push('import Aivana from "@aivana/sdk";');
    lines.push("const client = new Aivana({ apiKey: process.env.AIVANA_API_KEY });");
  }
  if (/\bnew Aivana\b/.test(code) && !/import\s+(Aivana\b|\{[^}]*\bAivana\b)/.test(code) && !lines.length)
    lines.push('import { Aivana } from "@aivana/sdk";');
  for (const [name, value] of Object.entries(READER_CONTEXT))
    if (new RegExp(`\\b${name}\\b`).test(code) && !declares(name)) lines.push(`const ${name} = ${value};`);
  // imports must come first in a module; the example's own imports are hoisted anyway
  return `import "./prelude.mjs";\n${lines.join("\n")}\n${code}\n`;
}

const SCRATCH = join(ROOT, ".snippets");
function runModule(src, cwd) {
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(join(SCRATCH, "prelude.mjs"), PRELUDE);
  const file = join(SCRATCH, `example-${process.hrtime.bigint()}.mjs`);
  writeFileSync(file, src);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => { err += c; });
    p.stdout.resume();
    p.on("close", (code) => resolve({ code, err }));
  });
}

// ------------------------------------------------------------------ one case per page

const byPage = new Map();
for (const s of snippets()) (byPage.get(s.page) || byPage.set(s.page, []).get(s.page)).push(s);

for (const [page, list] of byPage) {
  const id = page === "README" ? "NODE-DOC-README" : `NODE-DOC-${page.split("/")[1].toUpperCase()}`;
  kase(id, "Docs parity", `Every Node.js example on ${page} runs against the installed SDK (${list.length})`, async () => {
    const work = mkdtempSync(join(tmpdir(), "aivana-docs-"));
    for (const f of ["contract.pdf", "report.pdf", "invoice.pdf", "chart.png", "image.png", "photo.jpg", "data.csv", "notes.docx"])
      writeFileSync(join(work, f), f.endsWith(".pdf") ? "%PDF-1.4 placeholder" : "placeholder");
    const failed = [];
    for (const s of list) {
      if (isIllustration(s.code)) continue;
      const r = await runModule(moduleFor(s.code), work);
      if (r.code !== 0) {
        const msg = r.err.split("\n").find((l) => /Error|error:/.test(l)) || r.err.split("\n")[0];
        failed.push(`${s.where}: ${msg.trim().slice(0, 160)}`);
        if (process.env.DOCS_DEBUG) console.error(`--- ${s.where}\n${r.err.slice(0, 600)}`);
      }
    }
    assert.ok(!failed.length, `${failed.length} of ${list.length} failed: ${failed.join(" | ")}`);
  }, { timeoutMs: 120_000 });
}
