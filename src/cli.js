// `aivana` — ask the Aivana Intelligence API from a terminal.
//
//   export AIVANA_API_KEY=ai_live_...
//   aivana "Should we move billing off Stripe before the Series A?"
//   git diff | aivana "Review this change" --effort high
//
// The Node twin of the Python SDK's `aivana` command (aivana/cli.py in
// aivana-sdk-python). Both install a command with the same name, so both must
// behave the same: conformance/cli.json is that contract, and
// test/conformance.test.mjs runs it here.
//
// A thin layer over this SDK: every request is generateStream() or generate() to
// the same public endpoint an application calls. What this module adds is terminal
// behaviour (arguments, piped input, progress, exit codes) and nothing about how an
// answer is produced. It has no model, provider or mode option, deliberately: like
// the SDK it offers choices about the OUTCOME, and which models answer is Aivana's
// decision, never selectable or shown.
//
// Shipped to users as @aivana/cli (cli/ in this repo), a wrapper that depends on
// this exact SDK version.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { parseArgs } from "node:util";

import Aivana, {
  AivanaError,
  AuthError,
  ForbiddenError,
  InvalidRequestError,
  RateLimitError,
  UpstreamError,
} from "./index.js";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

// Exit codes. Scripts branch on these, so they are part of the interface: new ones
// may be added, existing ones are never renumbered.
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;         // the request was rejected, or something unexpected broke
export const EXIT_USAGE = 2;          // bad arguments
export const EXIT_AUTH = 3;           // no key, an invalid or expired key, or a key without access
export const EXIT_RATE_LIMITED = 4;   // too many requests: wait, then retry
export const EXIT_NO_CREDIT = 5;      // the balance is empty: retrying will not help, topping up will
export const EXIT_TEMPORARY = 6;      // network, timeout or upstream failure: safe to retry
export const EXIT_INTERRUPTED = 130;  // Ctrl-C (128 + SIGINT, the shell convention)

// Stored as `request_source` on every usage record, so CLI traffic can be told apart
// from SDK traffic with no server change. The engine never reads it.
export const REQUEST_SOURCE = "cli-node";

// How long to wait for piped input to START when a question was also given. Past
// this the input is treated as absent, with a note, so a stdin that is open but
// never written to (an agent's shell tool, `ssh host aivana ...`, a subprocess that
// inherited its parent's pipe) cannot hang the command forever. Input that has
// started is always read to the end, however slowly it arrives.
export const STDIN_WAIT_MS = 3000;

const DEFAULT_BASE = "https://developers.aivana.ai";

// Text that came from the API (the answer, trace steps, stage labels, error
// messages) is printed where a terminal will act on control characters: an ESC
// sequence can retitle the window, recolour or erase what is on screen, plant a
// disguised link, or on some terminals write to the clipboard. The text being
// asked about can steer an answer into containing one (`git diff | aivana` on
// someone else's change), so every C0 and C1 control except tab and newline is
// dropped before printing. Dropping each ESC on its own also defuses a sequence
// split across stream chunks: what is left prints as plain text.
const UNSAFE_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export function terminalSafe(text) {
  return String(text).replace(UNSAFE_CONTROLS, "");
}

// --json output: JSON.stringify already escapes C0 controls but leaves DEL and C1
// raw. Escaping them too keeps the output free of raw controls and still parses to
// the same value.
function jsonSafe(json) {
  return json.replace(/[\u007f-\u009f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
// The Python CLI's timeout. Above the API's own 180 s ceiling for a non-streamed
// answer (`--json`), which the SDK's 120 s default is not.
const TIMEOUT_MS = 240_000;

// The image types the API accepts, by file extension. The server's own rejection is
// deliberately terse ("request input was rejected") and never names the file, so
// this is the only place a caller can learn which attachment was the problem.
const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Words held back for commands that may exist later (`aivana chat`, ...). Today they
// fail with a pointer to `aivana ask`, so shipping one turns an error into a feature
// instead of changing what an invocation someone already scripted does.
const RESERVED_COMMANDS = ["chat", "configure", "login", "logout", "usage", "whoami"];

// Mirrors GenerateRequest's enums. A value the API adds later is rejected here, and
// loudly, until it is added — never silently dropped.
const EFFORTS = ["auto", "low", "medium", "high"];
const SHAPES = ["auto", "text", "recommendation", "summary", "tradeoffs", "decision", "extract"];

// API field -> the flag a caller would fix, for per-field validation errors.
const FLAG_FOR_FIELD = {
  prompt: "the question",
  system: "--system",
  assistant_name: "--assistant-name",
  effort: "--effort",
  output_shape: "--shape",
  max_tokens: "--max-tokens",
  temperature: "--temperature",
  attachments: "--image",
};

const USAGE = `usage: aivana [options] "QUESTION"
       ... | aivana [options] ["QUESTION"]
`;

const HELP = `${USAGE}
Ask the Aivana Intelligence API from your terminal.

The answer streams to stdout. Progress, the trace and errors go to stderr, so
\`aivana "..." > answer.md\` saves just the answer. Text piped in is sent ahead
of the question.

examples:
  aivana "Should we migrate billing to DynamoDB?"
  git diff | aivana "Review this change" --effort high
  aivana "What's driving the dip in this chart?" --image chart.png
  aivana "Postgres or DynamoDB for a write-heavy API?" --shape tradeoffs --trace
  aivana "Extract the invoice number and total" --shape extract --json < invoice.txt

positional arguments:
  QUESTION              what to ask. Quote it so the shell passes it as one
                        piece.

options:
  -h, --help            show this help message and exit
  --effort {auto,low,medium,high}
                        a ceiling on how much intelligence Aivana may apply.
                        auto (the default) lets Aivana judge from the
                        question.
  --shape SHAPE         answer format: auto, text, recommendation, summary,
                        tradeoffs, decision, extract
  --web, --no-web       --web always searches the web first, --no-web never
                        does. With neither, there is no search: the default
                        for API keys.
  --system TEXT         your own instructions: persona, tone, format (max 8000
                        characters)
  --assistant-name NAME
                        the name the assistant presents as
  --max-tokens N        a ceiling on answer length. It can shorten an answer,
                        never lengthen it.
  --temperature T       0.0-2.0. Omit to let Aivana choose per question.
  --image PATH          attach a PNG, JPEG, WebP or GIF image (repeatable)
  --trace               show the Intelligence Trace: how Aivana handled the
                        question
  --json                wait for the whole response and print it as JSON (no
                        streaming)
  -q, --quiet           no progress line
  --version             show program's version number and exit

environment:
  AIVANA_API_KEY    your API key (required). Create one in AI Studio > API Keys.
                    It is read from the environment only: a key typed as an
                    argument would land in your shell history and process list.
  AIVANA_API_BASE   API address. Defaults to https://developers.aivana.ai

exit codes:
  0  success                     4  rate limited: wait, then retry
  1  request failed              5  out of credits: top up in AI Studio
  2  bad usage                   6  temporary failure: safe to retry
  3  authentication problem    130  interrupted
`;

const OPTIONS = {
  effort: { type: "string" },
  shape: { type: "string" },
  web: { type: "boolean" },
  "no-web": { type: "boolean" },
  system: { type: "string" },
  "assistant-name": { type: "string" },
  "max-tokens": { type: "string" },
  temperature: { type: "string" },
  image: { type: "string", multiple: true },
  trace: { type: "boolean" },
  json: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};

class UsageError extends Error {}

// Run for real: wire up Ctrl-C and a reader that leaves early, then run main().
// The `aivana` binary (cli/bin/aivana.js) is just this.
export async function run() {
  process.stdout.on("error", (err) => {
    // `aivana ... | head -3`: the reader went away. Not a crash.
    if (err && err.code === "EPIPE") process.exit(EXIT_FAILED);
    throw err;
  });
  process.once("SIGINT", () => {
    for (const tidy of interruptHandlers) tidy();
    process.exit(EXIT_INTERRUPTED);
  });
  // exitCode rather than exit(): output still being flushed to a pipe is kept.
  process.exitCode = await main(process.argv.slice(2));
}

// Tidy-ups to run if Ctrl-C lands mid-answer: clear the status line, end the line.
const interruptHandlers = new Set();

/**
 * Entry point for the `aivana` command. Returns the process exit code.
 * `io` replaces the process's streams, environment and fetch (for tests).
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const ctx = {
    env: io.env ?? process.env,
    stdin: io.stdin === undefined ? process.stdin : io.stdin,
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    fetch: io.fetch,
    stdinWaitMs: io.stdinWaitMs ?? STDIN_WAIT_MS,
    platform: io.platform ?? process.platform,
  };
  let args = [...argv];

  if (!args.length && ctx.stdin && ctx.stdin.isTTY) {
    ctx.stdout.write(HELP);
    return EXIT_USAGE;
  }
  if (args[0] === "help") {
    ctx.stdout.write(HELP);
    return EXIT_OK;
  }
  if (args[0] === "ask") {
    args = args.slice(1);
  } else if (args.length && RESERVED_COMMANDS.includes(args[0])) {
    error(ctx, `\`aivana ${args[0]}\` is reserved for a future command.`,
      `To ask a question that starts with "${args[0]}", use:  aivana ask ${args.join(" ")}`);
    return EXIT_USAGE;
  }

  let opts;
  try {
    opts = parse(args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    ctx.stderr.write(USAGE);
    error(ctx, e.message);
    return EXIT_USAGE;
  }
  if (opts.help) {
    ctx.stdout.write(HELP);
    return EXIT_OK;
  }
  if (opts.version) {
    ctx.stdout.write(`aivana ${VERSION}\n`);
    return EXIT_OK;
  }
  return ask(ctx, opts);
}

function parse(args) {
  // A bare negative number is a word of the question ("what is -5 squared"), not an
  // option. parseArgs would reject it as an unknown `-5`; the Python CLI does not.
  const numbers = new Map();
  const shielded = args.map((arg, i) => {
    if (!/^-\d+(\.\d+)?$/.test(arg)) return arg;
    const token = `\u0000aivana-number-${i}`;
    numbers.set(token, arg);
    return token;
  });
  const restore = (value) => (numbers.has(value) ? numbers.get(value) : value);

  let parsed;
  try {
    parsed = parseArgs({ args: shielded, options: OPTIONS, allowPositionals: true,
                         strict: true, tokens: true });
  } catch (e) {
    throw new UsageError(describeParseError(e));
  }
  const values = Object.fromEntries(
    Object.entries(parsed.values).map(([k, v]) => [k, Array.isArray(v) ? v.map(restore) : restore(v)]));

  // --web and --no-web: the last one given wins, as it does in the Python CLI.
  let webSearch;
  for (const token of parsed.tokens) {
    if (token.kind === "option" && token.name === "web") webSearch = true;
    if (token.kind === "option" && token.name === "no-web") webSearch = false;
  }
  if (values.effort !== undefined && !EFFORTS.includes(values.effort)) {
    throw new UsageError(`argument --effort: invalid choice: '${values.effort}' ` +
                         `(choose from ${EFFORTS.join(", ")})`);
  }
  if (values.shape !== undefined && !SHAPES.includes(values.shape)) {
    throw new UsageError(`argument --shape: invalid choice: '${values.shape}' ` +
                         `(choose from ${SHAPES.join(", ")})`);
  }
  return {
    question: parsed.positionals.map(restore),
    effort: values.effort,
    outputShape: values.shape,
    webSearch,
    system: values.system,
    assistantName: values["assistant-name"],
    maxTokens: number(values["max-tokens"], "--max-tokens", "int", /^[-+]?\d+$/),
    temperature: number(values.temperature, "--temperature", "float",
                        /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/),
    images: values.image || [],
    trace: Boolean(values.trace),
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
    help: Boolean(values.help),
    version: Boolean(values.version),
  };
}

function number(raw, flag, kind, pattern) {
  if (raw === undefined) return undefined;
  if (!pattern.test(raw.trim())) {
    throw new UsageError(`argument ${flag}: invalid ${kind} value: '${raw}'`);
  }
  return Number(raw);
}

function describeParseError(e) {
  const option = /'(-[^' ]*)/.exec(e.message || "");
  switch (e.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return `unrecognized arguments: ${option ? option[1] : e.message}`;
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      if (/argument missing|ambiguous/.test(e.message)) {
        return `argument ${option ? option[1] : "?"}: expected one argument`;
      }
      return `argument ${option ? option[1] : "?"}: ignored explicit argument`;
    default:
      return e.message;
  }
}

async function ask(ctx, opts) {
  const key = (ctx.env.AIVANA_API_KEY || "").trim();
  if (!key) {
    error(ctx, "no API key found.",
      "Create one in AI Studio > API Keys, then run:", ...setKeyLines(ctx));
    return EXIT_AUTH;
  }
  let apiBase = DEFAULT_BASE;
  const base = (ctx.env.AIVANA_API_BASE || "").trim();
  if (base) {
    let url = null;
    try { url = new URL(base); } catch { /* not a URL */ }
    // Without a scheme and host, every request would fail as a network error that
    // says nothing about the actual mistake.
    if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname) {
      error(ctx, "AIVANA_API_BASE must be a full URL, such as https://developers.aivana.ai");
      return EXIT_USAGE;
    }
    apiBase = base;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(host)) {
      note(ctx, `AIVANA_API_BASE is plain http://, so your API key travels ` +
                `unencrypted to ${host}.`);
    }
  }

  let question;
  let attachments;
  try {
    question = await readQuestion(ctx, opts.question);
    attachments = [];
    for (const path of opts.images) attachments.push(await attachment(path));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(ctx, e.message);
    return EXIT_USAGE;
  }
  if (!question) {
    error(ctx, "no question given.",
      'Pass one in quotes, e.g.  aivana "What changed in the EU AI Act?"',
      'or pipe text in, e.g.  cat notes.txt | aivana "Summarize this"');
    return EXIT_USAGE;
  }

  // Only what the caller chose reaches the SDK. An omitted option is not a default
  // to fill in: it hands that decision to Aivana (see the README).
  const chosen = {
    system: opts.system,
    assistantName: opts.assistantName,
    effort: opts.effort,
    outputShape: opts.outputShape,
    webSearch: opts.webSearch,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    attachments: attachments.length ? attachments : undefined,
    intelligenceTrace: opts.trace ? true : undefined,
  };
  const options = Object.fromEntries(Object.entries(chosen).filter(([, v]) => v !== undefined));
  options.metadata = { request_source: REQUEST_SOURCE };

  const client = new Aivana({ apiKey: key, apiBase, timeoutMs: TIMEOUT_MS, fetch: ctx.fetch });
  try {
    if (opts.json) return await askJson(ctx, client, question, options, opts.quiet);
    return await askStreaming(ctx, client, question, options, opts);
  } catch (e) {
    if (e instanceof AivanaError) return reportApiError(ctx, e, client, opts.json);
    if (isTimeout(e)) {
      error(ctx, "timed out waiting for Aivana.", "It is safe to retry.");
      return EXIT_TEMPORARY;
    }
    if (isNetworkError(e)) {
      error(ctx, `couldn't reach ${client.apiBase} (${networkErrorName(e)}).`,
        "Check your connection, or AIVANA_API_BASE if you set it. It is safe to retry.");
      return EXIT_TEMPORARY;
    }
    throw e;
  }
}

async function readQuestion(ctx, words) {
  const question = words.join(" ").trim();
  let piped = "";
  const stdin = ctx.stdin;
  if (stdin && !stdin.isTTY) {
    // With no question on the command line the piped text IS the question, so
    // waiting for it is right. With one, a silent stdin is far more often a pipe
    // nobody will write to than input that is merely slow to start.
    const text = await readStdin(stdin, question ? ctx.stdinWaitMs : null);
    if (text === null) {
      note(ctx, `no piped input arrived within ${ctx.stdinWaitMs / 1000}s, so only the ` +
                "question was sent.",
        "Nothing to pipe? Add  < /dev/null  to skip the wait. Slow input? Save it to a " +
        "file first and redirect that in.");
    } else {
      piped = text.trim();
    }
  }
  if (piped && question) {
    // The material first and the question after it: questions about long input are
    // answered better when they come last.
    return `${piped}\n\n${question}`;
  }
  return piped || question;
}

// All of stdin as text, or null if nothing arrived within `waitMs` (null: wait as
// long as it takes).
function readStdin(stdin, waitMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let timer = null;
    const settle = (finish) => {
      clearTimeout(timer);
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      finish();
    };
    const onData = (chunk) => {
      clearTimeout(timer);           // it has started: read it to the end
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    };
    const onEnd = () => settle(() => {
      try {
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        reject(new UsageError("the piped input isn't text. Attach images with --image; " +
                              "for a PDF, extract its text first."));
      }
    });
    const onError = (err) => settle(() => reject(err));
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
    if (waitMs !== null) {
      timer = setTimeout(() => settle(() => {
        // Let go of the pipe, or it would hold the process open after the answer.
        if (typeof stdin.destroy === "function") stdin.destroy();
        resolve(null);
      }), waitMs);
    }
  });
}

async function attachment(path) {
  const suffix = extname(path).toLowerCase();
  const mimeType = IMAGE_TYPES[suffix];
  if (!mimeType) {
    const how = suffix === ".pdf"
      ? `extract its text first, e.g.  pdftotext ${path} - | aivana "Summarize this"`
      : `pipe it in instead, e.g.  aivana "Summarize this" < ${path}`;
    throw new UsageError(`${path}: only PNG, JPEG, WebP and GIF images can be attached. ` +
                         `To ask about a document, ${how}`);
  }
  let data;
  try {
    data = await readFile(path);
  } catch (e) {
    throw new UsageError(`${path}: ${FS_ERRORS[e.code] || e.message}`);
  }
  return { mimeType, data: data.toString("base64") };
}

// The operating system's own wording, as the Python CLI prints it.
const FS_ERRORS = {
  ENOENT: "No such file or directory",
  EACCES: "Permission denied",
  EISDIR: "Is a directory",
};

async function askStreaming(ctx, client, question, options, opts) {
  const out = ctx.stdout;
  const progress = new Progress(ctx.stderr, !opts.quiet && Boolean(ctx.stderr.isTTY));
  const traceView = opts.trace ? new TraceView(progress) : null;
  let answering = false;
  let endsWithNewline = true;
  let finishReason = "stop";
  let failure = null;
  const onInterrupt = () => {
    progress.stop();
    if (answering && !endsWithNewline) out.write("\n");
  };
  interruptHandlers.add(onInterrupt);
  try {
    for await (const chunk of client.generateStream(question, options)) {
      const data = chunk.data || {};
      if (chunk.event === "stage") {
        progress.show(String(data.stage || ""));
      } else if (chunk.event === "delta" && data.text) {
        const text = terminalSafe(data.text);
        if (!text) continue;
        if (!answering) {
          answering = true;
          progress.stop();
          if (traceView) traceView.answerStarted = true;
        }
        out.write(text);
        endsWithNewline = text.endsWith("\n");
      } else if (chunk.event === "trace" && traceView) {
        traceView.feed(data);
      } else if (chunk.event === "error") {
        failure = streamFailure(data);
      } else if (chunk.event === "done") {
        finishReason = String(data.finish_reason || "stop");
      }
    }
  } catch (e) {
    if (answering && (isNetworkError(e) || isTimeout(e))) {
      finishLine(out, endsWithNewline);
      endsWithNewline = true;
      note(ctx, "the connection dropped mid-answer, so the text above is incomplete.");
    }
    throw e;
  } finally {
    interruptHandlers.delete(onInterrupt);
    progress.stop();
    if (answering) finishLine(out, endsWithNewline);
  }

  if (traceView) traceView.finish(answering);
  if (failure) {
    error(ctx, failure.message + (answering ? " The text above is incomplete." : ""));
    return failure.code;
  }
  if (finishReason === "length") {
    const more = options.maxTokens ? " Raise --max-tokens to allow a longer one." : "";
    note(ctx, `the answer was cut off at the length limit.${more}`);
  }
  return EXIT_OK;
}

async function askJson(ctx, client, question, options, quiet) {
  const progress = new Progress(ctx.stderr, !quiet && Boolean(ctx.stderr.isTTY));
  progress.show("Waiting for the complete answer");
  let resp;
  try {
    resp = await client.generate(question, options);
  } finally {
    progress.stop();
  }
  ctx.stdout.write(`${jsonSafe(JSON.stringify(resp, null, 2))}\n`);
  return EXIT_OK;
}

// An `error` frame inside a 200 stream: the engine could not finish.
function streamFailure(data) {
  const kind = String(data.type || "");
  if (["upstream_error", "upstream", "timeout"].includes(kind)) {
    return { code: EXIT_TEMPORARY,
             message: "Aivana couldn't complete this answer. It is safe to retry." };
  }
  if (kind === "invalid_request") {
    return { code: EXIT_FAILED,
             message: "the request was rejected. Check the question, --system and any --image files." };
  }
  return { code: EXIT_FAILED, message: String(data.message || "the request failed.") };
}

function reportApiError(ctx, e, client, jsonMode) {
  const hints = [];
  let code = EXIT_FAILED;
  if (e instanceof AuthError) {
    code = EXIT_AUTH;
    hints.push("Create a new key in AI Studio > API Keys, then run:", ...setKeyLines(ctx));
  } else if (e instanceof ForbiddenError) {
    if (e.code === "host_not_allowed") {
      hints.push(`Answers are only served from the developer API host, and ${client.apiBase} ` +
                 "isn't it. Unset AIVANA_API_BASE to use https://developers.aivana.ai.");
    } else {
      code = EXIT_AUTH;
      hints.push("This key isn't allowed to generate answers. Create one that is in " +
                 "AI Studio > API Keys.");
    }
  } else if (e instanceof RateLimitError) {
    code = EXIT_RATE_LIMITED;
    hints.push("Wait a moment, then try again.");
  } else if (e.code === "insufficient_credit") {
    code = EXIT_NO_CREDIT;
    hints.push("Add credits in AI Studio > Billing.");
  } else if (e instanceof UpstreamError || ["timeout", "config_unavailable"].includes(e.code)) {
    code = EXIT_TEMPORARY;
    if (e.code === "timeout" && jsonMode) {
      hints.push("--json waits for the whole answer. Drop it to stream the answer as it " +
                 "is written.");
    } else {
      hints.push("It is safe to retry.");
    }
  } else if (e instanceof InvalidRequestError) {
    for (const detail of e.details || []) {
      hints.push(`${fieldName(detail.loc)}: ${detail.msg}`);
    }
  }
  const requestId = e.requestId ? ` (request id: ${e.requestId})` : "";
  error(ctx, `${e.message}${requestId}`, ...hints);
  return code;
}

function fieldName(loc) {
  const parts = (loc || []).filter((p) => p !== "body").map(String);
  if (!parts.length) return "request";
  return FLAG_FOR_FIELD[parts[0]] || parts.join(".");
}

function isTimeout(e) {
  // The SDK aborts a request that outlives its timeout. The CLI passes no signal of
  // its own, so an abort can only be that.
  return Boolean(e) && (e.name === "AbortError" || e.name === "TimeoutError");
}

function isNetworkError(e) {
  if (!e || e instanceof AivanaError) return false;
  const code = e.code || (e.cause && e.cause.code);
  if (typeof code === "string" && /^(E(?!RR_)[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(code)) return true;
  // How fetch reports a failed connection, and a body cut off mid-stream.
  return e instanceof TypeError && (e.message === "fetch failed" || e.message === "terminated");
}

// The most specific reason fetch gives: "ECONNREFUSED", "ENOTFOUND", or a cause with
// no code at all, like "bad port" (fetch refuses a short list of ports outright).
function networkErrorName(e) {
  const cause = e.cause || {};
  const first = (Array.isArray(cause.errors) && cause.errors[0]) || {};
  return cause.code || first.code || e.code || cause.message || e.message;
}

// One status line on stderr, rewritten in place ("Selecting the right
// intelligence…"). Drawn only on an interactive terminal: redirected stderr gets
// none of it, so a log never fills up with half-overwritten lines.
class Progress {
  constructor(stream, enabled) {
    this.stream = stream;
    this.enabled = enabled;
    this.label = "";
    this.width = 0;
  }

  show(label) {
    label = terminalSafe(label);
    if (!this.enabled || !label) return;
    const line = `${label}…`;
    // Padded to the previous width so a shorter label fully covers a longer one.
    this.stream.write(`\r${line.padEnd(this.width)}`);
    this.label = label;
    this.width = line.length;
  }

  clear() {
    if (this.width) this.stream.write(`\r${" ".repeat(this.width)}\r`);
    this.label = "";
    this.width = 0;
  }

  // Clear the line for good. Nothing redraws once the answer is streaming.
  stop() {
    this.clear();
    this.enabled = false;
  }

  // Print lines that stay, keeping the status line (if any) below them.
  above(text) {
    const label = this.label;
    this.clear();
    this.stream.write(`${terminalSafe(text)}\n`);
    this.show(label);
  }
}

// The Intelligence Trace on stderr, kept out of the answer. Steps print as they
// finish while Aivana is still working. Once the answer starts streaming the rest
// are held and printed after it: on a terminal, stdout and stderr share one screen,
// and a step landing mid-answer would split a sentence.
class TraceView {
  static MARKS = { ok: "✓", skipped: "–", failed: "✗" };

  constructor(progress) {
    this.progress = progress;
    this.shown = new Set();
    this.held = new Map();
    this.final = null;
    this.headerDone = false;
    this.answerStarted = false;
  }

  feed(data) {
    if (Array.isArray(data.steps)) {      // the consolidated trace, sent last
      this.final = data;
      return;
    }
    const step = data.step;
    // A step arrives twice, starting and finished; only the finished one prints.
    if (!step || typeof step !== "object" || !Object.hasOwn(TraceView.MARKS, step.status)) return;
    const key = TraceView.key(step);
    if (this.shown.has(key)) return;
    if (this.answerStarted) {
      this.held.set(key, step);
    } else {
      this.emit([TraceView.line(step)]);
      this.shown.add(key);
    }
  }

  finish(afterAnswer) {
    const rest = this.final
      ? this.final.steps.filter((s) => s && typeof s === "object"
          && Object.hasOwn(TraceView.MARKS, s.status) && !this.shown.has(TraceView.key(s)))
      : [...this.held.values()];
    const lines = [...rest.map((s) => TraceView.line(s)), ...this.summary()];
    if (lines.length && afterAnswer) lines.unshift("");
    this.emit(lines);
  }

  emit(lines) {
    if (!lines.length) return;
    let text = lines;
    if (!this.headerDone) {
      text = lines[0] ? ["Intelligence Trace", ...lines] : ["", "Intelligence Trace", ...lines.slice(1)];
      this.headerDone = true;
    }
    this.progress.above(text.join("\n"));
  }

  summary() {
    const final = this.final || {};
    const summary = final.summary || {};
    const parts = [];
    if (summary.route) parts.push(String(summary.route));
    if (Number.isInteger(summary.perspectives)) {
      parts.push(`${summary.perspectives} perspective${summary.perspectives === 1 ? "" : "s"}`);
    }
    if (summary.fresh_data === "enabled") {
      parts.push(Number.isInteger(summary.sources_used)
        ? `live sources used (${summary.sources_used})` : "live sources used");
    } else if (summary.fresh_data === "not_required") {
      parts.push("no live data needed");
    }
    const lines = parts.length ? [`  Route: ${parts.join(" · ")}`] : [];
    for (const why of final.why_this_route || []) lines.push(`  · ${why}`);
    return lines;
  }

  static key(step) {
    return String(step.id || step.title || "");
  }

  static line(step) {
    let text = `  ${TraceView.MARKS[step.status]} ${step.title || ""}`;
    if (step.detail) text += ` — ${step.detail}`;
    if (typeof step.at_ms === "number" && Number.isFinite(step.at_ms)) {
      // Whole tenths, rounded half up, so every implementation prints the same
      // figure. Float formatting can't promise that: 1.25 rounds down in Python and
      // up in JavaScript, and 8.45 is stored as 8.4499... so both print 8.4. The
      // conformance suite pins 1250 ms to "1.3s" and 8450 ms to "8.5s".
      const tenths = Math.floor((Math.trunc(step.at_ms) + 50) / 100);
      text += `  ${Math.floor(tenths / 10)}.${tenths % 10}s`;
    }
    return text;
  }
}

function finishLine(out, endsWithNewline) {
  if (!endsWithNewline) out.write("\n");
}

function error(ctx, message, ...hints) {
  stderrLines(ctx, `aivana: error: ${message}`, hints);
}

function note(ctx, message, ...hints) {
  stderrLines(ctx, `aivana: note: ${message}`, hints);
}

function stderrLines(ctx, first, rest) {
  ctx.stderr.write(`${terminalSafe([first, ...rest.map((line) => `  ${line}`)].join("\n"))}\n`);
}

// How to set the key, in the syntax of the shell the command most likely ran in.
// Windows has no `export`, and nothing reliably tells PowerShell (the default in
// Windows Terminal) from Command Prompt, so Windows gets both. Command Prompt's
// form has no quotes on purpose: `set` would keep them as part of the key.
function setKeyLines(ctx) {
  if (ctx.platform === "win32") {
    return ['  $env:AIVANA_API_KEY = "ai_live_..."   (PowerShell)',
            "  set AIVANA_API_KEY=ai_live_...        (Command Prompt)"];
  }
  return ["  export AIVANA_API_KEY=ai_live_..."];
}
