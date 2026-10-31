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
  unlockLevel?: number; // level required to buy this seed (default 1)
  minFieldTier?: number; // lowest field tier it can be planted on (default 1)
}
interface XpBand {
  throughLevel: number; // this rate applies for levels up through here (inclusive)
  xpPerLevel: number; // XP required to advance each level within the band
}
interface SupplyPrice {
  name: string;
  emoji: string;
  coinCost: number;
  unlockLevel: number;
  growthMultiplier?: number; // water: faster growth for the crop it is applied to
  xpMultiplier?: number; // fertilizer: more harvest XP for the crop it is applied to
}
interface FieldTierPrice {
  tier: number;
  name: string;
  upgradeCost: number; // coins to upgrade a field *to* this tier
  unlockLevel: number;
  growthMultiplier: number;
}
interface ToolPrice {
  name: string;
  emoji: string;
  coinCost: number;
  unlockLevel: number;
  powerPerUse: number; // electricity spent per automatic action
}
interface Prices {
  plowCost: number;
  conversionDivisor: number;
  difficultyMultipliers: Record<Difficulty, number>;
  xpLevelBands: XpBand[];
  crops: Record<string, CropPrice>;
  supplies: Record<string, SupplyPrice>;
  fieldTiers: FieldTierPrice[];
  electricity: { coinCost: number; packSize: number; unlockLevel: number };
  tools: Record<string, ToolPrice>;
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
  unlockLevel: number;
  minFieldTier: number;
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
      unlockLevel: c.unlockLevel ?? 1,
      minFieldTier: c.minFieldTier ?? 1,
    },
  ]),
);

// ---- supplies, field tiers, electricity, tools ----
export interface Supply {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  unlockLevel: number;
  growthMultiplier: number; // 1 = no effect
  xpMultiplier: number; // 1 = no effect
}
export const SUPPLIES: Record<string, Supply> = Object.fromEntries(
  Object.entries(prices.supplies ?? {}).map(([id, s]) => [
    id,
    {
      id,
      name: s.name,
      emoji: s.emoji,
      cost: s.coinCost,
      unlockLevel: s.unlockLevel,
      growthMultiplier: s.growthMultiplier ?? 1,
      xpMultiplier: s.xpMultiplier ?? 1,
    },
  ]),
);

export interface FieldTier {
  tier: number;
  name: string;
  upgradeCost: number;
  unlockLevel: number;
  growthMultiplier: number;
}
// Sorted by tier; tier 1 is the starting field every plot begins as.
export const FIELD_TIERS: FieldTier[] = [...(prices.fieldTiers ?? [])].sort((a, b) => a.tier - b.tier);
export const MAX_FIELD_TIER = FIELD_TIERS.length ? FIELD_TIERS[FIELD_TIERS.length - 1].tier : 1;
export function fieldTier(tier: number): FieldTier | undefined {
  return FIELD_TIERS.find((t) => t.tier === tier);
}

export interface PowerPack {
  cost: number;
  packSize: number;
  unlockLevel: number;
}
export const POWER_PACK: PowerPack = {
  cost: prices.electricity.coinCost,
  packSize: prices.electricity.packSize,
  unlockLevel: prices.electricity.unlockLevel,
};

export interface Tool {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  unlockLevel: number;
  powerPerUse: number;
}
export const TOOLS: Record<string, Tool> = Object.fromEntries(
  Object.entries(prices.tools ?? {}).map(([id, t]) => [
    id,
    { id, name: t.name, emoji: t.emoji, cost: t.coinCost, unlockLevel: t.unlockLevel, powerPerUse: t.powerPerUse },
  ]),
);

// What the next level-up that unlocks anything will open: the lowest unlock level
// above `level`, and every crop/supply/field tier/tool/electricity it opens. Null
// once everything is unlocked.
export interface UnlockEntry {
  kind: 'crop' | 'supply' | 'tier' | 'tool' | 'power';
  id: string;
  name: string;
  emoji: string;
}
export function nextUnlocks(level: number): { level: number; items: UnlockEntry[] } | null {
  const all: (UnlockEntry & { unlockLevel: number })[] = [
    ...Object.values(CROPS).map((c) => ({ kind: 'crop' as const, id: c.id, name: c.name, emoji: c.emoji, unlockLevel: c.unlockLevel })),
    ...Object.values(SUPPLIES).map((s) => ({ kind: 'supply' as const, id: s.id, name: s.name, emoji: s.emoji, unlockLevel: s.unlockLevel })),
    ...FIELD_TIERS.filter((t) => t.tier > 1).map((t) => ({ kind: 'tier' as const, id: String(t.tier), name: t.name, emoji: '⬆️', unlockLevel: t.unlockLevel })),
    ...Object.values(TOOLS).map((t) => ({ kind: 'tool' as const, id: t.id, name: t.name, emoji: t.emoji, unlockLevel: t.unlockLevel })),
    { kind: 'power' as const, id: 'power', name: 'Electricity', emoji: '⚡', unlockLevel: POWER_PACK.unlockLevel },
  ];
  const upcoming = all.filter((e) => e.unlockLevel > level);
  if (!upcoming.length) return null;
  const next = Math.min(...upcoming.map((e) => e.unlockLevel));
  return {
    level: next,
    items: upcoming.filter((e) => e.unlockLevel === next).map(({ unlockLevel: _u, ...e }) => e),
  };
}

// How long a detected plan limit protects the farm when the log gives no reset time.
export const LIMIT_FALLBACK_MS = 5 * 3600 * 1000;

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
