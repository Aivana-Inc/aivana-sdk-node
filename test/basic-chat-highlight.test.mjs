import { test } from "node:test";
import assert from "node:assert/strict";
import { highlight, languageFor, MAX_HIGHLIGHT_CHARS } from "../examples/basic-chat/public/highlight.mjs";

const join = (tokens) => tokens.map((t) => t[1]).join("");
const types = (tokens, type) => tokens.filter((t) => t[0] === type).map((t) => t[1]);

const SAMPLES = {
  js: "// hi\nconst answer = await client.generate(\"x\", { maxTokens: 800 });\nif (answer.ok) { return `a ${1}`; } /* done */ 0xFF 1_000n",
  json: '{ "name": "aivana", "n": -1.5e3, "ok": true, "list": [null, "x"] }',
  python: '# c\n@dec\ndef f(x):\n    """doc\n    string"""\n    return f"a{x}" if x is not None else 0x1F',
  bash: '# install\nnpm ci --silent && echo $HOME "done ${PORT}" || exit 1\nif [ -f .env ]; then echo \'ok\'; fi',
  css: "/* c */\n@media (max-width: 600px) { .a:hover { color: #3b82f6; margin: -1.5rem 0; content: \"x\"; } }",
  sql: "-- c\nSELECT id, count(*) FROM users WHERE name = 'o''k' AND age >= 18 GROUP BY id;",
  yaml: "# c\nname: demo\nenabled: true\nlist:\n  - one\n  - \"two\"\nport: 8080",
  html: '<!-- c --><div class="a" id=\'b\'>text &amp; <br/></div>',
};

test("every sample round-trips exactly (lossless) and tags what it should", () => {
  for (const [lang, code] of Object.entries(SAMPLES)) {
    const tokens = highlight(code, lang);
    assert.equal(join(tokens), code, lang);
    assert.ok(tokens.some((t) => t[0] !== "plain"), `${lang} found nothing to colour`);
  }
  const js = highlight(SAMPLES.js, "js");
  assert.ok(types(js, "keyword").includes("const") && types(js, "keyword").includes("await"));
  assert.ok(types(js, "function").includes("generate"));
  assert.ok(types(js, "comment").includes("// hi"));
  assert.ok(types(js, "number").includes("0xFF"));
  assert.ok(types(highlight(SAMPLES.json, "json"), "property").includes('"name"'));
  assert.ok(types(highlight(SAMPLES.python, "python"), "string").some((s) => s.startsWith('"""')));
  assert.ok(types(highlight(SAMPLES.bash, "bash"), "variable").includes("$HOME"));
});

test("language names and aliases; anything unknown is plain text, never an error", () => {
  assert.equal(languageFor("TypeScript"), "js");
  assert.equal(languageFor("yml"), "yaml");
  assert.equal(languageFor("rust"), null);
  assert.deepEqual(highlight("let x", "rust"), [["plain", "let x"]]);
  assert.deepEqual(highlight("", "js"), []);
  assert.deepEqual(highlight(null, undefined), []);
});

test("code is data: markup inside code is returned as text, never interpreted", () => {
  const code = '<script>alert(1)</script> "<img onerror=x>"';
  for (const lang of Object.keys(SAMPLES)) assert.equal(join(highlight(code, lang)), code, lang);
});

test("worst cases are lossless and fast for every language", () => {
  const n = 50_000;
  const hostile = [
    '"'.repeat(n), "'".repeat(n), "`".repeat(n), "/*".repeat(n / 2), "//".repeat(n / 2), "\\".repeat(n), "\"\\".repeat(n / 2), "1".repeat(n - 1) + "x",
    "<".repeat(n), "<a ".repeat(n / 3), "'''".repeat(n / 3), '"""'.repeat(n / 3), "$".repeat(n), "${".repeat(n / 2), "@".repeat(n), "-".repeat(n),
    "a(".repeat(n / 2), "#".repeat(n), "\n".repeat(n), "{[(".repeat(n / 3), "0x".repeat(n / 2), "1e".repeat(n / 2), "a:".repeat(n / 2), "x ".repeat(n / 2),
  ];
  for (const lang of Object.keys(SAMPLES)) {
    for (const input of hostile) {
      const started = performance.now();
      const tokens = highlight(input, lang);
      const ms = performance.now() - started;
      assert.equal(join(tokens), input, `${lang} lost characters`);
      assert.ok(ms < 1500, `${lang} took ${Math.round(ms)} ms on ${JSON.stringify(input.slice(0, 12))}`);
    }
  }
});

test("very large code is highlighted up to a cap and the rest passes through unchanged", () => {
  const code = "const a = 1;\n".repeat(MAX_HIGHLIGHT_CHARS);
  assert.equal(join(highlight(code, "js")), code);
});
