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
  plots: Plot[];
  manualBlocked: boolean; // "I'm blocked" toggle → forces rainy
  lastActivityAt: number; // ms epoch of last token event
  ingestOffsets: Record<string, number>; // filepath → byte offset already consumed
  createdAt: number;
  updatedAt: number;
}

const DIR = process.env.TOKENFARM_STATE_DIR ?? path.join(os.homedir(), '.tokenfarm');
const FILE = path.join(DIR, 'state.json');
export const STATE_FILE = FILE;

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
    // A new farm starts with a single plowed field. More fields are unlocked one at
    // a time via the "+" tile (see Engine.plow), which appends a new field.
    plots: [
      { id: 0, cropId: null, growthProgress: 0, state: 'empty' as PlotState, sunnyIdleSeconds: 0 },
    ],
    manualBlocked: false,
    lastActivityAt: 0,
    ingestOffsets: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function load(): GameState {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
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
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[state] save failed', e);
  }
}
