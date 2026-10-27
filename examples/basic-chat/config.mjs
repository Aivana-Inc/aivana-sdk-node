export function readConfiguration(env = process.env) {
  const apiKey = env.AIVANA_API_KEY?.trim();
  if (!apiKey || /^(YOUR_|REPLACE_|ai_live_xxx)/i.test(apiKey)) throw new Error("Set an active AIVANA_API_KEY in the local .env file, then restart.");
  const portText = env.PORT || "3006";
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const configuredBase = env.AIVANA_API_BASE?.trim();
  let apiBase;
  if (configuredBase) {
    let url;
    try { url = new URL(configuredBase); } catch { throw new Error("AIVANA_API_BASE must be a valid API URL."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || !["/", "/v1", "/v1/"].includes(url.pathname)) {
      throw new Error("AIVANA_API_BASE must be an HTTPS API origin, with no credentials or query string. Loopback HTTP is allowed for tests.");
    }
    apiBase = url.origin;
  }
  return { apiKey, apiBase, port: Number(portText) };
}
