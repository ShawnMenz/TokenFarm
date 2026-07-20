import {
  defaultState,
  load,
  saveDebounced,
  saveNow,
  type Difficulty,
  type GameState,
} from './state.js';
import { weatherNow, type Weather } from './weather.js';
import {
  ACTIVE_WINDOW_MS,
  CONVERSION_DIVISOR,
  CROPS,
  DIE_SECONDS,
  DIFFICULTY_MULT,
  isDevMode,
  PLOW_COST,
  TICK_MS,
  WILT_SECONDS,
  xpForLevel,
} from './config.js';
import type { TokenEvent } from '../ingest/types.js';

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
      devMode: isDevMode(),
      now,
    };
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
    saveDebounced(this.state);
    this.emit();
  }

  // ---- simulation ----
  private tick(): void {
    const now = Date.now();
    const weather = weatherNow(this.state, now);
    const active = now - this.state.lastActivityAt < ACTIVE_WINDOW_MS;
    const dt = TICK_MS / 1000;

    for (const plot of this.state.plots) {
      if (plot.state !== 'growing' && plot.state !== 'wilted') continue;
      const crop = plot.cropId ? CROPS[plot.cropId] : null;
      if (!crop) continue;

      if (weather === 'sunny' && active) {
        // Sun is out and the agent is working: grow, and revive any wilt.
        if (plot.state === 'wilted') plot.state = 'growing';
        plot.sunnyIdleSeconds = 0;
        plot.growthProgress += dt / crop.growSeconds;
        if (plot.growthProgress >= 1) {
          plot.growthProgress = 1;
          plot.state = 'mature';
        }
      } else if (weather === 'sunny' && !active) {
        // Working hours but idle: the decay clock ticks.
        plot.sunnyIdleSeconds += dt;
        if (plot.sunnyIdleSeconds >= DIE_SECONDS) plot.state = 'dead';
        else if (plot.sunnyIdleSeconds >= WILT_SECONDS) plot.state = 'wilted';
      }
      // rainy → protected: no growth, no idle accrual.
    }

    saveDebounced(this.state);
    this.emit();
  }

  // ---- actions ----
  // Plow new wildland: append a fresh plantable field. The farm grows without limit.
  plow(): ActionResult {
    if (this.state.coins < PLOW_COST) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= PLOW_COST;
    const nextId = this.state.plots.reduce((m, p) => Math.max(m, p.id), -1) + 1;
    this.state.plots.push({
      id: nextId,
      cropId: null,
      growthProgress: 0,
      state: 'empty',
      sunnyIdleSeconds: 0,
    });
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Buy one seed into the inventory. Coins are spent here (at purchase), not at
  // planting time.
  buySeed(cropId: string): ActionResult {
    const crop = CROPS[cropId];
    if (!crop) return { ok: false, error: 'invalid' };
    if (this.state.coins < crop.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= crop.cost;
    this.state.inventory[cropId] = (this.state.inventory[cropId] ?? 0) + 1;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  // Plant an owned seed on an empty (plowed) field. Consumes one seed from the
  // inventory; the coin cost was already paid when the seed was bought.
  plant(plotId: number, cropId: string): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    const crop = CROPS[cropId];
    if (!plot || !crop) return { ok: false, error: 'invalid' };
    if (plot.state !== 'empty') return { ok: false, error: 'occupied' };
    if ((this.state.inventory[cropId] ?? 0) < 1) return { ok: false, error: 'no-seed' };
    this.state.inventory[cropId] -= 1;
    plot.cropId = cropId;
    plot.state = 'growing';
    plot.growthProgress = 0;
    plot.sunnyIdleSeconds = 0;
    saveNow(this.state);
    this.emit();
    return { ok: true };
  }

  harvest(plotId: number): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || plot.state !== 'mature') return { ok: false, error: 'not-mature' };
    const crop = plot.cropId ? CROPS[plot.cropId] : null;
    if (crop) this.addXp(crop.xpReward);
    this.resetPlot(plot);
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
  // ingestOffsets so we don't re-tail whole log histories and refund coins. The
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
    this.state.plots = fresh.plots;
    this.state.manualBlocked = fresh.manualBlocked;
    this.state.devWeather = fresh.devWeather;
    this.state.lastActivityAt = fresh.lastActivityAt;
    this.state.createdAt = fresh.createdAt;
    // ingestOffsets is intentionally preserved (see above).
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

  private resetPlot(plot: GameState['plots'][number]): void {
    plot.cropId = null;
    plot.state = 'empty';
    plot.growthProgress = 0;
    plot.sunnyIdleSeconds = 0;
  }

  private addXp(amount: number): void {
    this.state.xp += amount;
    while (this.state.xp >= xpForLevel(this.state.level)) {
      this.state.xp -= xpForLevel(this.state.level);
      this.state.level += 1;
    }
  }
}
