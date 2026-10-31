import {
  defaultState,
  load,
  newPlot,
  saveDebounced,
  saveNow,
  type Difficulty,
  type GameState,
  type Plot,
} from './state.js';
import { weatherNow, type Weather } from './weather.js';
import {
  ACTIVE_WINDOW_MS,
  CONVERSION_DIVISOR,
  CROPS,
  DIE_SECONDS,
  DIFFICULTY_MULT,
  FIELD_TIERS,
  fieldTier,
  isDevMode,
  MAX_FIELD_TIER,
  nextUnlocks,
  PLOW_COST,
  POWER_PACK,
  SUPPLIES,
  TICK_MS,
  TOOLS,
  WILT_SECONDS,
  xpForLevel,
} from './config.js';
import type { LimitEvent, TokenEvent } from '../ingest/types.js';

export interface Snapshot extends GameState {
  weather: Weather;
  active: boolean;
  crops: typeof CROPS;
  wiltSeconds: number;
  dieSeconds: number;
  plowCost: number;
  difficultyMultipliers: Record<Difficulty, number>;
  conversionDivisor: number; // tokens → coins divisor (for the dev token-flow preview)
  xpNeed: number; // XP required to reach the next level from the current one
  supplies: typeof SUPPLIES;
  fieldTiers: typeof FIELD_TIERS;
  maxFieldTier: number;
  toolCatalog: typeof TOOLS;
  powerPack: typeof POWER_PACK;
  activeLimits: { agent: string; until: number }[]; // plan limits currently protecting the farm
  nextUnlocks: ReturnType<typeof nextUnlocks>;
  devMode: boolean;
  now: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type Listener = (snap: Snapshot) => void;

export class Engine {
  state: GameState;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.state = load();
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  snapshot(now: number = Date.now()): Snapshot {
    return {
      ...this.state,
      coins: Math.floor(this.state.coins), // currency is presented as whole integers, rounded down
      weather: weatherNow(this.state, now),
      active: now - this.state.lastActivityAt < ACTIVE_WINDOW_MS,
      crops: CROPS,
      wiltSeconds: WILT_SECONDS,
      dieSeconds: DIE_SECONDS,
      plowCost: PLOW_COST,
      difficultyMultipliers: DIFFICULTY_MULT,
      conversionDivisor: CONVERSION_DIVISOR,
      xpNeed: xpForLevel(this.state.level),
      supplies: SUPPLIES,
      fieldTiers: FIELD_TIERS,
      maxFieldTier: MAX_FIELD_TIER,
      toolCatalog: TOOLS,
      powerPack: POWER_PACK,
      activeLimits: this.activeLimits(now),
      nextUnlocks: nextUnlocks(this.state.level),
      devMode: isDevMode(),
      now,
    };
  }

  // Plan limits whose reset time is still in the future.
  activeLimits(now: number = Date.now()): { agent: string; until: number }[] {
    return Object.entries(this.state.planLimits)
      .filter(([, l]) => l.until > now)
      .map(([agent, l]) => ({ agent, until: l.until }));
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- ingestion ----
  ingest(e: TokenEvent): void {
    const mult = DIFFICULTY_MULT[this.state.difficulty] ?? 1;
    this.state.coins += (e.tokens * mult) / CONVERSION_DIVISOR;
    this.state.lastActivityAt = e.at;
    // Real usage from an agent proves its plan limit has lifted.
    if (this.state.planLimits[e.agent]) delete this.state.planLimits[e.agent];
    saveDebounced(this.state);
    this.emit();
  }

  // A plan-limit signal from an agent's log (see ingest/limits.ts). 'limited' with
  // a future reset time protects the farm until then; 'clear' lifts it early.
  reportLimit(e: LimitEvent, now: number = Date.now()): void {
    const current = this.state.planLimits[e.agent];
    if (e.state === 'clear') {
      if (!current) return;
      delete this.state.planLimits[e.agent];
    } else {
      if (e.until === undefined || e.until <= now) return; // stale: already reset
      if (current && current.until === e.until) return;
      this.state.planLimits[e.agent] = { until: e.until, detectedAt: e.at };
    }
    saveNow(this.state);
    this.emit();
  }

  // ---- simulation ----
  // One simulated second. Public so tests can step the farm deterministically.
  tick(now: number = Date.now()): void {
    const weather = weatherNow(this.state, now);
    const active = now - this.state.lastActivityAt < ACTIVE_WINDOW_MS;
    const limited = this.activeLimits(now).length > 0;
    const dt = TICK_MS / 1000;

    for (const plot of this.state.plots) {
      if (plot.state !== 'growing' && plot.state !== 'wilted') continue;
      const crop = plot.cropId ? CROPS[plot.cropId] : null;
      if (!crop) continue;

      if (weather === 'sunny' && active) {
        // Sun is out and the agent is working: grow, and revive any wilt. Field
        // tier and water speed growth up.
        if (plot.state === 'wilted') plot.state = 'growing';
        plot.sunnyIdleSeconds = 0;
        plot.growthProgress += (dt / crop.growSeconds) * this.growthMultiplier(plot);
        if (plot.growthProgress >= 1) {
          plot.growthProgress = 1;
          plot.state = 'mature';
        }
      } else if (weather === 'sunny' && !active && !limited) {
        // Working hours but idle: the decay clock ticks — unless an agent is at
        // its plan limit, in which case the idleness isn't the player's fault.
        plot.sunnyIdleSeconds += dt;
        if (plot.sunnyIdleSeconds >= DIE_SECONDS) plot.state = 'dead';
        else if (plot.sunnyIdleSeconds >= WILT_SECONDS) plot.state = 'wilted';
      }
      // rainy or plan-limited → protected: no idle accrual.
    }

    // Forget limits whose reset time has passed.
    for (const [agent, l] of Object.entries(this.state.planLimits)) {
      if (l.until <= now) delete this.state.planLimits[agent];
    }

    this.runAutomation();

    saveDebounced(this.state);
    this.emit();
  }

  private growthMultiplier(plot: Plot): number {
    const tierMult = fieldTier(plot.tier)?.growthMultiplier ?? 1;
    const waterMult = plot.watered ? (SUPPLIES.water?.growthMultiplier ?? 1) : 1;
    return tierMult * waterMult;
  }

  // ---- automation ----
  // Installed, switched-on tools act once per tick, each action costing that
  // tool's electricity. Order: harvest → replant → water, so a cycle can complete
  // within one tick. Tools only spend coins' worth of power — they never produce
  // coins, so tokens stay the only coin faucet.
  private runAutomation(): void {
    for (const plot of this.state.plots) {
      if (plot.state === 'mature' && this.useTool('harvester')) this.harvestPlot(plot);
    }
    for (const plot of this.state.plots) {
      if (plot.state !== 'empty') continue;
      const seed = this.pickSeed(plot);
      if (seed && this.useTool('planter')) this.plantPlot(plot, seed);
    }
    for (const plot of this.state.plots) {
      if (plot.state === 'growing' && !plot.watered && this.useTool('sprinkler')) plot.watered = true;
    }
  }

  // Spend one use of a tool's power if it is installed, switched on, and powered.
  private useTool(toolId: string): boolean {
    const tool = TOOLS[toolId];
    if (!tool || !this.state.tools[toolId]?.on) return false;
    if (this.state.power < tool.powerPerUse) return false;
    this.state.power -= tool.powerPerUse;
    return true;
  }

  // The planter's choice for an empty field: the crop last grown there if a seed
  // is in stock, else the most valuable owned seed the field's tier can hold.
  private pickSeed(plot: Plot): string | null {
    const fits = (id: string) =>
      (this.state.inventory[id] ?? 0) > 0 && !!CROPS[id] && CROPS[id].minFieldTier <= plot.tier;
    if (plot.lastCropId && fits(plot.lastCropId)) return plot.lastCropId;
    const owned = Object.values(CROPS)
      .filter((c) => fits(c.id))
      .sort((a, b) => b.cost - a.cost);
    return owned[0]?.id ?? null;
  }

  // ---- actions ----
  // Plow new wildland: append a fresh plantable field. The farm grows without limit.
  plow(): ActionResult {
    if (this.state.coins < PLOW_COST) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= PLOW_COST;
    const nextId = this.state.plots.reduce((m, p) => Math.max(m, p.id), -1) + 1;
    this.state.plots.push(newPlot(nextId));
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Buy one seed into the inventory. Coins are spent here (at purchase), not at
  // planting time.
  buySeed(cropId: string): ActionResult {
    const crop = CROPS[cropId];
    if (!crop) return { ok: false, error: 'invalid' };
    if (this.state.level < crop.unlockLevel) return { ok: false, error: 'locked' };
    if (this.state.coins < crop.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= crop.cost;
    this.state.inventory[cropId] = (this.state.inventory[cropId] ?? 0) + 1;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Plant an owned seed on an empty (plowed) field. Consumes one seed from the
  // inventory; the coin cost was already paid when the seed was bought. Owned
  // seeds stay plantable even if the crop is above the player's level.
  plant(plotId: number, cropId: string): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    const crop = CROPS[cropId];
    if (!plot || !crop) return { ok: false, error: 'invalid' };
    if (plot.state !== 'empty') return { ok: false, error: 'occupied' };
    if ((this.state.inventory[cropId] ?? 0) < 1) return { ok: false, error: 'no-seed' };
    if (plot.tier < crop.minFieldTier) return { ok: false, error: 'tier-too-low' };
    this.plantPlot(plot, cropId);
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  private plantPlot(plot: Plot, cropId: string): void {
    this.state.inventory[cropId] -= 1;
    plot.cropId = cropId;
    plot.lastCropId = cropId;
    plot.state = 'growing';
    plot.growthProgress = 0;
    plot.sunnyIdleSeconds = 0;
    plot.watered = false;
    plot.fertilized = false;
  }

  harvest(plotId: number): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || plot.state !== 'mature') return { ok: false, error: 'not-mature' };
    this.harvestPlot(plot);
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Award the crop's XP (boosted by fertilizer) and free the field.
  private harvestPlot(plot: Plot): void {
    const crop = plot.cropId ? CROPS[plot.cropId] : null;
    if (crop) {
      const mult = plot.fertilized ? (SUPPLIES.fertilizer?.xpMultiplier ?? 1) : 1;
      this.addXp(Math.round(crop.xpReward * mult));
    }
    this.resetPlot(plot);
  }

  // ---- supplies, field upgrades, tools, electricity ----
  buyItem(itemId: string): ActionResult {
    const item = SUPPLIES[itemId];
    if (!item) return { ok: false, error: 'invalid' };
    if (this.state.level < item.unlockLevel) return { ok: false, error: 'locked' };
    if (this.state.coins < item.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= item.cost;
    this.state.items[itemId] = (this.state.items[itemId] ?? 0) + 1;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Use one owned supply on a field. Water and fertilizer boost the crop currently
  // planted (growing or wilting), once each per crop; medicine cures a wilted crop.
  applyItem(plotId: number, itemId: string): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || !SUPPLIES[itemId]) return { ok: false, error: 'invalid' };
    if ((this.state.items[itemId] ?? 0) < 1) return { ok: false, error: 'no-item' };
    const planted = plot.state === 'growing' || plot.state === 'wilted';
    if (itemId === 'water') {
      if (!planted) return { ok: false, error: 'not-applicable' };
      if (plot.watered) return { ok: false, error: 'already-applied' };
      plot.watered = true;
    } else if (itemId === 'fertilizer') {
      if (!planted) return { ok: false, error: 'not-applicable' };
      if (plot.fertilized) return { ok: false, error: 'already-applied' };
      plot.fertilized = true;
    } else if (itemId === 'medicine') {
      if (plot.state !== 'wilted') return { ok: false, error: 'not-applicable' };
      plot.state = 'growing';
      plot.sunnyIdleSeconds = 0;
    } else {
      return { ok: false, error: 'invalid' };
    }
    this.state.items[itemId] -= 1;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Upgrade a field to the next tier (any time, planted or not). Permanent.
  upgradeField(plotId: number): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot) return { ok: false, error: 'invalid' };
    const next = fieldTier(plot.tier + 1);
    if (!next) return { ok: false, error: 'max-tier' };
    if (this.state.level < next.unlockLevel) return { ok: false, error: 'locked' };
    if (this.state.coins < next.upgradeCost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= next.upgradeCost;
    plot.tier = next.tier;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Buy a tool once; it installs switched on.
  buyTool(toolId: string): ActionResult {
    const tool = TOOLS[toolId];
    if (!tool) return { ok: false, error: 'invalid' };
    if (this.state.tools[toolId]) return { ok: false, error: 'owned' };
    if (this.state.level < tool.unlockLevel) return { ok: false, error: 'locked' };
    if (this.state.coins < tool.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= tool.cost;
    this.state.tools[toolId] = { on: true };
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  toggleTool(toolId: string): ActionResult {
    const owned = this.state.tools[toolId];
    if (!owned) return { ok: false, error: 'not-owned' };
    owned.on = !owned.on;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Buy one pack of electricity for the tools.
  buyPower(): ActionResult {
    if (this.state.level < POWER_PACK.unlockLevel) return { ok: false, error: 'locked' };
    if (this.state.coins < POWER_PACK.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= POWER_PACK.cost;
    this.state.power += POWER_PACK.packSize;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Remove a struggling crop (wilting or dead) and return the plot to an empty field.
  clear(plotId: number): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || (plot.state !== 'dead' && plot.state !== 'wilted')) {
      return { ok: false, error: 'not-removable' };
    }
    this.resetPlot(plot);
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  onboard(difficulty: unknown, workingHours: unknown): ActionResult {
    const valid: Difficulty[] = ['easy', 'normal', 'difficult'];
    if (typeof difficulty === 'string' && valid.includes(difficulty as Difficulty)) {
      this.state.difficulty = difficulty as Difficulty;
    }
    const wh = workingHours as any;
    if (
      wh &&
      typeof wh.startHour === 'number' &&
      typeof wh.endHour === 'number' &&
      Array.isArray(wh.days)
    ) {
      this.state.workingHours = {
        startHour: wh.startHour,
        endHour: wh.endHour,
        days: wh.days.map(Number),
      };
    }
    this.state.onboarded = true;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  toggleBlocked(): ActionResult {
    this.state.manualBlocked = !this.state.manualBlocked;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // ---- developer mode ----
  // These actions are only reachable when TOKENFARM_DEV=1 (i.e. `npm run dev`);
  // a user-mode build cannot invoke them even with a hand-crafted request.

  // Set the coin balance outright — a dev shortcut for testing the economy
  // without waiting on real agent token activity.
  setCoins(amount: number): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'invalid' };
    this.state.coins = amount;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Full wipe → onboarding. Reset every progress field to a fresh game, but keep
  // ingestOffsets so we don't re-tail whole log histories and refund coins. Keep
  // this list in step with GameState — a missed field survives a restart. The
  // existing state object is mutated in place because the running ingest adapters
  // hold a live reference to state.ingestOffsets.
  restart(): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    const fresh = defaultState();
    this.state.version = fresh.version;
    this.state.onboarded = fresh.onboarded;
    this.state.difficulty = fresh.difficulty;
    this.state.workingHours = fresh.workingHours;
    this.state.coins = fresh.coins;
    this.state.xp = fresh.xp;
    this.state.level = fresh.level;
    this.state.inventory = fresh.inventory;
    this.state.items = fresh.items;
    this.state.power = fresh.power;
    this.state.tools = fresh.tools;
    this.state.plots = fresh.plots;
    this.state.manualBlocked = fresh.manualBlocked;
    this.state.devWeather = fresh.devWeather;
    this.state.lastActivityAt = fresh.lastActivityAt;
    this.state.createdAt = fresh.createdAt;
    // ingestOffsets is intentionally preserved (see above), and so is planLimits:
    // an agent's plan limit is a real-world fact, not game progress.
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Set the XP total directly (raw dev override; does not auto-level).
  setXp(amount: number): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'invalid' };
    this.state.xp = Math.floor(amount);
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Set the level directly.
  setLevel(amount: number): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'invalid' };
    this.state.level = amount;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Set a planted plot's growth progress (0..1); ≥1 makes it mature/harvestable.
  setGrowth(plotId: number, progress: number): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot) return { ok: false, error: 'invalid' };
    if (!plot.cropId) return { ok: false, error: 'no-crop' };
    if (!Number.isFinite(progress)) return { ok: false, error: 'invalid' };
    const p = Math.max(0, Math.min(1, progress));
    plot.growthProgress = p;
    plot.state = p >= 1 ? 'mature' : 'growing';
    plot.sunnyIdleSeconds = 0;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Force a plot's state. `empty` clears it; the growing/mature/wilted/dead states
  // require a planted crop.
  setPlotState(plotId: number, next: string): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot) return { ok: false, error: 'invalid' };
    const valid = ['empty', 'growing', 'mature', 'wilted', 'dead'];
    if (!valid.includes(next)) return { ok: false, error: 'invalid' };
    if (next === 'empty') {
      this.resetPlot(plot);
    } else {
      if (!plot.cropId) return { ok: false, error: 'no-crop' };
      plot.state = next as GameState['plots'][number]['state'];
      if (next === 'mature') plot.growthProgress = 1;
      plot.sunnyIdleSeconds = 0;
    }
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Override the weather, or pass 'auto' to clear the override.
  setWeather(w: string): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    if (w !== 'sunny' && w !== 'rainy' && w !== 'auto') return { ok: false, error: 'invalid' };
    this.state.devWeather = w === 'auto' ? null : w;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Fake a token-usage burst and run it through the real ingestion path, so a dev
  // can watch coins accrue and tune the conversion divisor. Countable tokens mirror
  // the Claude adapter: input + cache-creation + output (cache reads are excluded).
  injectTokens(counts: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  }): ActionResult {
    if (!isDevMode()) return { ok: false, error: 'dev-only' };
    const fields = [
      counts.input_tokens ?? 0,
      counts.cache_creation_input_tokens ?? 0,
      counts.output_tokens ?? 0,
    ].map(Number);
    if (!fields.every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, error: 'invalid' };
    const tokens = fields.reduce((a, b) => a + b, 0);
    if (tokens <= 0) return { ok: false, error: 'no-tokens' };
    this.ingest({ agent: 'claude', tokens, at: Date.now() });
    return { ok: true };
  }

  // Free a field. Its tier and the last crop grown there (for the planter) stay.
  private resetPlot(plot: Plot): void {
    plot.cropId = null;
    plot.state = 'empty';
    plot.growthProgress = 0;
    plot.sunnyIdleSeconds = 0;
    plot.watered = false;
    plot.fertilized = false;
  }

  private addXp(amount: number): void {
    this.state.xp += amount;
    while (this.state.xp >= xpForLevel(this.state.level)) {
      this.state.xp -= xpForLevel(this.state.level);
      this.state.level += 1;
    }
  }
}
