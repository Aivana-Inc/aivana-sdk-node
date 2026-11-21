export const BLUEPRINT_NAME_MAX = 80;

/**
 * The optional display name for a loaded Blueprint (AIVANA_BLUEPRINT_NAME). An Agent Kit export carries a purpose but
 * no name (the name is resource metadata and is deliberately not part of the immutable definition), so the person
 * running the starter chooses one here. One plain line; it is shown as text, never as markup. Blank means none.
 */
export function parseBlueprintName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return undefined;
  let plain = name.length <= BLUEPRINT_NAME_MAX;
  for (const char of name) {
    const code = char.codePointAt(0);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) plain = false; // no line breaks or control characters
  }
  if (!plain) throw new Error(`AIVANA_BLUEPRINT_NAME must be a single line of at most ${BLUEPRINT_NAME_MAX} characters.`);
  return name;
}

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
  return { apiKey, apiBase, port: Number(portText), blueprintName: parseBlueprintName(env.AIVANA_BLUEPRINT_NAME) };
}
