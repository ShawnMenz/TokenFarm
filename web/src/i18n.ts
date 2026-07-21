// Lightweight i18n layer for the browser UI.
//
// There is no framework here — the game repaints #app on every SSE tick and keeps
// a few controls on document.body (main.ts). This module is the single source of
// UI copy in both English and Simplified Chinese, plus the toggle state. Callers
// pull strings through t(); a language switch flips `current`, persists the choice,
// and notifies listeners so main.ts can force an immediate re-render.

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'tokenfarm.lang';

// Catalog values are either a plain string or a builder for interpolated copy.
// `en` is the source of truth for the key set and each entry's shape; `zh` must
// match it exactly (typecheck guards missing keys and mismatched signatures).
const en = {
  // plot states
  plotField: 'Field',
  plotReady: 'Ready!',
  plotWilting: 'Wilting',
  plotDead: 'Dead',

  // weather sentences
  weatherSunnyActive: 'Sunny · agent active — crops growing',
  weatherSunnyIdle: 'Sunny · idle — crops at risk',
  weatherRainyBlocked: 'Rainy · blocked — farm protected',
  weatherRainyRest: 'Rainy · rest time — farm protected',

  // weather override (dev) option labels
  weatherAuto: 'Auto',
  weatherSunny: '☀️ Sunny',
  weatherRainy: '🌧️ Rainy',

  // dev aria-labels
  ariaSetCoins: 'Set coins (dev)',
  ariaOverrideWeather: 'Override weather (dev)',
  ariaSetLevel: 'Set level (dev)',
  ariaSetXp: 'Set XP (dev)',
  ariaSetGrowth: 'Set growth % (dev)',
  ariaSetPlotState: 'Set plot state (dev)',
  ariaPlow: 'Plow a new field',

  // plots / shop / actions
  plantTitle: (name: string, n: number) => `Plant ${name} (${n} in stock)`,
  buySeeds: 'Buy seeds ↓',
  harvest: (xp: number) => `Harvest (+${xp} XP)`,
  remove: 'Remove',
  shopBuy: 'Buy',
  shopTip: (xp: number, min: number) => `+${xp} XP · ${min}m grow`,
  seedShop: '🛒 Seed Shop',
  plow: (cost: number) => `Plow (${cost})`,
  blockedOn: '🌧️ Blocked: ON',
  blockedOff: "I'm blocked",

  // footer
  footDifficulty: 'Difficulty:',
  footHours: 'Hours:',

  // day groups
  everyday: 'Everyday',
  weekdays: 'Weekdays',
  weekend: 'Weekend',

  // difficulty dropdown labels + flavor + assembled blurb
  diffLabelEasy: "C'mon, I'm just here to chill",
  diffLabelNormal: 'Give me an honest day’s work',
  diffLabelDifficult: 'Make me earn every token',
  diffFlavorEasy: 'the most generous rate. Kick back and let the farm flourish.',
  diffFlavorNormal: 'the standard, balanced pace.',
  diffFlavorDifficult: 'currency is scarce — for the true grinders.',
  difficultyBlurb: (name: string, mult: string, flavor: string) =>
    `${name} — you earn coins at a ×${mult} ratio, ${flavor}`,

  // onboarding
  welcomeTitle: '🌱 Welcome to TokenFarm',
  welcomeSub: 'Your coding-agent tokens are your currency. Set up your farm.',
  onbDifficulty: 'Difficulty',
  onbWorkingHours: 'Working hours',
  onbTo: 'to',
  onbWorkingDays: 'Working days',
  onbDayError: 'Pick at least one working day.',
  onbStart: 'Start farming ☀️',

  // dev restart + confirm (main.ts)
  devRestart: '↻ Restart',
  restartConfirm: 'Restart the game? This wipes all progress and returns to setup.',
  restartLabel: 'Restart',
  confirmCancel: 'Cancel',
  clearWilting:
    'This crop is wilting — it could still recover if your agent gets active again. Remove it anyway? The plot returns to an empty field.',
  clearDead: 'Remove this dead crop? The plot returns to an empty field.',

  // dev fake-token box (main.ts)
  devTokenTitle: '🧪 Fake token flow',
  devTokenInject: 'Inject →',
  devTokenPreview: (sum: string, coins: string, divisor: number, mult: number) =>
    `= ${sum} tokens → +${coins} coins (÷${divisor}, ×${mult})`,

  // language toggle button label (shows the language you switch TO)
  langToggle: '中文',

  // tutorial overlay chrome
  tutSkip: 'Skip',
  tutNext: 'Go Next',
  tutDone: 'Done',

  // tutorial steps
  tutCoinsTitle: '🪙 Coins',
  tutCoinsBody:
    'Your currency. Every token your coding agent burns is converted into coins you spend here to plant crops.',
  tutCodexTitle: '🤖 Two agents, one farm',
  tutCodexBody:
    'TokenFarm listens to both <b>Claude Code and Codex</b>. Input, cache-creation, and output tokens from either local agent flow into this same coin balance.',
  tutWeatherTitle: '☀️ Weather',
  tutWeatherBody:
    'Weather tells the story. <b>Sunny + agent active</b> = crops grow. <b>Sunny + idle</b> = crops at risk. <b>Rainy</b> = rest time, farm protected.',
  tutBlockedTitle: "🌧️ I'm blocked",
  tutBlockedBody:
    "Waiting on something outside your control? Flip this on — it forces rainy weather so your crops won't wilt while you're stuck. Fairness, not cheating.",
  tutLevelTitle: '⭐ Level & XP',
  tutLevelBody: 'Harvesting mature crops earns XP. Fill the bar to level up and grow your farm.',
  tutFieldTitle: '🌾 Your plots',
  tutFieldBody:
    'Plant 🌾 when you can afford it, watch it grow through the stages, then Harvest when it reads <b>Ready!</b>',
  tutShopTitle: '🛒 Seed Shop',
  tutShopBody:
    'New in 0.2.0: buy seeds here — <b>Carrot, Wheat, Corn, Pumpkin</b> — then plant an owned seed on a field. Each crop has its own price, grow time, and XP.',
  tutFootTitle: '⚙️ Difficulty & hours',
  tutFootBody:
    'Your difficulty multiplier and working window. Crops grow during your working hours — you set these during onboarding.',
};

type Catalog = typeof en;

const zh: Catalog = {
  plotField: '田地',
  plotReady: '成熟！',
  plotWilting: '有一点死',
  plotDead: '死得透透的',

  weatherSunnyActive: '晴天 · 助手活跃 — 作物生长中',
  weatherSunnyIdle: '晴天 · 闲置 — 庄稼要死啦～',
  weatherRainyBlocked: '雨天 · 已屏蔽 — 躺平',
  weatherRainyRest: '雨天 · 休息时间 — 躺平',

  weatherAuto: '自动',
  weatherSunny: '☀️ 晴天',
  weatherRainy: '🌧️ 雨天',

  ariaSetCoins: '设置金币（开发）',
  ariaOverrideWeather: '覆盖天气（开发）',
  ariaSetLevel: '设置等级（开发）',
  ariaSetXp: '设置经验（开发）',
  ariaSetGrowth: '设置生长百分比（开发）',
  ariaSetPlotState: '设置地块状态（开发）',
  ariaPlow: '开垦新田地',

  plantTitle: (name: string, n: number) => `种植${name}（库存 ${n}）`,
  buySeeds: '购买种子 ↓',
  harvest: (xp: number) => `收获（+${xp} 经验）`,
  remove: '移除',
  shopBuy: '购买',
  shopTip: (xp: number, min: number) => `+${xp} 经验 · ${min} 分钟生长`,
  seedShop: '🛒 种子商店',
  plow: (cost: number) => `开垦（${cost}）`,
  blockedOn: '🌧️ 已屏蔽：开',
  blockedOff: '别卷了，我说停停',

  footDifficulty: '难度：',
  footHours: '工作时间：',

  everyday: '每天',
  weekdays: '正经工作日',
  weekend: '周末',

  diffLabelEasy: '上班够苦了，不要没事找事',
  diffLabelNormal: '该怎样就怎样吧',
  diffLabelDifficult: '996，启动！',
  diffFlavorEasy: '最慷慨的比率。主打的就是一个放松，农场将会空前繁荣。',
  diffFlavorNormal: '标准，主打的就是一个标准，token用一个算一个。',
  diffFlavorDifficult: '货币稀缺，物价飞涨，工资不涨。',
  difficultyBlurb: (name: string, mult: string, flavor: string) =>
    `${name} — 你以 ×${mult} 的比率赚取金币，${flavor}`,

  welcomeTitle: '🌱 欢迎来到 TokenFarm',
  welcomeSub: '你的编程助手 token 就是货币。来搭建你的农场吧。',
  onbDifficulty: '难度',
  onbWorkingHours: '工作时间',
  onbTo: '至',
  onbWorkingDays: '工作日',
  onbDayError: '你一天班都不上？你还是说实话吧。',
  onbStart: '开始耕作 ☀️',

  devRestart: '↻ 重启',
  restartConfirm: '重启游戏？这将清除所有进度并返回初始设置。',
  restartLabel: '重启',
  confirmCancel: '取消',
  clearWilting:
    '这株作物正在枯萎 — 如果助手重新活跃起来它仍可能恢复。仍要移除吗？地块将变回空田。',
  clearDead: '移除这株死掉的作物？地块将变得空田不绝后。',

  devTokenTitle: '🧪 模拟 token 流',
  devTokenInject: '注入 →',
  devTokenPreview: (sum: string, coins: string, divisor: number, mult: number) =>
    `= ${sum} tokens → +${coins} 金币（÷${divisor}，×${mult}）`,

  langToggle: 'EN',

  tutSkip: '跳过',
  tutNext: '下一步',
  tutDone: '完成',

  tutCoinsTitle: '🪙 金币',
  tutCoinsBody: '你的货币。编程助手消耗的每个 token 都会转换成金币，你在这里花金币种作物。',
  tutCodexTitle: '🤖 两个Agents，一座农场',
  tutCodexBody:
    'TokenFarm 同时监听 <b>Claude Code 和 Codex</b>。来自任一本地助手的输入、缓存创建和输出 token 都会汇入同一个金币余额。',
  tutWeatherTitle: '☀️ 天气',
  tutWeatherBody:
    '天气说明一切。<b>晴天 + 助手活跃</b> = 作物生长。<b>晴天 + 闲置</b> = 长久不工作，作物会枯萎然后死掉。<b>雨天</b> = 休息时间，农场受保护，作物不会枯萎。',
  tutBlockedTitle: '🌧️ 没Token了？',
  tutBlockedBody:
    '在等待你无法掌控的事情（比如Token用完了）？打开它 — 它会强制转为雨天，这样你被卡住时作物不会枯萎。我不算你作弊。算了也没用倒是。',
  tutLevelTitle: '⭐ 等级与经验',
  tutLevelBody: '收获成熟作物可获得经验。填满进度条即可升级，壮大你的农场。',
  tutFieldTitle: '🌾 你的地块',
  tutFieldBody:
    '负担得起时就种下 🌾，看着它经历各个生长阶段，等它显示 <b>成熟！</b> 时收获。',
  tutShopTitle: '🛒 种子商店',
  tutShopBody:
    '0.2.0 新增：在这里购买种子 — <b>胡萝卜、小麦、玉米、南瓜</b> — 然后把已拥有的种子种到田里。每种作物都有自己的价格、生长时间和经验。',
  tutFootTitle: '⚙️ 难度与工作时间',
  tutFootBody:
    '你的难度倍率和工作时段。作物在你的工作时间内生长 — 这些在初始设置时配置。',
};

const catalogs: Record<Lang, Catalog> = { en, zh };

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'en';
}

let current: Lang = readStored();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* localStorage unavailable — nothing to persist */
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const cb of listeners) cb();
}

export function onLangChange(cb: () => void): void {
  listeners.add(cb);
}

// Look up a catalog entry for the current language. For interpolated entries the
// extra args are the builder's parameters (typed per key).
export function t<K extends keyof Catalog>(
  key: K,
  ...args: Catalog[K] extends (...a: infer A) => string ? A : []
): string {
  const entry = catalogs[current][key];
  return typeof entry === 'function' ? (entry as (...a: unknown[]) => string)(...args) : (entry as string);
}

// Crop names are server-sourced (English) in the snapshot; translate by id here so
// the server/web boundary stays intact. Falls back to the server name otherwise.
const CROP_NAMES_ZH: Record<string, string> = {
  carrot: '胡萝卜',
  wheat: '小麦',
  corn: '玉米',
  pumpkin: '南瓜',
};
export function cropName(id: string, fallback: string): string {
  return current === 'zh' ? CROP_NAMES_ZH[id] ?? fallback : fallback;
}

// Short difficulty name (Easy/Normal/Hard) used in the footer and blurb.
const DIFF_NAME: Record<Lang, Record<string, string>> = {
  en: { easy: 'Easy', normal: 'Normal', difficult: 'Hard' },
  zh: { easy: '简单', normal: '普通', difficult: '困难' },
};
export function difficultyName(id: string): string {
  return DIFF_NAME[current][id] ?? (id.charAt(0).toUpperCase() + id.slice(1));
}

// Flavorful difficulty label for the onboarding dropdown.
export function difficultyLabel(id: string): string {
  switch (id) {
    case 'easy':
      return t('diffLabelEasy');
    case 'difficult':
      return t('diffLabelDifficult');
    default:
      return t('diffLabelNormal');
  }
}

// Working-day short label by day index (0 = Sunday).
const DAY_LABELS: Record<Lang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};
export function dayLabel(d: number): string {
  return DAY_LABELS[current][d] ?? '';
}
