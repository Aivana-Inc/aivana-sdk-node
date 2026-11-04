import Aivana from "@aivana/sdk";
import { createChatServer } from "./app.mjs";
import { readConfiguration } from "./config.mjs";

try {
  const { apiKey, apiBase, port } = readConfiguration();
  const client = new Aivana({ apiKey, ...(apiBase ? { apiBase } : {}), timeoutMs: 120_000 });
  const server = createChatServer({ client });
  server.on("error", () => { console.error("The local chat server could not start. Check PORT or whether another app is using it."); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Basic AI Chat: http://127.0.0.1:${port}\nAPI key stays on this server. Messages use Aivana account credit. Press Ctrl+C to stop.`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
