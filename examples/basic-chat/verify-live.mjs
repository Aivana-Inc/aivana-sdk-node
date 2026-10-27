// Explicitly invoked only: two billed synthetic turns, never part of npm test or CI.
import Aivana from "@aivana/sdk";
import { createChatServer } from "./app.mjs";
import { readConfiguration } from "./config.mjs";

const apiKey = process.env.AIVANA_API_KEY?.trim();
if (!apiKey) {
  console.error("Set AIVANA_API_KEY in the local .env file before running live verification.");
  process.exitCode = 1;
} else {
  let server;
  try {
    const config = readConfiguration();
    const client = new Aivana({ apiKey: config.apiKey, ...(config.apiBase ? { apiBase: config.apiBase } : {}), timeoutMs: 120_000 });
    server = createChatServer({ client });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const history = [];
    let context = {};
    for (const message of ["The project nickname for this conversation is Juniper. Acknowledge in one short sentence.", "What project nickname did I give you? Reply briefly."]) {
      const response = await fetch(`${origin}/api/chat`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, context }), signal: AbortSignal.timeout(125_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.code || "request_failed");
      if (!result.answer?.trim()) throw new Error("empty_answer");
      if (history.length && !/\bJuniper\b/i.test(result.answer)) throw new Error("follow_up_context_not_demonstrated");
      history.push({ role: "user", content: message }, { role: "assistant", content: result.answer });
      context = result.context;
      console.log(`Live turn ${history.length / 2}: passed${history.length > 2 ? " (follow-up context confirmed)" : " (nonempty answer)"}.`);
    }
    console.log("Two-turn live app check passed. No conversation content or credentials printed.");
  } catch (error) {
    // The app exposes only fixed public error codes. Never print SDK errors or credentials.
    console.error(`Live check failed: ${/^[a-z_]+$/.test(error.message) ? error.message : "connection_or_setup_error"}. No automatic retry made.`);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
