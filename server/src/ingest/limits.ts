// Plan-limit detection. Pure functions that read one parsed JSONL record from a
// coding agent's log and report whether it says the agent has hit a usage limit
// (and until when), or that it is clear again. Adapters call these on every record
// and forward non-null results to the engine, which pauses the wilt clock while a
// limit is active.
import { LIMIT_FALLBACK_MS } from '../game/config.js';
import type { LimitEvent } from './types.js';

// Phrases that mean a plan/usage limit (not a transient per-minute 429).
const LIMIT_TEXT = /usage limit|limit reached|hit your limit/i;

function recordTime(record: any, now: number): number {
  const t = Date.parse(record?.timestamp ?? '');
  return Number.isFinite(t) ? t : now;
}

// Epoch seconds or milliseconds → ms.
function epochMs(n: number): number {
  return n < 1e12 ? n * 1000 : n;
}

// The next local wall-clock time at/after `from` matching e.g. "3pm", "3:30 pm",
// "15:00". Returns null when the text has no recognizable reset time.
export function parseResetClock(text: string, from: number): number | null {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const d = new Date(from);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// "try again in 2 days 3 hours 5 minutes" → ms offset, or null.
export function parseRetryIn(text: string): number | null {
  const tail = /(?:try again|resets?) in ([^.]+)/i.exec(text)?.[1];
  if (!tail) return null;
  const unit: Record<string, number> = { day: 86_400_000, hour: 3_600_000, minute: 60_000, second: 1000 };
  let total = 0;
  for (const m of tail.matchAll(/(\d+)\s*(day|hour|minute|second)s?/gi)) {
    total += Number(m[1]) * unit[m[2].toLowerCase()];
  }
  return total > 0 ? total : null;
}

function resetFromText(text: string, at: number): number {
  const epoch = /\|(\d{10,13})\b/.exec(text);
  if (epoch) return epochMs(Number(epoch[1]));
  const clock = parseResetClock(text, at);
  if (clock !== null) return clock;
  const retry = parseRetryIn(text);
  if (retry !== null) return at + retry;
  return at + LIMIT_FALLBACK_MS;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as any).text === 'string' ? (part as any).text : ''))
      .join(' ');
  }
  return '';
}

// Claude Code writes a synthetic assistant record with `isApiErrorMessage: true`
// when a request fails. A usage limit carries an `error` code like `rate_limit`
// and/or text such as "Claude AI usage limit reached|<epoch>" or "You've hit your
// limit · resets 3pm". Other API errors (e.g. `authentication_failed`) are ignored.
// Claude logs carry no "clear" signal; the engine clears the limit when real usage
// resumes or `until` passes.
export function detectClaudeLimit(record: any, now: number = Date.now()): LimitEvent | null {
  if (!record || typeof record !== 'object' || record.isApiErrorMessage !== true) return null;
  const text = textOf(record.message?.content);
  const code = typeof record.error === 'string' ? record.error : '';
  if (!/rate_limit/i.test(code) && !LIMIT_TEXT.test(text)) return null;
  const at = recordTime(record, now);
  return { agent: 'claude', state: 'limited', until: resetFromText(text, at), at };
}

interface CodexWindow {
  used_percent?: unknown;
  resets_at?: unknown;
  resets_in_seconds?: unknown;
}

function windowReset(w: CodexWindow, at: number): number | null {
  if (typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)) return epochMs(w.resets_at);
  if (typeof w.resets_in_seconds === 'number' && Number.isFinite(w.resets_in_seconds)) {
    return at + w.resets_in_seconds * 1000;
  }
  return null;
}

// Codex `token_count` events carry a `rate_limits` snapshot: primary/secondary
// windows with `used_percent` and `resets_at` (epoch s; older logs use
// `resets_in_seconds`), plus `rate_limit_reached_type` once a limit is hit. A
// snapshot under the limit reports "clear". A Codex `error` event that mentions a
// usage limit also counts.
export function detectCodexLimit(record: any, now: number = Date.now()): LimitEvent | null {
  if (!record || typeof record !== 'object' || record.type !== 'event_msg') return null;
  const payload = record.payload;
  if (!payload || typeof payload !== 'object') return null;
  const at = recordTime(record, now);

  if (payload.type === 'token_count') {
    const rl = payload.rate_limits;
    if (!rl || typeof rl !== 'object') return null;
    const windows = [rl.primary, rl.secondary].filter(
      (w): w is CodexWindow => !!w && typeof w === 'object',
    );
    const full = windows.filter((w) => Number(w.used_percent) >= 100);
    const reachedType = rl.rate_limit_reached_type;
    const reached = (reachedType !== null && reachedType !== undefined && reachedType !== '') || full.length > 0;
    if (!reached) return { agent: 'codex', state: 'clear', at };
    const resets = (full.length ? full : windows)
      .map((w) => windowReset(w, at))
      .filter((n): n is number => n !== null);
    const until = resets.length ? Math.max(...resets) : at + LIMIT_FALLBACK_MS;
    return { agent: 'codex', state: 'limited', until, at };
  }

  if (payload.type === 'error') {
    const text = typeof payload.message === 'string' ? payload.message : '';
    if (!LIMIT_TEXT.test(text)) return null;
    return { agent: 'codex', state: 'limited', until: resetFromText(text, at), at };
  }
  return null;
}
