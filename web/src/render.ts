import type { Snapshot } from './api.js';
import { t, cropName, difficultyName, difficultyLabel, dayLabel } from './i18n.js';

function plotVisual(plot: any, crops: any): { emoji: string; label: string } {
  switch (plot.state) {
    case 'empty':
      return { emoji: '🟫', label: t('plotField') };
    case 'growing': {
      const p = plot.growthProgress;
      const emoji = p < 0.34 ? '🌱' : p < 0.67 ? '🌿' : '🌾';
      return { emoji, label: `${Math.floor(p * 100)}%` };
    }
    case 'mature':
      return { emoji: crops?.[plot.cropId]?.emoji ?? '🌾', label: t('plotReady') };
    case 'wilted':
      return { emoji: '🥀', label: t('plotWilting') };
    case 'dead':
      return { emoji: '💀', label: t('plotDead') };
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
        ? t('weatherSunnyActive')
        : t('weatherSunnyIdle')
      : snap.manualBlocked
        ? t('weatherRainyBlocked')
        : t('weatherRainyRest');

  const xpNeed = snap.xpNeed ?? snap.level * 100;
  const xpPct = Math.min(100, Math.floor((snap.xp / xpNeed) * 100));

  const dev = snap.devMode;

  // In developer mode the coin balance is directly editable (see main.ts).
  const coinsHud = dev
    ? `<div class="coins">🪙 <input class="coins-input dev-input" data-dev-field="coins" type="number" min="0" step="1" value="${snap.coins}" aria-label="${t('ariaSetCoins')}"></div>`
    : `<div class="coins">🪙 <b>${snap.coins}</b></div>`;

  // Dev-only weather override select (Auto / Sunny / Rainy).
  const weatherOverride = snap.devWeather ?? 'auto';
  const weatherDevControl = dev
    ? `<select class="dev-input weather-dev" data-dev-field="weather" aria-label="${t('ariaOverrideWeather')}">
         ${[['auto', t('weatherAuto')], ['sunny', t('weatherSunny')], ['rainy', t('weatherRainy')]]
           .map(([v, l]) => `<option value="${v}" ${weatherOverride === v ? 'selected' : ''}>${l}</option>`)
           .join('')}
       </select>`
    : '';

  // Dev-only editable level + XP.
  const levelBar = dev
    ? `<div class="level">
         <span>Lv <input class="dev-input lv-input" data-dev-field="level" type="number" min="1" step="1" value="${snap.level}" aria-label="${t('ariaSetLevel')}"></span>
         <div class="xpbar"><div class="xpfill" style="width:${xpPct}%"></div></div>
         <span class="xptext"><input class="dev-input xp-input" data-dev-field="xp" type="number" min="0" step="1" value="${snap.xp}" aria-label="${t('ariaSetXp')}">/${xpNeed} XP</span>
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
                  `<button class="act plant" data-action="plant" data-plot="${plot.id}" data-crop="${c.id}" title="${t('plantTitle', cropName(c.id, c.name), inventory[c.id])}">${c.emoji}<span class="seed-count">${inventory[c.id]}</span></button>`,
              )
              .join('')}</div>`
          : `<span class="plot-status">${t('buySeeds')}</span>`;
      } else if (plot.state === 'mature') {
        const rc = snap.crops?.[plot.cropId];
        btn = `<button class="act harvest" data-action="harvest" data-plot="${plot.id}">${t('harvest', rc?.xpReward ?? 0)}</button>`;
      } else if (plot.state === 'wilted' || plot.state === 'dead') {
        // Wilting crops can still recover, so removing is confirmed on the client.
        btn = `<button class="act clear" data-action="clear" data-plot="${plot.id}" data-state="${plot.state}">${t('remove')}</button>`;
      } else {
        btn = `<span class="plot-status">${v.label}</span>`;
      }
      // Dev-only per-plot controls: growth slider + force-state select (planted plots).
      const devPlot =
        dev && plot.cropId
          ? `<div class="plot-dev">
               <input class="dev-input growth-input" type="range" min="0" max="100" value="${Math.round((plot.growthProgress ?? 0) * 100)}" data-dev-field="growth" data-plot="${plot.id}" aria-label="${t('ariaSetGrowth')}">
               <select class="dev-input state-select" data-dev-field="plotState" data-plot="${plot.id}" aria-label="${t('ariaSetPlotState')}">
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
          <div class="shop-name">${cropName(c.id, c.name)}${owned ? ` <span class="seed-count">${owned}</span>` : ''}</div>
          <div class="shop-price">🪙 ${c.cost}</div>
          <button class="shop-buy" data-action="buySeed" data-crop="${c.id}" ${afford ? '' : 'disabled'}>${t('shopBuy')}</button>
          <div class="shop-tip" role="tooltip">${t('shopTip', c.xpReward, growMin)}</div>
        </div>`;
    })
    .join('');
  const shop = `
    <section class="shop">
      <div class="shop-title">${t('seedShop')}</div>
      <div class="shop-grid">${shopCards}</div>
    </section>`;

  // The "+" tile plows a brand-new field. Always present — the farm grows without limit.
  const canPlow = snap.coins >= snap.plowCost;
  const addTile = `
    <button class="plot plot-add" data-action="plow" ${canPlow ? '' : 'disabled'} aria-label="${t('ariaPlow')}">
      <span class="plot-add-plus">+</span>
      <span class="plot-add-cost">${t('plow', snap.plowCost)}</span>
    </button>`;

  return `
    <div class="farm weather-${snap.weather}">
      <header class="hud">
        ${coinsHud}
        <div class="weather">${weatherIcon} ${weatherText} ${weatherDevControl}</div>
        <button class="blocked-toggle ${snap.manualBlocked ? 'on' : ''}" data-action="toggleBlocked">
          ${snap.manualBlocked ? t('blockedOn') : t('blockedOff')}
        </button>
      </header>

      ${levelBar}

      <section class="field">${plots}${addTile}</section>

      ${shop}

      <footer class="foot">
        ${t('footDifficulty')} <b>${difficultyName(snap.difficulty)}</b> ·
        ${t('footHours')} ${snap.workingHours.startHour}:00–${snap.workingHours.endHour}:00 ·
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
  if (has(ALL_DAYS)) return t('everyday');
  const parts: string[] = [];
  parts.push(...(has(WEEKDAYS) ? [t('weekdays')] : WEEKDAYS.filter((d) => days.includes(d)).map((d) => dayLabel(d))));
  parts.push(...(has(WEEKEND) ? [t('weekend')] : WEEKEND.filter((d) => days.includes(d)).map((d) => dayLabel(d))));
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
    }/>${dayLabel(d)}</label>`;
  const groupChip = (id: string, label: string) =>
    `<label class="day day-group"><input type="checkbox" data-group="${id}" checked/>${label}</label>`;

  // Every day selected collapses to a single "Everyday" chip.
  if (has(ALL_DAYS)) return groupChip('everyday', t('everyday'));

  const weekdayPart = has(WEEKDAYS) ? groupChip('weekdays', t('weekdays')) : WEEKDAYS.map(dayChip).join('');
  const weekendPart = has(WEEKEND) ? groupChip('weekend', t('weekend')) : WEEKEND.map(dayChip).join('');
  return weekdayPart + weekendPart;
}

// Plain-language rules for the selected difficulty. The coin ratio is passed in
// from the snapshot so it stays sourced from prices.json.
export function difficultyBlurb(id: string, mult: number): string {
  const flavor =
    id === 'easy' ? t('diffFlavorEasy') : id === 'difficult' ? t('diffFlavorDifficult') : t('diffFlavorNormal');
  return t('difficultyBlurb', difficultyName(id), mult.toFixed(1), flavor);
}

export function renderOnboarding(snap: Snapshot): string {
  const difficultyOptions = ['easy', 'normal', 'difficult']
    .map(
      (id) =>
        `<option value="${id}" ${id === 'normal' ? 'selected' : ''}>${difficultyLabel(id)}</option>`,
    )
    .join('');
  const mults = snap.difficultyMultipliers as Record<string, number>;

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h1>${t('welcomeTitle')}</h1>
        <p>${t('welcomeSub')}</p>

        <label class="row">${t('onbDifficulty')}
          <select id="difficulty">${difficultyOptions}</select>
        </label>
        <div id="difficulty-note" class="difficulty-note">${difficultyBlurb('normal', mults?.normal ?? 1)}</div>

        <div class="row">${t('onbWorkingHours')}
          <span>
            <input id="startHour" type="number" min="0" max="23" value="${snap.workingHours.startHour}" /> :00
            &nbsp;${t('onbTo')}&nbsp;
            <input id="endHour" type="number" min="1" max="24" value="${snap.workingHours.endHour}" /> :00
          </span>
        </div>

        <div class="row">${t('onbWorkingDays')}<div id="day-selector" class="days">${renderDaySelector(WEEKDAYS)}</div></div>
        <div id="day-error" class="day-error" hidden>${t('onbDayError')}</div>

        <button id="start">${t('onbStart')}</button>
      </div>
    </div>`;
}
