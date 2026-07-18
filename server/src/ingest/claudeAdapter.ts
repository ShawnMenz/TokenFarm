import os from 'node:os';
import path from 'node:path';
import { JsonlTailer } from './jsonlTailer.js';
import type { Adapter, TokenEvent } from './types.js';

// Root dir of Claude Code session logs. Overridable via env so tests can point at
// a synthetic directory.
const DEFAULT_ROOT = path.join(os.homedir(), '.claude', 'projects');

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  // Newer Claude payloads sometimes express cache_creation as a breakdown object.
  if (v && typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).reduce<number>(
      (acc, x) => acc + (typeof x === 'number' ? x : 0),
      0,
    );
  }
  return 0;
}

// Countable "money" tokens for a usage object: new input + cache creation + output.
// cache_read is deliberately excluded (repeated context would flood the economy).
export function sumUsage(usage: any): number {
  if (!usage || typeof usage !== 'object') return 0;
  return (
    num(usage.input_tokens) +
    num(usage.cache_creation_input_tokens) +
    num(usage.output_tokens)
  );
}

// Pull a usage object out of a parsed JSONL line, wherever Claude puts it.
export function extractUsage(obj: any): any | null {
  return obj?.message?.usage ?? obj?.usage ?? null;
}

interface ClaudeAdapterOpts {
  root?: string;
  // Byte offset per file already consumed. Mutated in place so the caller can
  // persist it as part of game state (resume across restarts).
  offsets: Record<string, number>;
  onEvent: (e: TokenEvent) => void;
}

export class ClaudeAdapter implements Adapter {
  private readonly tailer: JsonlTailer;

  constructor(opts: ClaudeAdapterOpts) {
    this.tailer = new JsonlTailer({
      root: opts.root ?? process.env.TOKENFARM_CLAUDE_DIR ?? DEFAULT_ROOT,
      source: 'claude',
      offsets: opts.offsets,
      onRecord: (record) => {
        const tokens = sumUsage(extractUsage(record));
        if (tokens > 0) {
          opts.onEvent({ agent: 'claude', tokens, at: Date.now() });
        }
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
