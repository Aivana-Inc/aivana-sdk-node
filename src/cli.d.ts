// Type definitions for @aivana/sdk/cli — the `aivana` command, shipped to users as
// @aivana/cli. Most code wants the SDK itself; this is for running the command.

/** What the CLI needs from stdin: a TTY flag, and the stream events it reads. */
export interface CliInput {
  isTTY?: boolean;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  destroy?(): unknown;
}

/** Replacements for the process's streams, environment and fetch (for tests). */
export interface CliIO {
  env?: Record<string, string | undefined>;
  /** `null` means no stdin at all. */
  stdin?: CliInput | null;
  stdout?: { write(chunk: string): unknown; isTTY?: boolean };
  stderr?: { write(chunk: string): unknown; isTTY?: boolean };
  fetch?: typeof fetch;
  /** How long to wait for piped input to start when a question was given. */
  stdinWaitMs?: number;
}

/** Run `aivana ARGV...` and resolve to its exit code. */
export function main(argv?: string[], io?: CliIO): Promise<number>;

/** Run as the process: handles Ctrl-C and a closed pipe, then sets process.exitCode. */
export function run(): Promise<void>;

/** Sent as `metadata.request_source` on every request. */
export const REQUEST_SOURCE: string;
export const STDIN_WAIT_MS: number;

export const EXIT_OK: 0;
export const EXIT_FAILED: 1;
export const EXIT_USAGE: 2;
export const EXIT_AUTH: 3;
export const EXIT_RATE_LIMITED: 4;
export const EXIT_NO_CREDIT: 5;
export const EXIT_TEMPORARY: 6;
export const EXIT_INTERRUPTED: 130;
