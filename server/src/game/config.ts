import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Difficulty } from './state.js';

// Defaults to 8787; TOKENFARM_PORT overrides it so an isolated or second instance
// can run without clashing with a primary one.
export const SERVER_PORT = Number(process.env.TOKENFARM_PORT) || 8787;

// Developer mode is decided by the npm entry point: `npm run dev` sets
// TOKENFARM_DEV=1 (see dev:server), `npm start` does not. Read dynamically so
// the flag is testable and reflects the environment at call time.
export const isDevMode = (): boolean => process.env.TOKENFARM_DEV === '1';

// ---- canonical price record ----
// prices.json is the single source of truth for every priced value. It is edited
// by hand to tune the economy; the constants below are derived from it at startup.
interface CropPrice {
  name: string;
  emoji: string;
  coinCost: number;
  growMinutes: number;
  xpReward: number;
}
interface XpBand {
  throughLevel: number; // this rate applies for levels up through here (inclusive)
  xpPerLevel: number; // XP required to advance each level within the band
}
interface Prices {
  plowCost: number;
  conversionDivisor: number;
  difficultyMultipliers: Record<Difficulty, number>;
  xpLevelBands: XpBand[];
  crops: Record<string, CropPrice>;
}

const PRICES_FILE = path.resolve(fileURLToPath(import.meta.url), '../prices.json');
const prices = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8')) as Prices;

// Economy — the primary balance lever is CONVERSION_DIVISOR.
export const CONVERSION_DIVISOR = prices.conversionDivisor;
export const DIFFICULTY_MULT: Record<Difficulty, number> = prices.difficultyMultipliers;

export const TICK_MS = 1000;
export const PLOT_COUNT = 6;

// Cost to plow a wildland plot into a plantable field.
export const PLOW_COST = prices.plowCost;

// TOKENFARM_FAST=1 shrinks all durations so the loop is observable in seconds.
const FAST = process.env.TOKENFARM_FAST === '1';

// An agent counts as "active" (sun rays for growth) if a token event arrived within
// this window. Shrunk under FAST so idle/wilt is reachable in a test run.
export const ACTIVE_WINDOW_MS = FAST ? 3_000 : 120_000;
const WORKING_DAY_SECONDS = 8 * 3600;

export interface Crop {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  growSeconds: number; // active-sunny time to reach maturity
  xpReward: number;
}

// Build the runtime crop table from the price record. Under FAST, growth is
// compressed to seconds so the whole loop is observable in a test run.
export const CROPS: Record<string, Crop> = Object.fromEntries(
  Object.entries(prices.crops).map(([id, c]) => [
    id,
    {
      id,
      name: c.name,
      emoji: c.emoji,
      cost: c.coinCost,
      growSeconds: FAST ? Math.max(5, Math.round(c.growMinutes)) : c.growMinutes * 60,
      xpReward: c.xpReward,
    },
  ]),
);

// Wilt/die measured as accumulated sunny-idle time (only ticks during work hours).
export const WILT_SECONDS = FAST ? 30 : 2.5 * WORKING_DAY_SECONDS;
export const DIE_SECONDS = FAST ? 60 : 5 * WORKING_DAY_SECONDS;

// XP required to advance from `level` to `level + 1`, following the gradually
// ascending band curve. Levels beyond the last band hold at its rate — the curve
// keeps going with no level cap.
export function xpForLevel(level: number): number {
  const bands = prices.xpLevelBands;
  for (const band of bands) {
    if (level <= band.throughLevel) return band.xpPerLevel;
  }
  return bands[bands.length - 1].xpPerLevel;
}
