import type { Snapshot } from './api.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function plotVisual(plot: any, crops: any): { emoji: string; label: string } {
  switch (plot.state) {
    case 'empty':
      return { emoji: '🟫', label: 'Field' };
    case 'growing': {
      const p = plot.growthProgress;
      const emoji = p < 0.34 ? '🌱' : p < 0.67 ? '🌿' : '🌾';
      return { emoji, label: `${Math.floor(p * 100)}%` };
    }
    case 'mature':
      return { emoji: crops?.[plot.cropId]?.emoji ?? '🌾', label: 'Ready!' };
    case 'wilted':
      return { emoji: '🥀', label: 'Wilting' };
    case 'dead':
      return { emoji: '💀', label: 'Dead' };
    default:
      return { emoji: '❔', label: '' };
  }
}

export function renderGame(snap: Snapshot): string {
  const cropList = Object.values((snap.crops ?? {}) as Record<string, any>);
  const inventory = (snap.inventory ?? {}) as Record<string, number>;
  const weatherIcon = snap.weather === 'sunny' ? '☀️' : '🌧️';
  const weatherText =
    snap.weather === 'sunny'
      ? snap.active
        ? 'Sunny · agent active — crops growing'
        : 'Sunny · idle — crops at risk'
      : snap.manualBlocked
        ? 'Rainy · blocked — farm protected'
        : 'Rainy · rest time — farm protected';

  const xpNeed = snap.xpNeed ?? snap.level * 100;
  const xpPct = Math.min(100, Math.floor((snap.xp / xpNeed) * 100));

  const dev = snap.devMode;

  // In developer mode the coin balance is directly editable (see main.ts).
  const coinsHud = dev
    ? `<div class="coins">🪙 <input class="coins-input dev-input" data-dev-field="coins" type="number" min="0" step="1" value="${snap.coins}" aria-label="Set coins (dev)"></div>`
    : `<div class="coins">🪙 <b>${snap.coins}</b></div>`;

  // Dev-only weather override select (Auto / Sunny / Rainy).
  const weatherOverride = snap.devWeather ?? 'auto';
  const weatherDevControl = dev
    ? `<select class="dev-input weather-dev" data-dev-field="weather" aria-label="Override weather (dev)">
         ${[['auto', 'Auto'], ['sunny', '☀️ Sunny'], ['rainy', '🌧️ Rainy']]
           .map(([v, l]) => `<option value="${v}" ${weatherOverride === v ? 'selected' : ''}>${l}</option>`)
           .join('')}
       </select>`
    : '';

  // Dev-only editable level + XP.
  const levelBar = dev
    ? `<div class="level">
         <span>Lv <input class="dev-input lv-input" data-dev-field="level" type="number" min="1" step="1" value="${snap.level}" aria-label="Set level (dev)"></span>
         <div class="xpbar"><div class="xpfill" style="width:${xpPct}%"></div></div>
         <span class="xptext"><input class="dev-input xp-input" data-dev-field="xp" type="number" min="0" step="1" value="${snap.xp}" aria-label="Set XP (dev)">/${xpNeed} XP</span>
       </div>`
    : `<div class="level">
         <span>Lv ${snap.level}</span>
         <div class="xpbar"><div class="xpfill" style="width:${xpPct}%"></div></div>
         <span class="xptext">${snap.xp}/${xpNeed} XP</span>
       </div>`;

  const plots = (snap.plots as any[])
    .map((plot) => {
      const v = plotVisual(plot, snap.crops);
      let btn = '';
      if (plot.state === 'empty') {
        // Plant an owned seed. One small button per crop the player has in stock;
        // if the inventory is empty, point them at the shop below.
        const owned = cropList.filter((c) => (inventory[c.id] ?? 0) > 0);
        btn = owned.length
          ? `<div class="plant-picker">${owned
              .map(
                (c) =>
                  `<button class="act plant" data-action="plant" data-plot="${plot.id}" data-crop="${c.id}" title="Plant ${c.name} (${inventory[c.id]} in stock)">${c.emoji}<span class="seed-count">${inventory[c.id]}</span></button>`,
              )
              .join('')}</div>`
          : `<span class="plot-status">Buy seeds ↓</span>`;
      } else if (plot.state === 'mature') {
        const rc = snap.crops?.[plot.cropId];
        btn = `<button class="act harvest" data-action="harvest" data-plot="${plot.id}">Harvest (+${
          rc?.xpReward ?? 0
        } XP)</button>`;
      } else if (plot.state === 'wilted' || plot.state === 'dead') {
        // Wilting crops can still recover, so removing is confirmed on the client.
        btn = `<button class="act clear" data-action="clear" data-plot="${plot.id}" data-state="${plot.state}">Remove</button>`;
      } else {
        btn = `<span class="plot-status">${v.label}</span>`;
      }
      // Dev-only per-plot controls: growth slider + force-state select (planted plots).
      const devPlot =
        dev && plot.cropId
          ? `<div class="plot-dev">
               <input class="dev-input growth-input" type="range" min="0" max="100" value="${Math.round((plot.growthProgress ?? 0) * 100)}" data-dev-field="growth" data-plot="${plot.id}" aria-label="Set growth % (dev)">
               <select class="dev-input state-select" data-dev-field="plotState" data-plot="${plot.id}" aria-label="Set plot state (dev)">
                 ${['growing', 'mature', 'wilted', 'dead', 'empty']
                   .map((s) => `<option value="${s}" ${plot.state === s ? 'selected' : ''}>${s}</option>`)
                   .join('')}
               </select>
             </div>`
          : '';
      return `
        <div class="plot plot-${plot.state}">
          <div class="plot-emoji">${v.emoji}</div>
          ${btn}
          ${devPlot}
        </div>`;
    })
    .join('');

  // Seed shop — always visible so the per-tick repaint keeps coins and stock live.
  const shopCards = cropList
    .map((c) => {
      const owned = inventory[c.id] ?? 0;
      const afford = snap.coins >= c.cost;
      const growMin = Math.max(1, Math.round(c.growSeconds / 60));
      return `
        <div class="shop-card">
          <div class="shop-emoji">${c.emoji}</div>
          <div class="shop-name">${c.name}${owned ? ` <span class="seed-count">${owned}</span>` : ''}</div>
          <div class="shop-price">🪙 ${c.cost}</div>
          <button class="shop-buy" data-action="buySeed" data-crop="${c.id}" ${afford ? '' : 'disabled'}>Buy</button>
          <div class="shop-tip" role="tooltip">+${c.xpReward} XP · ${growMin}m grow</div>
        </div>`;
    })
    .join('');
  const shop = `
    <section class="shop">
      <div class="shop-title">🛒 Seed Shop</div>
      <div class="shop-grid">${shopCards}</div>
    </section>`;

  // The "+" tile plows a brand-new field. Always present — the farm grows without limit.
  const canPlow = snap.coins >= snap.plowCost;
  const addTile = `
    <button class="plot plot-add" data-action="plow" ${canPlow ? '' : 'disabled'} aria-label="Plow a new field">
      <span class="plot-add-plus">+</span>
      <span class="plot-add-cost">Plow (${snap.plowCost})</span>
    </button>`;

  return `
    <div class="farm weather-${snap.weather}">
      <header class="hud">
        ${coinsHud}
        <div class="weather">${weatherIcon} ${weatherText} ${weatherDevControl}</div>
        <button class="blocked-toggle ${snap.manualBlocked ? 'on' : ''}" data-action="toggleBlocked">
          ${snap.manualBlocked ? '🌧️ Blocked: ON' : "I'm blocked"}
        </button>
      </header>

      ${levelBar}

      <section class="field">${plots}${addTile}</section>

      ${shop}

      <footer class="foot">
        Difficulty: <b>${snap.difficulty}</b> ·
        Hours: ${snap.workingHours.startHour}:00–${snap.workingHours.endHour}:00 ·
        ${formatDays(snap.workingHours.days as number[])}
      </footer>
    </div>`;
}

// Day indices, grouped for display: weekday block then weekend block.
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const WEEKEND = [6, 0]; // Sat, Sun
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]; // every day, in display order

// Human-readable summary of the working days, grouped the same way the onboarding
// selector collapses them: "Everyday", "Weekdays"/"Weekend", or individual labels
// (weekday block then weekend block, matching the selector's order).
export function formatDays(days: number[]): string {
  const has = (group: number[]) => group.every((d) => days.includes(d));
  if (has(ALL_DAYS)) return 'Everyday';
  const parts: string[] = [];
  parts.push(...(has(WEEKDAYS) ? ['Weekdays'] : WEEKDAYS.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d])));
  parts.push(...(has(WEEKEND) ? ['Weekend'] : WEEKEND.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d])));
  return parts.join(' ') || '—';
}

// Build the working-days chips from the current selection. A fully-selected group
// (all weekdays, or both weekend days) collapses into a single group chip in place;
// otherwise the individual day chips are shown. Purely presentational — the caller
// tracks the actual selected day indices.
export function renderDaySelector(selected: number[]): string {
  const has = (group: number[]) => group.every((d) => selected.includes(d));
  const dayChip = (d: number) =>
    `<label class="day"><input type="checkbox" data-day="${d}" ${
      selected.includes(d) ? 'checked' : ''
    }/>${DAY_LABELS[d]}</label>`;
  const groupChip = (id: string, label: string) =>
    `<label class="day day-group"><input type="checkbox" data-group="${id}" checked/>${label}</label>`;

  // Every day selected collapses to a single "Everyday" chip.
  if (has(ALL_DAYS)) return groupChip('everyday', 'Everyday');

  const weekdayPart = has(WEEKDAYS) ? groupChip('weekdays', 'Weekdays') : WEEKDAYS.map(dayChip).join('');
  const weekendPart = has(WEEKEND) ? groupChip('weekend', 'Weekend') : WEEKEND.map(dayChip).join('');
  return weekdayPart + weekendPart;
}

// Nifty difficulty labels for the dropdown (no multiplier shown here — see the
// explanation blurb below the select).
export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "C'mon, I'm just here to chill",
  normal: 'Give me an honest day’s work',
  difficult: 'Make me earn every token',
};

// Plain-language rules for the selected difficulty. The coin ratio is passed in
// from the snapshot so it stays sourced from prices.json.
export function difficultyBlurb(id: string, mult: number): string {
  const flavor: Record<string, string> = {
    easy: 'the most generous rate. Kick back and let the farm flourish.',
    normal: 'the standard, balanced pace.',
    difficult: 'currency is scarce — for the true grinders.',
  };
  const name = id === 'difficult' ? 'Hard' : id.charAt(0).toUpperCase() + id.slice(1);
  return `${name} — you earn coins at a ×${mult.toFixed(1)} ratio, ${flavor[id] ?? ''}`;
}

export function renderOnboarding(snap: Snapshot): string {
  const difficultyOptions = ['easy', 'normal', 'difficult']
    .map(
      (id) =>
        `<option value="${id}" ${id === 'normal' ? 'selected' : ''}>${DIFFICULTY_LABEL[id]}</option>`,
    )
    .join('');
  const mults = snap.difficultyMultipliers as Record<string, number>;

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h1>🌱 Welcome to TokenFarm</h1>
        <p>Your coding-agent tokens are your currency. Set up your farm.</p>

        <label class="row">Difficulty
          <select id="difficulty">${difficultyOptions}</select>
        </label>
        <div id="difficulty-note" class="difficulty-note">${difficultyBlurb('normal', mults?.normal ?? 1)}</div>

        <div class="row">Working hours
          <span>
            <input id="startHour" type="number" min="0" max="23" value="${snap.workingHours.startHour}" /> :00
            &nbsp;to&nbsp;
            <input id="endHour" type="number" min="1" max="24" value="${snap.workingHours.endHour}" /> :00
          </span>
        </div>

        <div class="row">Working days<div id="day-selector" class="days">${renderDaySelector(WEEKDAYS)}</div></div>
        <div id="day-error" class="day-error" hidden>Pick at least one working day.</div>

        <button id="start">Start farming ☀️</button>
      </div>
    </div>`;
}
