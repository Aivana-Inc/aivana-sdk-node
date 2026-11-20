import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORY = fileURLToPath(new URL("./", import.meta.url));
const RAW_LIMIT = 256 * 1024;
const DEFINITION_LIMIT = 64 * 1024;

export class BlueprintError extends Error {
  constructor(message) { super(`Blueprint: ${message}`); this.name = "BlueprintError"; }
}
function requireValue(condition, message) {
  if (!condition) throw new BlueprintError(message);
}
function closed(value, required, optional = []) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "Use a definition object downloaded from Agent Kit’s Inspect / export panel.");
  requireValue(required.every((key) => Object.hasOwn(value, key)), "Required fields are missing. Export the full definition from Agent Kit again.");
  requireValue(Object.keys(value).every((key) => [...required, ...optional].includes(key)), "Unrecognized fields. Use the definition JSON, not a saved resource, API request, or custom settings object.");
}
function numeric(value, name, min, max, integer = false) {
  requireValue(value === null || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))), `${name} must be null or ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
}

/** Compile the existing Agent Kit definition into documented SDK options. Never coerce or drop a setting. */
export function compileBlueprint(definition) {
  closed(definition, ["purpose", "configuration", "conversation"], ["knowledge"]);
  requireValue(Buffer.byteLength(JSON.stringify(definition), "utf8") <= DEFINITION_LIMIT, "The definition exceeds 64 KiB of compact JSON.");
  requireValue(typeof definition.purpose === "string" && definition.purpose.trim().length > 0 && definition.purpose.length <= 1000, "Purpose must contain 1 to 1,000 characters.");
  requireValue(definition.knowledge == null, "Sources / Knowledge are not supported by this starter. Use a blueprint without Sources; no retrieval fallback is made.");
  closed(definition.conversation, ["history"]);
  requireValue(["none", "session"].includes(definition.conversation.history), "Conversation history must be none or session.");
  const c = definition.configuration;
  closed(c, ["system", "effort", "web_search", "temperature", "top_p", "max_tokens", "stop_sequences", "response_format"]);
  requireValue(typeof c.system === "string" && c.system.length <= 8000, "System instructions must be a string of at most 8,000 characters.");
  requireValue(["auto", "low", "medium", "high"].includes(c.effort), "Effort must be auto, low, medium, or high.");
  requireValue(typeof c.web_search === "boolean", "Web Search Allowed must be true or false.");
  numeric(c.temperature, "Temperature", 0, 2);
  numeric(c.top_p, "Top-P", 0, 1);
  numeric(c.max_tokens, "Max Tokens", 1, 32000, true);
  requireValue(c.temperature === null || c.top_p === null, "Temperature and Top-P cannot both be set. Choose one in Agent Kit and export again.");
  requireValue(Array.isArray(c.stop_sequences) && c.stop_sequences.length <= 4 && c.stop_sequences.every((s) => typeof s === "string" && s.length > 0), "Use at most four non-empty stop sequences.");
  closed(c.response_format, ["type"], ["schema"]);
  requireValue(c.response_format.type !== "json_schema", "JSON Schema (Strict) is not supported by this text chat starter. Choose Text explicitly in Agent Kit and export again; no automatic conversion is made.");
  requireValue(c.response_format.type === "text" && c.response_format.schema == null, "Response format must be text with no schema.");
  const options = { system: c.system, effort: c.effort, webSearch: c.web_search, responseFormat: Object.freeze({ type: "text" }) };
  for (const [field, sdk] of [["temperature", "temperature"], ["top_p", "topP"], ["max_tokens", "maxTokens"]]) {
    if (c[field] !== null) options[sdk] = c[field];
  }
  if (c.stop_sequences.length) options.stopSequences = Object.freeze([...c.stop_sequences]);
  // Purpose is descriptive metadata, not an instruction. Do not add it to system or messages.
  return Object.freeze({ options: Object.freeze(options), history: definition.conversation.history });
}

/** Optional conventional filename; an explicitly configured missing file always stops startup. */
export function loadBlueprint(env = process.env, directory = DIRECTORY) {
  const configured = env.AIVANA_BLUEPRINT_FILE?.trim();
  const path = resolve(directory, configured || "blueprint-definition.json");
  let fd;
  try { fd = openSync(path, "r"); }
  catch (error) {
    if (!configured && error.code === "ENOENT") return null;
    throw new BlueprintError("Cannot open the definition file. Check AIVANA_BLUEPRINT_FILE and file permissions, then restart.");
  }
  let text;
  try {
    const stat = fstatSync(fd);
    requireValue(stat.isFile(), "The definition path must point to a regular JSON file.");
    requireValue(stat.size <= RAW_LIMIT, "The JSON file exceeds 256 KiB. Export a smaller definition.");
    const buffer = Buffer.alloc(RAW_LIMIT + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    requireValue(count <= RAW_LIMIT, "The JSON file exceeds 256 KiB. Export a smaller definition.");
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)); }
    catch { throw new BlueprintError("The definition file must contain UTF-8 JSON."); }
  } catch (error) {
    if (error instanceof BlueprintError) throw error;
    throw new BlueprintError("Cannot read the definition file. Check file permissions, then restart.");
  } finally { closeSync(fd); }
  let definition;
  try { definition = JSON.parse(text); }
  catch { throw new BlueprintError("The file is not valid JSON. Export it again; file contents were not logged."); }
  compileBlueprint(definition);
  return definition;
}
