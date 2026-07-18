// A normalized token-usage event emitted by any agent adapter.
export interface TokenEvent {
  agent: string; // e.g. 'claude' or 'codex'
  tokens: number; // provider-normalized input/cache-creation/output tokens
  at: number; // ms epoch
}

// Pluggable per-agent ingestion adapter. Every provider feeds the same event stream.
export interface Adapter {
  start(): void;
  stop?(): void;
}
