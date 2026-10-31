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

// A plan-limit signal parsed from an agent's log: the agent hit a usage limit
// (5-hour / weekly …) until `until`, or a later record shows it is clear again.
export interface LimitEvent {
  agent: string;
  state: 'limited' | 'clear';
  until?: number; // ms epoch the limit lifts (only for 'limited')
  at: number; // ms epoch of the record that reported it
}
