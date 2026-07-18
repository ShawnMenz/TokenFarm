import type { Difficulty } from './state.js';

export const SERVER_PORT = 8787;

// Economy — the primary balance lever is CONVERSION_DIVISOR.
export const CONVERSION_DIVISOR = 100;
export const DIFFICULTY_MULT: Record<Difficulty, number> = {
  easy: 1.5,
  normal: 1.0,
  difficult: 0.5,
};

export const TICK_MS = 1000;
export const PLOT_COUNT = 6;

// Cost to plow a wildland plot into a plantable field.
export const PLOW_COST = 300;

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

export const CROPS: Record<string, Crop> = {
  wheat: {
    id: 'wheat',
    name: 'Wheat',
    emoji: '🌾',
    cost: 1500,
    growSeconds: FAST ? 20 : 1800,
    xpReward: 10,
  },
};

// Wilt/die measured as accumulated sunny-idle time (only ticks during work hours).
export const WILT_SECONDS = FAST ? 30 : 2.5 * WORKING_DAY_SECONDS;
export const DIE_SECONDS = FAST ? 60 : 5 * WORKING_DAY_SECONDS;

// XP required to advance from `level` to `level + 1`.
export function xpForLevel(level: number): number {
  return level * 100;
}
