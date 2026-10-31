import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export type Difficulty = 'easy' | 'normal' | 'difficult';
export type PlotState = 'empty' | 'growing' | 'wilted' | 'dead' | 'mature';

export interface Plot {
  id: number;
  cropId: string | null;
  growthProgress: number; // 0..1
  state: PlotState;
  sunnyIdleSeconds: number; // accumulated idle-during-sunny time
  tier: number; // field tier (1 = starting field); permanent, survives harvests
  watered: boolean; // water applied to the current crop (growth boost)
  fertilized: boolean; // fertilizer applied to the current crop (harvest XP boost)
  lastCropId: string | null; // last crop planted here — the auto-planter replants it
}

// A detected coding-agent plan limit (e.g. Claude Code 5-hour or Codex weekly).
// While `until` is in the future the farm's wilt clock is paused.
export interface PlanLimit {
  until: number; // ms epoch when the limit is expected to lift
  detectedAt: number; // ms epoch of the record that reported it
}

export interface GameState {
  version: number;
  onboarded: boolean;
  difficulty: Difficulty;
  workingHours: { startHour: number; endHour: number; days: number[] }; // days: 0=Sun..6=Sat
  coins: number;
  xp: number;
  level: number;
  inventory: Record<string, number>; // cropId → owned seed count (bought in the shop)
  items: Record<string, number>; // supplyId → owned count (water / fertilizer / medicine)
  power: number; // electricity units; tools spend it per automatic action
  tools: Record<string, { on: boolean }>; // toolId → installed (key present) + switched on
  plots: Plot[];
  manualBlocked: boolean; // "I'm blocked" toggle → forces rainy
  devWeather: 'sunny' | 'rainy' | null; // dev-mode weather override; null = auto
  lastActivityAt: number; // ms epoch of last token event
  planLimits: Record<string, PlanLimit>; // agent → detected plan limit (auto rest)
  ingestOffsets: Record<string, number>; // filepath → byte offset already consumed
  createdAt: number;
  updatedAt: number;
}

// Resolved lazily so the state directory reflects the environment at call time.
// An explicit TOKENFARM_STATE_DIR always wins (tests / custom setups). Otherwise
// developer mode gets its own isolated ~/.tokenfarm-dev sandbox so it can never
// touch the real ~/.tokenfarm profile or advance its token-ingest offsets. Reads
// TOKENFARM_DEV directly (not config.isDevMode) to avoid a state↔config cycle.
export function stateDir(): string {
  if (process.env.TOKENFARM_STATE_DIR) return process.env.TOKENFARM_STATE_DIR;
  const dev = process.env.TOKENFARM_DEV === '1';
  return path.join(os.homedir(), dev ? '.tokenfarm-dev' : '.tokenfarm');
}
function stateFile(): string {
  return path.join(stateDir(), 'state.json');
}
// Snapshot of the resolved path at startup, used for the server's boot log.
export const STATE_FILE = stateFile();

export const STATE_VERSION = 2;

export function newPlot(id: number): Plot {
  return {
    id,
    cropId: null,
    growthProgress: 0,
    state: 'empty',
    sunnyIdleSeconds: 0,
    tier: 1,
    watered: false,
    fertilized: false,
    lastCropId: null,
  };
}

export function defaultState(): GameState {
  const now = Date.now();
  return {
    version: STATE_VERSION,
    onboarded: false,
    difficulty: 'normal',
    workingHours: { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
    coins: 0,
    xp: 0,
    level: 1,
    inventory: {},
    items: {},
    power: 0,
    tools: {},
    // A new farm starts with a single plowed field. More fields are unlocked one at
    // a time via the "+" tile (see Engine.plow), which appends a new field.
    plots: [newPlot(0)],
    manualBlocked: false,
    devWeather: null,
    lastActivityAt: 0,
    planLimits: {},
    ingestOffsets: {},
    createdAt: now,
    updatedAt: now,
  };
}

// Bring an older save up to the current schema. The top-level spread fills new
// farm-wide fields (items, power, tools, planLimits); each plot is filled in
// separately because a shallow merge can't reach inside the plots array. Owned
// seeds are kept as-is, even for crops that are now level-locked — the lock only
// applies to buying.
export function migrate(parsed: any): GameState {
  const base = defaultState();
  const merged: GameState = { ...base, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  for (const key of ['inventory', 'items', 'tools', 'planLimits', 'ingestOffsets'] as const) {
    const v = merged[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) (merged as any)[key] = {};
  }
  if (!Number.isFinite(merged.power)) merged.power = 0;
  const plots = Array.isArray(merged.plots) && merged.plots.length ? merged.plots : base.plots;
  merged.plots = plots.map((p: any, i: number) => {
    const fresh = newPlot(Number.isInteger(p?.id) ? p.id : i);
    return {
      ...fresh,
      ...p,
      tier: Number.isInteger(p?.tier) && p.tier >= 1 ? p.tier : 1,
      watered: p?.watered === true,
      fertilized: p?.fertilized === true,
      lastCropId: typeof p?.lastCropId === 'string' ? p.lastCropId : (p?.cropId ?? null),
    };
  });
  merged.version = STATE_VERSION;
  return merged;
}

export function load(): GameState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return migrate(parsed);
  } catch {
    return defaultState();
  }
}

let saveTimer: NodeJS.Timeout | null = null;

export function saveDebounced(state: GameState): void {
  state.updatedAt = Date.now();
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow(state);
  }, 1000);
}

// Drop a pending debounced save. Tests call this before pointing
// TOKENFARM_STATE_DIR elsewhere so a late timer can't write into another profile.
export function cancelPendingSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

export function saveNow(state: GameState): void {
  state.updatedAt = Date.now();
  try {
    const file = stateFile();
    fs.mkdirSync(stateDir(), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[state] save failed', e);
  }
}
