// The `aivana` command: behaviour that depends on the platform, not the contract.
//
// The contract itself (arguments, requests, messages, exit codes) is the shared
// conformance suite in conformance/cli.json, run by conformance.test.mjs here and by
// the Python CLI's own runner. What stays in this file cannot be expressed in that
// suite: a terminal, a pipe nobody writes to, and the real process (Ctrl-C, a reader
// that closes early), which is started for real against a local server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

import { EXIT_AUTH, EXIT_FAILED, EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, main } from "../src/cli.js";
import { capture, fakeApi, sse } from "./support/cli-doubles.mjs";

const KEY = "ai_live_test_not_real";
const STAGES = [
  "Selecting the right intelligence",
  "Reviewing multiple perspectives",
  "Resolving disagreements",
  "Preparing the synthesized answer",
].map((s) => ["stage", { loading: s, stage: s }]);
const ANSWER = { status: 200, events: [...STAGES, ["delta", { text: "Hello" }],
  ["delta", { text: " world." }], ["done", { finish_reason: "stop", usage: {} }]] };

function io(api, overrides = {}) {
  return { env: { AIVANA_API_KEY: KEY }, stdin: { isTTY: true }, stdout: capture(),
           stderr: capture(), fetch: api.fetch, ...overrides };
}

test("progress draws on a terminal and is wiped before the answer", async () => {
  const api = fakeApi(ANSWER);
  const streams = io(api, { stderr: capture({ tty: true }) });
  assert.equal(await main(["hi"], streams), EXIT_OK);
  const drawn = streams.stderr.text;
  assert.equal(streams.stdout.text, "Hello world.\n");
  assert.ok(drawn.includes("\rSelecting the right intelligence…"));
  assert.ok(drawn.includes("\rPreparing the synthesized answer…"));
  assert.ok(drawn.endsWith("\r"), "the status line must be cleared, not left behind");
});

test("a pipe nobody writes to cannot hang the command", async () => {
  // An agent's shell, `ssh host aivana ...`, a subprocess that inherited its parent's
  // stdin: open, never written, never closed. The Python CLI's first end-to-end run
  // hung on exactly this.
  const api = fakeApi(ANSWER);
  const silent = new PassThrough();
  const streams = io(api, { stdin: silent, stdinWaitMs: 50 });
  assert.equal(await main(["Just the question"], streams), EXIT_OK);
  assert.equal(api.sent.prompt, "Just the question");
  assert.ok(streams.stderr.text.includes("no piped input arrived within 0.05s"));
  assert.ok(streams.stderr.text.includes("< /dev/null"));
  assert.ok(silent.destroyed, "the pipe must be let go, or it holds the process open");
});

test("input that starts late is still read to the end", async () => {
  const api = fakeApi(ANSWER);
  const slow = new PassThrough();
  setTimeout(() => slow.write("first part, "), 10);
  setTimeout(() => slow.end("then the rest"), 120);   // after the 50 ms wait
  assert.equal(await main(["Summarize"], io(api, { stdin: slow, stdinWaitMs: 50 })), EXIT_OK);
  assert.equal(api.sent.prompt, "first part, then the rest\n\nSummarize");
});

test("binary piped input is refused", async () => {
  const api = fakeApi(ANSWER);
  const binary = new PassThrough();
  binary.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
  const streams = io(api, { stdin: binary });
  assert.equal(await main(["What is this?"], streams), EXIT_USAGE);
  assert.ok(streams.stderr.text.includes("isn't text"));
  assert.equal(api.requests.length, 0);
});

test("on Windows the key hints use PowerShell and Command Prompt syntax", async () => {
  // Windows shells have no `export`, so showing it there sends people to a command
  // that fails. The shared suite runs on Linux and pins everything else about these
  // messages; only the platform-specific line is checked here.
  const rejected = { status: 401, json: { error: { type: "invalid_api_key",
    code: "invalid_api_key", message: "The server said no.", request_id: "req_123" } } };
  for (const [name, response, env] of [
    ["missing key", ANSWER, {}],
    ["rejected key", rejected, { AIVANA_API_KEY: KEY }],
  ]) {
    const windows = io(fakeApi(response), { env, platform: "win32" });
    assert.equal(await main(["hi"], windows), EXIT_AUTH, name);
    assert.ok(windows.stderr.text.includes(
      '    $env:AIVANA_API_KEY = "ai_live_..."   (PowerShell)\n'), name);
    assert.ok(windows.stderr.text.includes(
      "    set AIVANA_API_KEY=ai_live_...        (Command Prompt)\n"), name);
    assert.ok(!windows.stderr.text.includes("export"), name);

    const mac = io(fakeApi(response), { env, platform: "darwin" });
    assert.equal(await main(["hi"], mac), EXIT_AUTH, name);
    assert.ok(mac.stderr.text.includes("    export AIVANA_API_KEY=ai_live_...\n"), name);
  }
});

// --- the real process ------------------------------------------------------

// A local stand-in for the API. A question containing "slowly" is answered one word
// at a time, slowly enough that a test can act mid-answer; the stream stops when the
// client goes away.
async function withServer(fn) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const done = sse([["done", { finish_reason: "stop", usage: {} }]]);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse(STAGES));
      if (!JSON.parse(body).prompt.includes("slowly")) {
        res.end(sse([["delta", { text: "Hello" }], ["delta", { text: " world." }]]) + done);
        return;
      }
      let n = 0;
      const words = setInterval(() => {
        if (n < 300) {
          res.write(sse([["delta", { text: `word${n++} ` }]]));
        } else {
          clearInterval(words);
          res.end(done);
        }
      }, 10);
      res.on("close", () => clearInterval(words));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

// Start `aivana ARGS...` as its own process, exactly as the installed binary does
// (cli/bin/aivana.js is `await run()`).
async function start(args, base) {
  const dir = await mkdtemp(join(tmpdir(), "aivana-cli-"));
  const entry = join(dir, "aivana.mjs");
  const cli = pathToFileURL(join(import.meta.dirname ?? new URL(".", import.meta.url).pathname,
                                 "..", "src", "cli.js"));
  await writeFile(entry, `import { run } from ${JSON.stringify(cli.href)};\nawait run();\n`);
  const child = spawn(process.execPath, [entry, ...args], {
    env: { ...process.env, AIVANA_API_KEY: KEY, AIVANA_API_BASE: base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const firstOutput = new Promise((resolve) => child.stdout.once("data", resolve));
  const done = exited.then(async (result) => {
    await rm(dir, { recursive: true, force: true });
    return { ...result, stderr };
  });
  return { child, firstOutput, done };
}

test("the real process answers and exits 0", async () => {
  await withServer(async (base) => {
    const { child, done } = await start(["Say hello", "--quiet"], base);
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    const { code, stderr } = await done;
    assert.equal(code, EXIT_OK, stderr);
    assert.equal(out, "Hello world.\n");
  });
});

test("Ctrl-C mid-answer exits 130", async () => {
  await withServer(async (base) => {
    const { child, firstOutput, done } = await start(["answer slowly please"], base);
    await firstOutput;
    child.kill("SIGINT");
    const { code, stderr } = await done;
    assert.equal(code, EXIT_INTERRUPTED);
    assert.equal(stderr, "");
  });
});

test("a reader closing the pipe early ends quietly", async () => {
  // `aivana ... | head -3`: the reader leaving is not a crash, and prints no stack.
  await withServer(async (base) => {
    const { child, firstOutput, done } = await start(["answer slowly please"], base);
    await firstOutput;
    child.stdout.destroy();
    const { code, stderr } = await done;
    assert.equal(code, EXIT_FAILED);
    assert.equal(stderr, "");
  });
});
