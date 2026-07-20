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
  plots: Plot[];
  manualBlocked: boolean; // "I'm blocked" toggle → forces rainy
  devWeather: 'sunny' | 'rainy' | null; // dev-mode weather override; null = auto
  lastActivityAt: number; // ms epoch of last token event
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

export function defaultState(): GameState {
  const now = Date.now();
  return {
    version: 1,
    onboarded: false,
    difficulty: 'normal',
    workingHours: { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
    coins: 0,
    xp: 0,
    level: 1,
    inventory: {},
    // A new farm starts with a single plowed field. More fields are unlocked one at
    // a time via the "+" tile (see Engine.plow), which appends a new field.
    plots: [
      { id: 0, cropId: null, growthProgress: 0, state: 'empty' as PlotState, sunnyIdleSeconds: 0 },
    ],
    manualBlocked: false,
    devWeather: null,
    lastActivityAt: 0,
    ingestOffsets: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function load(): GameState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return { ...defaultState(), ...parsed };
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
