import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, safeHref, LIMITS } from "../examples/basic-chat/public/markdown.mjs";

const walk = (node, visit) => { visit(node); for (const key of ["children", "c"]) for (const child of node[key] ?? []) walk(child, visit); for (const item of node.items ?? []) for (const child of item) walk(child, visit);
  for (const row of [node.header ?? [], ...(node.rows ?? [])]) for (const cell of row) for (const child of cell) walk(child, visit); };
const all = (blocks) => { const out = []; for (const b of blocks) walk(b, (n) => out.push(n)); return out; };
const text = (nodes) => nodes.map((n) => n.v ?? text(n.c ?? [])).join("");

test("blocks: headings, paragraphs, rules, quotes", () => {
  const blocks = parseMarkdown("# Title\n\nFirst line\nsecond line\n\n---\n\n> quoted\n> more");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "rule", "quote"]);
  assert.equal(blocks[0].level, 1);
  assert.ok(blocks[1].children.some((n) => n.t === "br"), "a single newline is a line break, like most chat apps");
  assert.equal(blocks[3].children[0].type, "paragraph");
});

test("fenced code keeps its text exactly and says whether it was closed (streaming)", () => {
  const [closed] = parseMarkdown("```js\nconst a = 1;\n  <b>x</b>\n```");
  assert.deepEqual([closed.type, closed.lang, closed.text, closed.closed], ["code", "js", "const a = 1;\n  <b>x</b>", true]);
  const [open] = parseMarkdown("```python\nprint('hi'");
  assert.deepEqual([open.lang, open.text, open.closed], ["python", "print('hi'", false]);
  const [weird] = parseMarkdown("```<script>alert(1)</script>\nx\n```");
  assert.equal(weird.lang, "", "an odd info string is never kept as a language");
  assert.equal(parseMarkdown("~~~\na\n```\nb\n~~~")[0].text, "a\n```\nb", "a different fence inside does not close it");
});

test("lists: ordered, bullet, nested, and a numbered list keeps its numbers across a nested bullet list", () => {
  const [list] = parseMarkdown("1. one\n   - a\n   - b\n2. two\n3. three");
  assert.equal(list.type, "list");
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3, "indented bullets belong to item 1; they do not end the list");
  assert.equal(list.items[0].find((b) => b.type === "list").items.length, 2);
  const [startAt] = parseMarkdown("3. x\n4. y");
  assert.equal(startAt.start, 3);
  const [bullets] = parseMarkdown("- a\n- b");
  assert.deepEqual([bullets.ordered, bullets.items.length], [false, 2]);
});

test("tables: header, alignment, rows padded to the header width", () => {
  const [t] = parseMarkdown("| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 |");
  assert.equal(t.type, "table");
  assert.deepEqual(t.align, ["left", "right"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1].length, 2);
  assert.equal(parseMarkdown("a | b\nnot a table")[0].type, "paragraph");
});

test("inline: emphasis, code, snake_case and unmatched markers stay literal", () => {
  const n = parseInline("**bold** and *it* and ~~gone~~ and `code <b>` and snake_case_name and 2 * 3 * 4");
  assert.deepEqual(n.filter((x) => x.t !== "text").map((x) => x.t), ["strong", "em", "del", "code"]);
  assert.equal(text(n), "bold and it and gone and code <b> and snake_case_name and 2 * 3 * 4");
  assert.equal(text(parseInline("**never closed")), "**never closed");
  assert.deepEqual(parseInline("***both***").map((x) => x.t), ["em"]);
});

test("security: raw HTML is never interpreted, it stays literal text", () => {
  const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">x</a>');
  const nodes = all(blocks);
  assert.ok(nodes.every((n) => !["html", "image", "img"].includes(n.type ?? n.t)), "no HTML node type exists");
  assert.ok(text(blocks.flatMap((b) => b.children)).includes("<script>alert(1)</script>"));
});

test("security: only well-formed http(s) and mailto addresses become links", () => {
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>",
    "vbscript:x", "file:///etc/passwd", "//evil.example", "/relative", "ftp://x.example", "https://user:pass@example.com", "https://", "http:\\\\evil.example", "https://exa mple.com"]) {
    assert.equal(safeHref(bad), null, bad);
    const links = all([{ type: "paragraph", children: parseInline(`[click](${bad})`) }]).filter((x) => x.t === "link");
    assert.equal(links.length, 0, `[click](${bad}) must not become a link`);
  }
  assert.equal(safeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHref("mailto:a@example.com"), "mailto:a@example.com");
  const link = parseInline("[docs](https://example.com/x \"title\")")[0];
  assert.deepEqual([link.t, link.href], ["link", "https://example.com/x"]);
});

test("security: images are never loaded, only their description survives", () => {
  const nodes = parseInline("![tracker](https://evil.example/pixel.png) and ![bad](javascript:alert(1))");
  assert.ok(nodes.every((n) => n.t !== "image"));
  assert.ok(text(nodes).includes("bad"));
});

test("bare addresses are linked without swallowing trailing punctuation", () => {
  const nodes = parseInline("See https://example.com/page, and (https://example.com/x).");
  assert.deepEqual(nodes.filter((n) => n.t === "link").map((n) => n.href), ["https://example.com/page", "https://example.com/x"]);
});

test("worst cases stay fast and never throw: hostile or odd input cannot slow the page", () => {
  const n = 100_000;
  const cases = {
    stars: "*".repeat(n), openers: "**a ".repeat(n / 4), underscores: "_a ".repeat(n / 3), brackets: "[".repeat(n), parens: "[a](".repeat(n / 4),
    backticks: "` ".repeat(n / 2), tildes: "~~a ".repeat(n / 4), quotes: "> ".repeat(n / 2), nestedQuotes: ">".repeat(n), bullets: "- ".repeat(n / 2),
    nestedBullets: Array.from({ length: 3000 }, (_, i) => " ".repeat(Math.min(i, 3)) + "- x").join("\n"), numbers: "1. ".repeat(n / 3), pipes: "|".repeat(n),
    table: "| a |\n|---|\n" + "| x |\n".repeat(50_000), fences: "```\n".repeat(n / 4), headings: "# ".repeat(n / 2), mixed: "**_[`~~".repeat(n / 7), links: "[a](https://x.example) ".repeat(n / 23),
    longLine: "a".repeat(n), urls: "http://".repeat(n / 7),
  };
  for (const [name, input] of Object.entries(cases)) {
    const started = performance.now();
    assert.doesNotThrow(() => parseMarkdown(input), name);
    const ms = performance.now() - started;
    assert.ok(ms < 1500, `${name} took ${Math.round(ms)} ms`);
  }
});

test("input is capped, and control characters are replaced", () => {
  const blocks = parseMarkdown("a".repeat(LIMITS.inputChars * 2));
  assert.equal(text(blocks[0].children).length, LIMITS.inputChars);
  const nul = String.fromCharCode(0);
  assert.ok(!text(parseMarkdown(`a${nul}b`)[0].children).includes(nul));
  assert.ok(text(parseMarkdown(`a${nul}b`)[0].children).includes(String.fromCharCode(0xfffd)));
  assert.deepEqual(parseMarkdown(null), []);
  assert.deepEqual(parseMarkdown(""), []);
});
