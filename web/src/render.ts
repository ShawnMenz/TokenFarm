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
  const wheat = snap.crops?.wheat;
  const weatherIcon = snap.weather === 'sunny' ? '☀️' : '🌧️';
  const weatherText =
    snap.weather === 'sunny'
      ? snap.active
        ? 'Sunny · agent active — crops growing'
        : 'Sunny · idle — crops at risk'
      : snap.manualBlocked
        ? 'Rainy · blocked — farm protected'
        : 'Rainy · rest time — farm protected';

  const xpNeed = snap.level * 100;
  const xpPct = Math.min(100, Math.floor((snap.xp / xpNeed) * 100));

  const plots = (snap.plots as any[])
    .map((plot) => {
      const v = plotVisual(plot, snap.crops);
      let btn = '';
      if (plot.state === 'empty') {
        const afford = snap.coins >= (wheat?.cost ?? Infinity);
        btn = `<button class="act" data-action="plant" data-plot="${plot.id}" data-crop="wheat" ${
          afford ? '' : 'disabled'
        }>Plant 🌾 (${wheat?.cost})</button>`;
      } else if (plot.state === 'mature') {
        btn = `<button class="act harvest" data-action="harvest" data-plot="${plot.id}">Harvest (+${
          wheat?.xpReward ?? 0
        } XP)</button>`;
      } else if (plot.state === 'wilted' || plot.state === 'dead') {
        // Wilting crops can still recover, so removing is confirmed on the client.
        btn = `<button class="act clear" data-action="clear" data-plot="${plot.id}" data-state="${plot.state}">Remove</button>`;
      } else {
        btn = `<span class="plot-status">${v.label}</span>`;
      }
      return `
        <div class="plot plot-${plot.state}">
          <div class="plot-emoji">${v.emoji}</div>
          ${btn}
        </div>`;
    })
    .join('');

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
        <div class="coins">🪙 <b>${snap.coins}</b></div>
        <div class="weather">${weatherIcon} ${weatherText}</div>
        <button class="blocked-toggle ${snap.manualBlocked ? 'on' : ''}" data-action="toggleBlocked">
          ${snap.manualBlocked ? '🌧️ Blocked: ON' : "I'm blocked"}
        </button>
      </header>

      <div class="level">
        <span>Lv ${snap.level}</span>
        <div class="xpbar"><div class="xpfill" style="width:${xpPct}%"></div></div>
        <span class="xptext">${snap.xp}/${xpNeed} XP</span>
      </div>

      <section class="field">${plots}${addTile}</section>

      <footer class="foot">
        Difficulty: <b>${snap.difficulty}</b> ·
        Hours: ${snap.workingHours.startHour}:00–${snap.workingHours.endHour}:00
        ${(snap.workingHours.days as number[]).map((d) => DAY_LABELS[d]).join(' ')}
      </footer>
    </div>`;
}

export function renderOnboarding(snap: Snapshot): string {
  const days = snap.workingHours.days as number[];
  const dayBoxes = DAY_LABELS.map(
    (label, i) =>
      `<label class="day"><input type="checkbox" name="day" value="${i}" ${
        days.includes(i) ? 'checked' : ''
      }/>${label}</label>`,
  ).join('');

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h1>🌱 Welcome to TokenFarm</h1>
        <p>Your coding-agent tokens are your currency. Set up your farm.</p>

        <label class="row">Difficulty
          <select id="difficulty">
            <option value="easy">Easy (×1.5 coins)</option>
            <option value="normal" selected>Normal (×1.0)</option>
            <option value="difficult">Difficult (×0.5)</option>
          </select>
        </label>

        <div class="row">Working hours
          <span>
            <input id="startHour" type="number" min="0" max="23" value="${snap.workingHours.startHour}" /> :00
            &nbsp;to&nbsp;
            <input id="endHour" type="number" min="1" max="24" value="${snap.workingHours.endHour}" /> :00
          </span>
        </div>

        <div class="row">Working days<div class="days">${dayBoxes}</div></div>

        <button id="start">Start farming ☀️</button>
      </div>
    </div>`;
}
