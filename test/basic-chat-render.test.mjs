import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderMarkdown } from "../examples/basic-chat/public/render.mjs";

// A recording DOM: supports only what render.mjs may call, so a new, riskier API fails loudly.
class Node_ { constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.className = ""; this.text = ""; this.listeners = {}; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === "string" ? new Text_(k) : k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set textContent(v) { this.children = [new Text_(String(v))]; }
}
class Text_ { constructor(v) { this.value = v; this.tagName = "#text"; this.children = []; } }
const doc = { createElement: (t) => new Node_(t), createTextNode: (v) => new Text_(v), createDocumentFragment: () => new Node_("#fragment") };

const walk = (node, visit) => { visit(node); for (const c of node.children ?? []) walk(c, visit); };
const ALLOWED_TAGS = new Set(["#fragment", "#text", "p", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td",
  "div", "span", "pre", "code", "a", "strong", "em", "del", "br", "button"]);
const ALLOWED_ATTRS = new Set(["href", "target", "rel", "referrerpolicy", "title", "type", "aria-label", "start", "scope", "tabindex", "role"]);
const render = (md, options) => renderMarkdown(md, { doc, ...options });
const textOf = (n) => (n.value ?? "") + (n.children ?? []).map(textOf).join("");

const HOSTILE = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '![t](https://evil.example/p.png)', '<iframe src="https://evil.example"></iframe>',
  '```<script>\n<b onclick=x>y</b>\n```', '| <b>a</b> | b |\n|---|---|\n| <i>c</i> | javascript:x |', '> <style>*{display:none}</style>',
  '# <svg onload=alert(1)>', '- <a href="x">a</a>\n- [b](data:text/html,x)', '[a](https://ok.example "ti\\"tle onmouseover=alert(1)")', '<https://ok.example/"onmouseover="x>',
];

test("hostile answers produce only allow-listed elements and attributes, and only safe links", () => {
  for (const md of HOSTILE) {
    walk(render(md), (n) => {
      assert.ok(ALLOWED_TAGS.has(n.tagName), `${md} produced <${n.tagName}>`);
      for (const [k, v] of Object.entries(n.attrs ?? {})) {
        assert.ok(ALLOWED_ATTRS.has(k), `${md} produced attribute ${k}`);
        if (k === "href") assert.match(v, /^(https?:\/\/|mailto:)/i, `${md} produced href ${v}`);
      }
      assert.ok(!Object.keys(n.attrs ?? {}).some((k) => k.startsWith("on")), "no event-handler attributes");
    });
  }
  assert.ok(textOf(render("<script>alert(1)</script>")).includes("<script>alert(1)</script>"), "markup is shown as text");
});

test("links open safely and always show their real destination", () => {
  const found = [];
  walk(render("[docs](https://example.com/x) and https://example.org/y"), (n) => { if (n.tagName === "a") found.push(n.attrs); });
  assert.equal(found.length, 2);
  for (const a of found) {
    assert.equal(a.target, "_blank");
    assert.equal(a.rel, "noopener noreferrer nofollow");
    assert.equal(a.referrerpolicy, "no-referrer");
    assert.equal(a.title, a.href);
  }
});

test("code blocks show the code text and offer Copy only once complete", () => {
  const find = (root, cls) => { let hit; walk(root, (n) => { if (n.className === cls) hit = n; }); return hit; };
  const done = render("```js\nconst a = 1;\n```");
  assert.ok(find(done, "code-copy"), "a finished block has Copy");
  assert.equal(find(done, "code-copy").attrs["aria-label"], "Copy code");
  assert.equal(textOf(find(done, "code-lang")), "js");
  assert.equal(textOf(done.children[0].children[1]), "const a = 1;");
  assert.equal(find(render("```js\nconst a = 1;\n```", { streaming: true }), "code-copy"), undefined, "no Copy while streaming");
  assert.equal(find(render("```js\nconst a = 1;"), "code-copy"), undefined, "no Copy on an unclosed block");
  assert.equal(textOf(render("```mystery\n<b>x</b>\n```").children[0]).includes("<b>x</b>"), true, "an unknown language is plain text");
});

test("structure: a numbered list keeps its start, a table scrolls in a labelled region, headings sit below the message label", () => {
  const tags = (md) => { const t = []; walk(render(md), (n) => t.push(n.tagName)); return t; };
  let start; walk(render("3. a\n4. b"), (n) => { if (n.tagName === "ol") start = n.attrs.start; });
  assert.equal(start, "3");
  const table = render("| A |\n|---|\n| 1 |").children[0];
  assert.deepEqual([table.attrs.role, table.attrs.tabindex], ["region", "0"]);
  assert.ok(!tags("# one\n## two\n### three").includes("h1") && !tags("# x").includes("h2"));
});

test("headings in an answer never skip a level, whatever Markdown levels the answer uses", () => {
  const levels = (md) => { const found = []; walk(render(md), (n) => { if (/^h[3-6]$/.test(n.tagName)) found.push(Number(n.tagName[1])); }); return found; };
  assert.deepEqual(levels("### three first"), [3], "the first heading is an h3 (the message label is the h2)");
  assert.deepEqual(levels("## a\n\n##### b\n\n###### c"), [3, 4, 5]);
  assert.deepEqual(levels("# a\n\n## b\n\n### c\n\n#### d"), [3, 4, 5, 6]);
  assert.deepEqual(levels("###### deep\n\n# shallow\n\n###### deep again"), [3, 3, 4], "going back up is allowed, going down is one step at a time");
  for (const md of ["# a\n#### b\n## c\n###### d\n# e", "> ### quoted\n\n- ## in list\n\n#### z"]) {
    const found = levels(md);
    assert.equal(found[0], 3);
    found.forEach((level, i) => { if (i) assert.ok(level <= found[i - 1] + 1, `${md.replace(/\n/g, "|")} -> ${found.join(",")}`); });
  }
});

test("no file in public/ can build HTML or run strings as code, and the page has no inline script, style or handler", () => {
  const dir = new URL("../examples/basic-chat/public/", import.meta.url);
  const forbidden = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|document\.write|srcdoc)\b|\beval\s*\(|new\s+Function\b|setAttribute\(\s*["'](?:style|on\w+)["']/;
  for (const name of readdirSync(dir).filter((f) => /\.(?:js|mjs)$/.test(f))) {
    const code = readFileSync(new URL(name, dir), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, forbidden, name);
  }
  const html = readFileSync(new URL("index.html", dir), "utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "no inline script");
  assert.doesNotMatch(html, /<style\b/i, "no inline style element");
  assert.doesNotMatch(html, /\s(?:style|on[a-z]+)\s*=/i, "no inline style attribute or event handler");
});
