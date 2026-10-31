import os from 'node:os';
import path from 'node:path';
import { JsonlTailer } from './jsonlTailer.js';
import { detectCodexLimit } from './limits.js';
import type { Adapter, LimitEvent, TokenEvent } from './types.js';

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

interface CodexUsage {
  input_tokens?: unknown;
  cache_write_input_tokens?: unknown;
  output_tokens?: unknown;
}

// Align Codex currency with Claude's input + cache creation + output model.
// Codex calls cache creation "cache writes"; cached-input metadata is not deducted.
export function sumCodexUsage(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0;
  const value = usage as CodexUsage;
  return (
    count(value.input_tokens) +
    count(value.cache_write_input_tokens) +
    count(value.output_tokens)
  );
}

// token_count also carries cumulative totals; last_token_usage is the per-turn
// delta and is the only safe value to ingest without double-counting.
export function extractCodexUsage(record: unknown): unknown | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as {
    type?: unknown;
    payload?: {
      type?: unknown;
      info?: { last_token_usage?: unknown } | null;
    };
  };
  if (value.type !== 'event_msg' || value.payload?.type !== 'token_count') {
    return null;
  }
  return value.payload.info?.last_token_usage ?? null;
}

export function resolveCodexRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (env.TOKENFARM_CODEX_DIR) return env.TOKENFARM_CODEX_DIR;
  if (env.CODEX_HOME) return path.join(env.CODEX_HOME, 'sessions');
  return path.join(home, '.codex', 'sessions');
}

interface CodexAdapterOpts {
  root?: string;
  offsets: Record<string, number>;
  onEvent: (event: TokenEvent) => void;
  // Plan-limit signals parsed from the same records (optional).
  onLimit?: (event: LimitEvent) => void;
}

export class CodexAdapter implements Adapter {
  private readonly tailer: JsonlTailer;

  constructor(opts: CodexAdapterOpts) {
    this.tailer = new JsonlTailer({
      root: opts.root ?? resolveCodexRoot(),
      source: 'codex',
      offsets: opts.offsets,
      onRecord: (record) => {
        const tokens = sumCodexUsage(extractCodexUsage(record));
        if (tokens > 0) {
          opts.onEvent({ agent: 'codex', tokens, at: Date.now() });
        }
        const limit = opts.onLimit ? detectCodexLimit(record) : null;
        if (limit) opts.onLimit!(limit);
      },
    });
  }

  start(): void {
    this.tailer.start();
  }

  stop(): void {
    this.tailer.stop();
  }
}
