// Type definitions for @aivana/sdk

export type Mode = "fast" | "balanced" | "aivana_mmi";
export type OutputShape =
  | "auto"
  | "text"
  | "recommendation"
  | "summary"
  | "tradeoffs"
  | "decision"
  | "extract";

export interface AivanaConfig {
  apiKey?: string;
  apiBase?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  mode?: Mode;
  temperature?: number;
  messages?: ChatMessage[];
  previousIntent?: string;
  outputShape?: OutputShape;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface IntentEnvelope {
  name: string;
  confidence: number;
  signal: string;
}

export interface UsageEnvelope {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  credits: number;
}

export interface StageEnvelope {
  name: string;
  ms: number;
  info: Record<string, unknown>;
}

export interface GenerateResponse {
  id: string;
  object: "generation";
  mode: Mode;
  intent: IntentEnvelope;
  output_format: string;
  output_shape: OutputShape;
  answer: string;
  structured: Record<string, unknown> | null;
  structured_error: string | null;
  confidence: number;
  model: string;
  provider: string;
  models_used: string[];
  usage: UsageEnvelope;
  latency_ms: number;
  stages: StageEnvelope[];
  finish_reason: string;
}

export interface StreamChunk {
  event: string;
  data: Record<string, unknown>;
}

export interface QuotaResponse {
  user_id: string;
  plan: string;
  limits: Record<string, number | string[]>;
  counters: Record<string, Record<string, number>>;
}

export class AivanaError extends Error {
  code: string;
  requestId: string | null;
  status: number;
}
export class AuthError extends AivanaError {}
export class ForbiddenError extends AivanaError {}
export class RateLimitError extends AivanaError {}
export class InvalidRequestError extends AivanaError {}
export class UpstreamError extends AivanaError {}

export class Chat {
  messages: ChatMessage[];
  send(content: string, opts?: GenerateOptions): Promise<GenerateResponse>;
  reset(): void;
}

export class Aivana {
  apiKey: string | null;
  apiBase: string;
  constructor(cfg?: AivanaConfig);
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResponse>;
  generateStream(prompt: string, opts?: GenerateOptions): AsyncGenerator<StreamChunk>;
  chat(opts?: Pick<GenerateOptions, "mode" | "temperature" | "outputShape">): Chat;
  quotas(): Promise<QuotaResponse>;
}

export default Aivana;
