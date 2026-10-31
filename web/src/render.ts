import type { Snapshot } from './api.js';
import { t, cropName, itemName, plotStateName, formatUntil, difficultyName, difficultyLabel, dayLabel } from './i18n.js';

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
  const items = (snap.items ?? {}) as Record<string, number>;
  const supplies = (snap.supplies ?? {}) as Record<string, any>;
  const toolCatalog = (snap.toolCatalog ?? {}) as Record<string, any>;
  const ownedTools = (snap.tools ?? {}) as Record<string, { on: boolean }>;
  const fieldTiers = (snap.fieldTiers ?? []) as any[];
  const level = snap.level as number;
  const weatherIcon = snap.weather === 'sunny' ? '☀️' : '🌧️';
  const limits = (snap.activeLimits ?? []) as { agent: string; until: number }[];

  // While an agent is at its plan limit, sunny idleness is protected — say so
  // instead of "crops at risk".
  let weatherText: string;
  if (snap.weather === 'sunny') {
    if (snap.active) weatherText = t('weatherSunnyActive');
    else if (limits.length) {
      const until = Math.max(...limits.map((l) => l.until));
      weatherText = t('weatherSunnyLimited', limits.map((l) => agentName(l.agent)).join(' & '), formatUntil(until, snap.now));
    } else weatherText = t('weatherSunnyIdle');
  } else {
    weatherText = snap.manualBlocked ? t('weatherRainyBlocked') : t('weatherRainyRest');
  }

  const xpNeed = snap.xpNeed ?? snap.level * 100;
  const xpPct = Math.min(100, Math.floor((snap.xp / xpNeed) * 100));

  const dev = snap.devMode;

  // In developer mode the coin balance is directly editable (see main.ts).
  const coinsHud = dev
    ? `<div class="coins">🪙 <input class="coins-input dev-input" data-dev-field="coins" type="number" min="0" step="1" value="${snap.coins}" aria-label="${t('ariaSetCoins')}"></div>`
    : `<div class="coins">🪙 <b>${snap.coins}</b></div>`;
  // Electricity appears once the player owns a tool or has any power.
  const showPower = Object.keys(ownedTools).length > 0 || (snap.power ?? 0) > 0;
  const powerHud = showPower ? `<div class="power" title="${t('powerTitle')}">⚡ <b>${snap.power ?? 0}</b></div>` : '';

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

  // What the next level-up brings (server computes it from prices.json).
  const next = snap.nextUnlocks as { level: number; items: { kind: string; id: string; name: string; emoji: string }[] } | null;
  const unlocks = next
    ? `<div class="unlocks">${t(
        'unlocksNext',
        next.level,
        next.items.map((u) => `${u.emoji} ${itemName(u.kind === 'tier' ? `tier${u.id}` : u.id, u.name)}`).join(' · '),
      )}</div>`
    : `<div class="unlocks">${t('unlocksAll')}</div>`;

  const tierName = (tier: number) => {
    const ft = fieldTiers.find((f) => f.tier === tier);
    return itemName(`tier${tier}`, ft?.name ?? `Tier ${tier}`);
  };
  // One-tap "use a supply" button on a field.
  const applyBtn = (plotId: number, itemId: string, label?: string) => {
    const s = supplies[itemId];
    if (!s || (items[itemId] ?? 0) < 1) return '';
    const name = itemName(itemId, s.name);
    return `<button class="act apply apply-${itemId}" data-action="applyItem" data-plot="${plotId}" data-item="${itemId}" title="${t('applyTitle', name, items[itemId])}">${label ?? s.emoji}<span class="seed-count">${items[itemId]}</span></button>`;
  };

  const plots = (snap.plots as any[])
    .map((plot) => {
      const v = plotVisual(plot, snap.crops);
      const tier = plot.tier ?? 1;
      let btn = '';
      if (plot.state === 'empty') {
        // Plant an owned seed that this field's tier can hold. One small button per
        // crop in stock; if there's nothing to plant, point them at the shop below.
        const owned = cropList.filter((c) => (inventory[c.id] ?? 0) > 0 && (c.minFieldTier ?? 1) <= tier);
        btn = owned.length
          ? `<div class="plant-picker">${owned
              .map(
                (c) =>
                  `<button class="act plant" data-action="plant" data-plot="${plot.id}" data-crop="${c.id}" title="${t('plantTitle', cropName(c.id, c.name), inventory[c.id])}">${c.emoji}<span class="seed-count">${inventory[c.id]}</span></button>`,
              )
              .join('')}</div>`
          : `<span class="plot-status">${t('buySeeds')}</span>`;
        // Field upgrade, shown once the next tier is unlocked.
        const nextTier = fieldTiers.find((f) => f.tier === tier + 1);
        if (nextTier && level >= nextTier.unlockLevel) {
          btn += `<button class="act upgrade" data-action="upgradeField" data-plot="${plot.id}" ${snap.coins >= nextTier.upgradeCost ? '' : 'disabled'}>${t('upgradeField', tierName(nextTier.tier), nextTier.upgradeCost)}</button>`;
        }
      } else if (plot.state === 'mature') {
        const rc = snap.crops?.[plot.cropId];
        const xp = Math.round((rc?.xpReward ?? 0) * (plot.fertilized ? (supplies.fertilizer?.xpMultiplier ?? 1) : 1));
        btn = `<button class="act harvest" data-action="harvest" data-plot="${plot.id}">${t('harvest', xp)}</button>`;
      } else if (plot.state === 'wilted' || plot.state === 'dead') {
        // Wilting crops can be cured with medicine or recover on their own, so
        // removing is confirmed on the client.
        const cure = plot.state === 'wilted' ? applyBtn(plot.id, 'medicine', t('cure')) : '';
        btn = `${cure}<button class="act clear" data-action="clear" data-plot="${plot.id}" data-state="${plot.state}">${t('remove')}</button>`;
      } else {
        // Growing: progress, plus one-tap water/fertilizer while not yet applied.
        const boosts = [
          plot.watered ? '' : applyBtn(plot.id, 'water'),
          plot.fertilized ? '' : applyBtn(plot.id, 'fertilizer'),
        ].join('');
        btn = `<span class="plot-status">${v.label}</span>${boosts ? `<div class="plant-picker">${boosts}</div>` : ''}`;
      }
      // Small badges for boosts already applied to the current crop.
      const badges =
        (plot.watered ? `<span class="boost-badge" title="${t('badgeWatered')}">💧</span>` : '') +
        (plot.fertilized ? `<span class="boost-badge" title="${t('badgeFertilized')}">🧪</span>` : '');
      const tierLabel = tier > 1 ? `<span class="plot-tier">${tierName(tier)}</span>` : '';
      // Dev-only per-plot controls: growth slider + force-state select (planted plots).
      const devPlot =
        dev && plot.cropId
          ? `<div class="plot-dev">
               <input class="dev-input growth-input" type="range" min="0" max="100" value="${Math.round((plot.growthProgress ?? 0) * 100)}" data-dev-field="growth" data-plot="${plot.id}" aria-label="${t('ariaSetGrowth')}">
               <select class="dev-input state-select" data-dev-field="plotState" data-plot="${plot.id}" aria-label="${t('ariaSetPlotState')}">
                 ${['growing', 'mature', 'wilted', 'dead', 'empty']
                   .map((s) => `<option value="${s}" ${plot.state === s ? 'selected' : ''}>${plotStateName(s)}</option>`)
                   .join('')}
               </select>
             </div>`
          : '';
      return `
        <div class="plot plot-${plot.state} tier-${tier}">
          ${tierLabel || badges ? `<div class="plot-tags">${tierLabel}${badges}</div>` : ''}
          <div class="plot-emoji">${v.emoji}</div>
          ${btn}
          ${devPlot}
        </div>`;
    })
    .join('');

  // A shop card: emoji, name (+ owned count), price, then a Buy button — or a lock
  // until the player reaches `unlockLevel`. The tooltip shows on Buy hover.
  const card = (o: {
    emoji: string;
    name: string;
    owned?: number;
    price: number;
    unlockLevel: number;
    action: string;
    data: string;
    tip: string;
    label?: string;
    extra?: string;
  }) => {
    const locked = level < o.unlockLevel;
    const button = locked
      ? `<button class="shop-buy" disabled>${t('lockedAt', o.unlockLevel)}</button>`
      : `<button class="shop-buy" data-action="${o.action}" ${o.data} ${snap.coins >= o.price ? '' : 'disabled'}>${o.label ?? t('shopBuy')}</button>`;
    return `
        <div class="shop-card ${locked ? 'locked' : ''}">
          <div class="shop-emoji">${o.emoji}</div>
          <div class="shop-name">${o.name}${o.owned ? ` <span class="seed-count">${o.owned}</span>` : ''}</div>
          <div class="shop-price">🪙 ${o.price}</div>
          ${o.extra ?? button}
          <div class="shop-tip" role="tooltip">${o.tip}</div>
        </div>`;
  };

  // Seed shop — always visible so the per-tick repaint keeps coins and stock live.
  const shopCards = cropList
    .map((c) => {
      const growMin = Math.max(1, Math.round(c.growSeconds / 60));
      const needs = (c.minFieldTier ?? 1) > 1 ? ` · ${t('needsTier', tierName(c.minFieldTier))}` : '';
      return card({
        emoji: c.emoji,
        name: cropName(c.id, c.name),
        owned: inventory[c.id] ?? 0,
        price: c.cost,
        unlockLevel: c.unlockLevel ?? 1,
        action: 'buySeed',
        data: `data-crop="${c.id}"`,
        tip: t('shopTip', c.xpReward, growMin) + needs,
      });
    })
    .join('');
  const shop = `
    <section class="shop">
      <div class="shop-title">${t('seedShop')}</div>
      <div class="shop-grid">${shopCards}</div>
    </section>`;

  const supplyTip = (id: string, s: any) =>
    id === 'water' ? t('tipWater', s.growthMultiplier) : id === 'fertilizer' ? t('tipFertilizer', s.xpMultiplier) : t('tipMedicine');
  const supplyCards = Object.values(supplies)
    .sort((a: any, b: any) => a.unlockLevel - b.unlockLevel || a.cost - b.cost)
    .map((s: any) =>
      card({
        emoji: s.emoji,
        name: itemName(s.id, s.name),
        owned: items[s.id] ?? 0,
        price: s.cost,
        unlockLevel: s.unlockLevel,
        action: 'buyItem',
        data: `data-item="${s.id}"`,
        tip: supplyTip(s.id, s),
      }),
    )
    .join('');
  const suppliesShop = `
    <section class="shop shop-supplies">
      <div class="shop-title">${t('suppliesTitle')}</div>
      <div class="shop-grid">${supplyCards}</div>
    </section>`;

  const toolTip = (id: string, tool: any) =>
    id === 'sprinkler'
      ? t('tipSprinkler', tool.powerPerUse)
      : id === 'harvester'
        ? t('tipHarvester', tool.powerPerUse)
        : t('tipPlanter', tool.powerPerUse);
  const pack = snap.powerPack ?? { cost: 0, packSize: 0, unlockLevel: 1 };
  const powerCard = card({
    emoji: '⚡',
    name: itemName('power', t('powerTitle')),
    price: pack.cost,
    unlockLevel: pack.unlockLevel,
    action: 'buyPower',
    data: '',
    label: t('buyPower', pack.packSize),
    tip: t('tipPower'),
  });
  const toolCards = Object.values(toolCatalog)
    .sort((a: any, b: any) => a.unlockLevel - b.unlockLevel || a.cost - b.cost)
    .map((tool: any) => {
      const owned = ownedTools[tool.id];
      const name = itemName(tool.id, tool.name);
      // An installed tool shows an on/off switch instead of a Buy button.
      const toggle = owned
        ? `<button class="shop-buy tool-toggle ${owned.on ? 'on' : 'off'}" data-action="toggleTool" data-tool="${tool.id}" aria-label="${t('ariaToggleTool', name)}">⏻ ${owned.on ? t('toolOn') : t('toolOff')}</button>`
        : undefined;
      return card({
        emoji: tool.emoji,
        name,
        price: tool.cost,
        unlockLevel: tool.unlockLevel,
        action: 'buyTool',
        data: `data-tool="${tool.id}"`,
        tip: toolTip(tool.id, tool),
        extra: toggle,
      });
    })
    .join('');
  const toolsShop = `
    <section class="shop shop-tools">
      <div class="shop-title">${t('toolsTitle')}</div>
      <div class="shop-grid">${powerCard}${toolCards}</div>
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
        <div class="wallet">${coinsHud}${powerHud}</div>
        <div class="weather">${weatherIcon} ${weatherText} ${weatherDevControl}</div>
        <button class="blocked-toggle ${snap.manualBlocked ? 'on' : ''}" data-action="toggleBlocked">
          ${snap.manualBlocked ? t('blockedOn') : t('blockedOff')}
        </button>
      </header>

      ${levelBar}
      ${unlocks}

      <section class="field">${plots}${addTile}</section>

      ${shop}
      ${suppliesShop}
      ${toolsShop}

      <footer class="foot">
        ${t('footDifficulty')} <b>${difficultyName(snap.difficulty)}</b> ·
        ${t('footHours')} ${snap.workingHours.startHour}:00–${snap.workingHours.endHour}:00 ·
        ${formatDays(snap.workingHours.days as number[])}
      </footer>
    </div>`;
}

// Agent ids from the server ('claude', 'codex') → display names (same in both languages).
function agentName(id: string): string {
  return id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : id;
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
