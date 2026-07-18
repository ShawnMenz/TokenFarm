import {
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

  plant(plotId: number, cropId: string): ActionResult {
    const plot = this.state.plots.find((p) => p.id === plotId);
    const crop = CROPS[cropId];
    if (!plot || !crop) return { ok: false, error: 'invalid' };
    if (plot.state !== 'empty') return { ok: false, error: 'occupied' };
    if (this.state.coins < crop.cost) return { ok: false, error: 'insufficient-coins' };
    this.state.coins -= crop.cost;
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
