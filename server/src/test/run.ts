// Lightweight assertion harness (no test framework). Run: npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sumUsage, extractUsage, ClaudeAdapter } from '../ingest/claudeAdapter.js';
import {
  CodexAdapter,
  extractCodexUsage,
  resolveCodexRoot,
  sumCodexUsage,
} from '../ingest/codexAdapter.js';
import { weatherNow } from '../game/weather.js';
import { cancelPendingSave, defaultState, migrate, newPlot, stateDir } from '../game/state.js';
import {
  CROPS,
  FIELD_TIERS,
  LIMIT_FALLBACK_MS,
  nextUnlocks,
  PLOW_COST,
  POWER_PACK,
  SUPPLIES,
  TOOLS,
  xpForLevel,
} from '../game/config.js';
import { detectClaudeLimit, detectCodexLimit, parseRetryIn } from '../ingest/limits.js';
import { Engine } from '../game/engine.js';
import type { LimitEvent, TokenEvent } from '../ingest/types.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('State dir — dev vs user profile separation');
  {
    const savedDir = process.env.TOKENFARM_STATE_DIR;
    const savedDev = process.env.TOKENFARM_DEV;
    const home = os.homedir();
    delete process.env.TOKENFARM_STATE_DIR;
    delete process.env.TOKENFARM_DEV;
    check('user mode → ~/.tokenfarm', stateDir() === path.join(home, '.tokenfarm'), `got ${stateDir()}`);
    process.env.TOKENFARM_DEV = '1';
    check('dev mode → ~/.tokenfarm-dev', stateDir() === path.join(home, '.tokenfarm-dev'), `got ${stateDir()}`);
    process.env.TOKENFARM_STATE_DIR = '/tmp/explicit-override';
    check('explicit TOKENFARM_STATE_DIR wins over dev', stateDir() === '/tmp/explicit-override');
    // restore
    if (savedDir === undefined) delete process.env.TOKENFARM_STATE_DIR;
    else process.env.TOKENFARM_STATE_DIR = savedDir;
    if (savedDev === undefined) delete process.env.TOKENFARM_DEV;
    else process.env.TOKENFARM_DEV = savedDev;
  }

  // From here on, every save resolves into a throwaway directory unless a section
  // points it at its own temp dir — so no test (or late debounced save) can ever
  // touch the real ~/.tokenfarm or ~/.tokenfarm-dev profile.
  if (!process.env.TOKENFARM_STATE_DIR) {
    process.env.TOKENFARM_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-run-'));
  }

  console.log('Ingestion — token summation');
  const usage = {
    input_tokens: 10,
    cache_creation_input_tokens: 90,
    cache_read_input_tokens: 9999, // must be excluded
    output_tokens: 100,
  };
  check('sumUsage excludes cache_read', sumUsage(usage) === 200, `got ${sumUsage(usage)}`);
  check('sumUsage handles missing fields', sumUsage({ output_tokens: 5 }) === 5);
  check('sumUsage handles cache_creation object', sumUsage({ cache_creation_input_tokens: { a: 3, b: 4 }, output_tokens: 1 }) === 8);
  check('extractUsage from message.usage', extractUsage({ message: { usage } }) === usage);

  console.log('Ingestion — Codex token summation');
  const codexUsage = {
    input_tokens: 100,
    cached_input_tokens: 40,
    cache_write_input_tokens: 7,
    output_tokens: 20,
    reasoning_output_tokens: 15,
    total_tokens: 120,
  };
  check(
    'Codex counts full input and cache writes',
    sumCodexUsage(codexUsage) === 127,
    `got ${sumCodexUsage(codexUsage)}`,
  );
  check(
    'Codex does not double-count reasoning output',
    sumCodexUsage({ ...codexUsage, reasoning_output_tokens: 999 }) === 127,
  );
  check(
    'Codex cached input metadata does not reduce currency',
    sumCodexUsage({ input_tokens: 5, cached_input_tokens: 10, output_tokens: 3 }) === 8,
  );
  check('Codex ignores total-only usage', sumCodexUsage({ total_tokens: 500 }) === 0);
  const codexRecord = {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: codexUsage, total_token_usage: { total_tokens: 999 } },
    },
  };
  check('Codex extracts last usage delta', extractCodexUsage(codexRecord) === codexUsage);
  check(
    'Codex ignores unrelated records',
    extractCodexUsage({ type: 'response_item', payload: codexRecord.payload }) === null,
  );
  check(
    'Codex ignores null token info',
    extractCodexUsage({ type: 'event_msg', payload: { type: 'token_count', info: null } }) === null,
  );
  check(
    'Codex root prefers TokenFarm override',
    resolveCodexRoot(
      { TOKENFARM_CODEX_DIR: '/tokenfarm', CODEX_HOME: '/codex-home' },
      '/home',
    ) === '/tokenfarm',
  );
  check(
    'Codex root respects CODEX_HOME',
    resolveCodexRoot({ CODEX_HOME: '/codex-home' }, '/home') ===
      path.join('/codex-home', 'sessions'),
  );
  check(
    'Codex root falls back to ~/.codex/sessions',
    resolveCodexRoot({}, '/home') === path.join('/home', '.codex', 'sessions'),
  );

  console.log('Economy — coin math');
  const K = 100;
  check('normal ×1.0', (200 * 1.0) / K === 2);
  check('easy ×1.5', (200 * 1.5) / K === 3);
  check('difficult ×0.5', (200 * 0.5) / K === 1);

  console.log('Weather — working hours vs rest');
  const st = defaultState(); // 09–17, Mon–Fri
  const monday10 = new Date('2026-07-13T10:00:00').getTime(); // Mon
  const monday20 = new Date('2026-07-13T20:00:00').getTime(); // Mon evening
  const sunday10 = new Date('2026-07-12T10:00:00').getTime(); // Sun
  check('sunny in work hours', weatherNow(st, monday10) === 'sunny');
  check('rainy after hours', weatherNow(st, monday20) === 'rainy');
  check('rainy on weekend', weatherNow(st, sunday10) === 'rainy');
  st.manualBlocked = true;
  check('rainy when blocked', weatherNow(st, monday10) === 'rainy');

  console.log('Ingestion — chokidar tail (integration)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-test-'));
  const sub = path.join(dir, 'proj');
  fs.mkdirSync(sub);
  const logFile = path.join(sub, 'session.jsonl');
  fs.writeFileSync(logFile, ''); // exists at startup → history skipped
  const events: TokenEvent[] = [];
  const adapter = new ClaudeAdapter({ root: dir, offsets: {}, onEvent: (e) => events.push(e) });
  adapter.start();
  await sleep(500); // let the watcher settle
  fs.appendFileSync(
    logFile,
    JSON.stringify({ type: 'assistant', message: { usage } }) + '\n',
  );
  await sleep(800);
  adapter.stop?.();
  check('adapter emitted one event', events.length === 1, `got ${events.length}`);
  check('adapter tokens = 200', events[0]?.tokens === 200, `got ${events[0]?.tokens}`);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('Ingestion — Codex chokidar tail (integration)');
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-codex-test-'));
  const codexSub = path.join(codexDir, '2026', '07', '17');
  fs.mkdirSync(codexSub, { recursive: true });
  const codexLog = path.join(codexSub, 'rollout-test.jsonl');
  const codexLine = JSON.stringify(codexRecord) + '\n';
  fs.writeFileSync(codexLog, codexLine);
  const codexEvents: TokenEvent[] = [];
  const codexAdapter = new CodexAdapter({
    root: codexDir,
    offsets: {},
    onEvent: (e: TokenEvent) => codexEvents.push(e),
  });
  codexAdapter.start();
  await sleep(500);
  check('Codex skips rollout history at startup', codexEvents.length === 0);

  fs.appendFileSync(codexLog, JSON.stringify(codexRecord));
  await sleep(400);
  check('Codex defers an incomplete trailing line', codexEvents.length === 0);
  fs.appendFileSync(codexLog, '\n');
  await sleep(800);
  check('Codex emits completed appended records', codexEvents.length === 1);
  check('Codex event identifies its agent', codexEvents[0]?.agent === 'codex');
  check('Codex adapter emits countable tokens', codexEvents[0]?.tokens === 127);

  fs.appendFileSync(codexLog, '{malformed json\n');
  await sleep(400);
  check('Codex ignores malformed JSONL records', codexEvents.length === 1);

  const newCodexLog = path.join(codexSub, 'rollout-new-session.jsonl');
  fs.writeFileSync(newCodexLog, codexLine);
  await sleep(800);
  check('Codex counts a rollout created after startup', codexEvents.length === 2);

  fs.writeFileSync(codexLog, '\n');
  await sleep(400);
  fs.appendFileSync(codexLog, codexLine);
  await sleep(800);
  check('Codex resumes after log truncation', codexEvents.length === 3);
  codexAdapter.stop?.();

  const resumeLog = path.join(codexSub, 'rollout-resume.jsonl');
  fs.writeFileSync(resumeLog, codexLine + codexLine);
  const resumedEvents: TokenEvent[] = [];
  const resumeAdapter = new CodexAdapter({
    root: codexDir,
    offsets: { [resumeLog]: Buffer.byteLength(codexLine) },
    onEvent: (e: TokenEvent) => resumedEvents.push(e),
  });
  resumeAdapter.start();
  await sleep(600);
  check('Codex resumes from a persisted byte offset', resumedEvents.length === 1);
  resumeAdapter.stop?.();
  fs.rmSync(codexDir, { recursive: true, force: true });

  console.log('Ingestion — concurrent providers (integration)');
  const multiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-multi-test-'));
  const claudeDir = path.join(multiDir, 'claude');
  const localCodexDir = path.join(multiDir, 'codex');
  fs.mkdirSync(claudeDir);
  fs.mkdirSync(localCodexDir);
  const claudeLog = path.join(claudeDir, 'session.jsonl');
  const localCodexLog = path.join(localCodexDir, 'rollout.jsonl');
  fs.writeFileSync(claudeLog, '');
  fs.writeFileSync(localCodexLog, '');
  const combinedEvents: TokenEvent[] = [];
  const sharedOffsets: Record<string, number> = {};
  const concurrentAdapters = [
    new ClaudeAdapter({
      root: claudeDir,
      offsets: sharedOffsets,
      onEvent: (e) => combinedEvents.push(e),
    }),
    new CodexAdapter({
      root: localCodexDir,
      offsets: sharedOffsets,
      onEvent: (e) => combinedEvents.push(e),
    }),
  ];
  for (const item of concurrentAdapters) item.start();
  await sleep(500);
  fs.appendFileSync(claudeLog, JSON.stringify({ message: { usage } }) + '\n');
  fs.appendFileSync(localCodexLog, codexLine);
  await sleep(800);
  for (const item of concurrentAdapters) item.stop?.();
  check('both providers emit into one stream', combinedEvents.length === 2);
  check(
    'combined stream keeps provider identities',
    new Set(combinedEvents.map((event) => event.agent)).size === 2,
  );
  check(
    'combined stream aggregates countable tokens',
    combinedEvents.reduce((total, event) => total + event.tokens, 0) === 327,
  );
  fs.rmSync(multiDir, { recursive: true, force: true });

  console.log('Developer mode — engine actions');
  // Isolate state to a temp dir so the Engine never reads or writes a real save.
  const devDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-dev-test-'));
  const prevStateDir = process.env.TOKENFARM_STATE_DIR;
  const prevDev = process.env.TOKENFARM_DEV;
  process.env.TOKENFARM_STATE_DIR = devDir;
  process.env.TOKENFARM_DEV = '1';

  const engine = new Engine(); // constructor loads from the empty temp dir → defaults
  check('snapshot devMode true under TOKENFARM_DEV=1', engine.snapshot().devMode === true);

  engine.setCoins(4200);
  check('setCoins sets the balance', engine.state.coins === 4200);
  const coinsBefore = engine.state.coins;
  check(
    'setCoins rejects a negative amount',
    engine.setCoins(-5).ok === false && engine.state.coins === coinsBefore,
  );
  check(
    'setCoins rejects a non-finite amount',
    engine.setCoins(Number('nope')).ok === false && engine.state.coins === coinsBefore,
  );

  // Seed progress, then restart and confirm a full wipe that keeps ingest offsets.
  engine.state.xp = 55;
  engine.state.level = 4;
  engine.state.onboarded = true;
  engine.state.plots.push({ ...newPlot(1), cropId: 'wheat', growthProgress: 0.5, state: 'growing', tier: 2 });
  engine.state.items = { water: 3 };
  engine.state.power = 40;
  engine.state.tools = { harvester: { on: true } };
  engine.state.planLimits = { codex: { until: Date.now() + 60_000, detectedAt: Date.now() } };
  const offsetsRef = engine.state.ingestOffsets;
  offsetsRef['/some/session.jsonl'] = 123;

  check('restart succeeds in dev mode', engine.restart().ok === true);
  check('restart resets coins', engine.state.coins === 0);
  check('restart resets xp and level', engine.state.xp === 0 && engine.state.level === 1);
  check('restart returns to onboarding', engine.snapshot().onboarded === false);
  check('restart resets to a single field', engine.state.plots.length === 1);
  check('restart resets the field tier', engine.state.plots[0].tier === 1);
  check(
    'restart resets supplies, power, and tools',
    Object.keys(engine.state.items).length === 0 &&
      engine.state.power === 0 &&
      Object.keys(engine.state.tools).length === 0,
  );
  check('restart preserves plan limits (real-world fact)', !!engine.state.planLimits.codex);
  check(
    'restart preserves ingestOffsets object identity',
    engine.state.ingestOffsets === offsetsRef,
  );
  check(
    'restart preserves ingestOffsets contents',
    engine.state.ingestOffsets['/some/session.jsonl'] === 123,
  );

  // Dev adjusters (flag still on). Plant a crop first for the plot-based setters.
  engine.state.coins = 10000;
  engine.buySeed('carrot');
  const pid = engine.state.plots[0].id;
  engine.plant(pid, 'carrot');

  check('setXp sets xp', engine.setXp(250).ok === true && engine.state.xp === 250);
  check('setXp rejects negative', engine.setXp(-1).error === 'invalid');
  check('setLevel sets level', engine.setLevel(7).ok === true && engine.state.level === 7);
  check('setLevel rejects <1', engine.setLevel(0).error === 'invalid');

  check(
    'setGrowth to 1 matures the plot',
    engine.setGrowth(pid, 1).ok === true &&
      engine.state.plots[0].state === 'mature' &&
      engine.state.plots[0].growthProgress === 1,
  );
  check(
    'setGrowth below 1 keeps it growing',
    engine.setGrowth(pid, 0.4).ok === true &&
      engine.state.plots[0].state === 'growing' &&
      Math.abs(engine.state.plots[0].growthProgress - 0.4) < 1e-9,
  );
  engine.plow(); // append an empty plot
  const emptyPid = engine.state.plots[engine.state.plots.length - 1].id;
  check('setGrowth rejects a plot with no crop', engine.setGrowth(emptyPid, 0.5).error === 'no-crop');

  check(
    'setPlotState forces wilted',
    engine.setPlotState(pid, 'wilted').ok === true && engine.state.plots[0].state === 'wilted',
  );
  check(
    'setPlotState empty clears the plot',
    engine.setPlotState(pid, 'empty').ok === true &&
      engine.state.plots[0].state === 'empty' &&
      engine.state.plots[0].cropId === null,
  );
  check('setPlotState rejects an invalid state', engine.setPlotState(pid, 'nonsense').error === 'invalid');

  check(
    'setWeather sunny sets the override',
    engine.setWeather('sunny').ok === true && engine.state.devWeather === 'sunny',
  );
  const sundayEarly = new Date('2026-07-12T03:00:00').getTime(); // Sun 3am → normally rainy
  check('weatherNow honors devWeather override', weatherNow(engine.state, sundayEarly) === 'sunny');
  check(
    'setWeather auto clears the override',
    engine.setWeather('auto').ok === true && engine.state.devWeather === null,
  );
  check('setWeather rejects an invalid value', engine.setWeather('foggy').error === 'invalid');

  // injectTokens runs a fake burst through the real ingestion math.
  engine.state.coins = 0;
  engine.state.difficulty = 'normal'; // ×1.0
  const divisor = engine.snapshot().conversionDivisor;
  check('snapshot exposes conversionDivisor', typeof divisor === 'number' && divisor > 0);
  const inj = engine.injectTokens({
    input_tokens: 100,
    cache_creation_input_tokens: 50,
    output_tokens: 30,
  });
  check(
    'injectTokens sums the three fields and mints coins',
    inj.ok === true && Math.abs(engine.state.coins - 180 / divisor) < 1e-9,
  );
  check('injectTokens marks the agent active', Date.now() - engine.state.lastActivityAt < 1000);
  check('injectTokens rejects an all-zero burst', engine.injectTokens({ input_tokens: 0 }).error === 'no-tokens');
  check(
    'injectTokens rejects a negative field',
    engine.injectTokens({ input_tokens: -5, output_tokens: 10 }).error === 'invalid',
  );

  // restart clears the weather override, then return to a clean state for the
  // flag-off assertions below (coins back to 0).
  engine.setWeather('rainy');
  engine.restart();
  check('restart clears devWeather', engine.state.devWeather === null);

  // With the flag off both dev actions are refused and leave state untouched.
  delete process.env.TOKENFARM_DEV;
  check('snapshot devMode false when flag is off', engine.snapshot().devMode === false);
  check(
    'setCoins refused in user mode',
    engine.setCoins(999).error === 'dev-only' && engine.state.coins === 0,
  );
  check('restart refused in user mode', engine.restart().error === 'dev-only');
  check(
    'injectTokens refused in user mode',
    engine.injectTokens({ input_tokens: 100 }).error === 'dev-only' && engine.state.coins === 0,
  );

  fs.rmSync(devDir, { recursive: true, force: true });
  if (prevStateDir === undefined) delete process.env.TOKENFARM_STATE_DIR;
  else process.env.TOKENFARM_STATE_DIR = prevStateDir;
  if (prevDev === undefined) delete process.env.TOKENFARM_DEV;
  else process.env.TOKENFARM_DEV = prevDev;

  console.log('Leveling — gradual XP band curve');
  check('band 1 (Lv 1) needs 100', xpForLevel(1) === 100, `got ${xpForLevel(1)}`);
  check('band 1 upper (Lv 10) needs 100', xpForLevel(10) === 100, `got ${xpForLevel(10)}`);
  check('band 2 (Lv 11) needs 300', xpForLevel(11) === 300, `got ${xpForLevel(11)}`);
  check('band 2 upper (Lv 30) needs 300', xpForLevel(30) === 300, `got ${xpForLevel(30)}`);
  check('band 3 (Lv 31) needs 800', xpForLevel(31) === 800, `got ${xpForLevel(31)}`);
  check('band 3 upper (Lv 60) needs 800', xpForLevel(60) === 800, `got ${xpForLevel(60)}`);
  check('band 4 (Lv 61) needs 2000', xpForLevel(61) === 2000, `got ${xpForLevel(61)}`);
  check('band 4 upper (Lv 100) needs 2000', xpForLevel(100) === 2000, `got ${xpForLevel(100)}`);
  check('beyond last band holds at top rate (Lv 101)', xpForLevel(101) === 2000, `got ${xpForLevel(101)}`);
  check('no level cap (Lv 9999) still 2000', xpForLevel(9999) === 2000, `got ${xpForLevel(9999)}`);
  check('curve is non-decreasing', xpForLevel(10) <= xpForLevel(11) && xpForLevel(60) <= xpForLevel(61));

  console.log('Shop — prices, buySeed, and planting');
  check('prices load carrot at 500', CROPS.carrot?.cost === 500, `got ${CROPS.carrot?.cost}`);
  check('prices load corn at 2500', CROPS.corn?.cost === 2500, `got ${CROPS.corn?.cost}`);
  check('prices load pumpkin at 6000', CROPS.pumpkin?.cost === 6000, `got ${CROPS.pumpkin?.cost}`);
  check('wheat price unchanged at 1500', CROPS.wheat?.cost === 1500, `got ${CROPS.wheat?.cost}`);
  check('plow price unchanged at 300', PLOW_COST === 300, `got ${PLOW_COST}`);

  const shopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-shop-test-'));
  const prevShopStateDir = process.env.TOKENFARM_STATE_DIR;
  process.env.TOKENFARM_STATE_DIR = shopDir;
  const shopEngine = new Engine();
  // Set coins directly (buySeed/plant are not dev-gated, but setCoins is).
  shopEngine.state.coins = 1000;

  check(
    'buySeed deducts coins and adds to inventory',
    shopEngine.buySeed('carrot').ok === true &&
      shopEngine.state.coins === 500 &&
      shopEngine.state.inventory.carrot === 1,
  );
  check(
    'buySeed refuses when coins are insufficient',
    shopEngine.buySeed('wheat').error === 'insufficient-coins' &&
      shopEngine.state.coins === 500 &&
      (shopEngine.state.inventory.wheat ?? 0) === 0,
  );
  check('buySeed rejects an unknown crop', shopEngine.buySeed('mango').error === 'invalid');

  const plotId = shopEngine.state.plots[0].id;
  check(
    'plant consumes a seed from inventory (no coin charge)',
    shopEngine.plant(plotId, 'carrot').ok === true &&
      shopEngine.state.inventory.carrot === 0 &&
      shopEngine.state.coins === 500 &&
      shopEngine.state.plots[0].state === 'growing',
  );

  // Plow a second field, then confirm planting with no stock is refused.
  shopEngine.state.coins = 1000;
  shopEngine.plow(); // coins 700, appends an empty field
  const freshPlot = shopEngine.state.plots[shopEngine.state.plots.length - 1].id;
  check(
    'plant refuses with no-seed when stock is 0',
    shopEngine.plant(freshPlot, 'pumpkin').error === 'no-seed',
  );
  check(
    'plant refuses on an occupied plot',
    shopEngine.plant(plotId, 'corn').error === 'occupied',
  );

  // restart clears inventory (dev-gated: enable the flag just for this call).
  shopEngine.state.coins = 5000;
  shopEngine.buySeed('wheat'); // own 1 wheat
  process.env.TOKENFARM_DEV = '1';
  shopEngine.restart();
  check('restart clears inventory', Object.keys(shopEngine.state.inventory).length === 0);
  if (prevDev === undefined) delete process.env.TOKENFARM_DEV;
  else process.env.TOKENFARM_DEV = prevDev;

  fs.rmSync(shopDir, { recursive: true, force: true });
  if (prevShopStateDir === undefined) delete process.env.TOKENFARM_STATE_DIR;
  else process.env.TOKENFARM_STATE_DIR = prevShopStateDir;


  // ---- v0.3.0: unlocks, field tiers, supplies, automation, plan limits ----
  // Each section gets its own temp save dir; pending debounced saves are dropped
  // before the env is restored.
  function isolatedEngine(tag: string): { e: Engine; done: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tokenfarm-${tag}-`));
    const prev = process.env.TOKENFARM_STATE_DIR;
    process.env.TOKENFARM_STATE_DIR = dir;
    const e = new Engine();
    return {
      e,
      done: () => {
        cancelPendingSave();
        if (prev === undefined) delete process.env.TOKENFARM_STATE_DIR;
        else process.env.TOKENFARM_STATE_DIR = prev;
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  // Make the farm sunny and the agent active (or idle) for a tick at `now`.
  function sunny(e: Engine, now: number, active: boolean) {
    e.state.devWeather = 'sunny';
    e.state.lastActivityAt = active ? now : 0;
  }

  console.log('Catalog — v0.3.0 unlocks, supplies, tiers, tools');
  check('apple tree: Lv 8, needs field tier 2', CROPS.apple?.unlockLevel === 8 && CROPS.apple?.minFieldTier === 2);
  check(
    'crop unlock levels: wheat 1, corn 3, pumpkin 5',
    CROPS.wheat.unlockLevel === 1 && CROPS.corn.unlockLevel === 3 && CROPS.pumpkin.unlockLevel === 5,
  );
  check(
    'supplies load (water 150, fertilizer ×1.5 XP, medicine Lv 2)',
    SUPPLIES.water?.cost === 150 && SUPPLIES.fertilizer?.xpMultiplier === 1.5 && SUPPLIES.medicine?.unlockLevel === 2,
  );
  check(
    'three field tiers (fertile 2,000; greenhouse ×1.5)',
    FIELD_TIERS.length === 3 && FIELD_TIERS[1].upgradeCost === 2000 && FIELD_TIERS[2].growthMultiplier === 1.5,
  );
  check('tools and power pack load', TOOLS.harvester?.cost === 8000 && POWER_PACK.packSize === 50);
  const nu1 = nextUnlocks(1);
  check(
    'next unlock at Lv 1 → Lv 2: water + medicine',
    nu1?.level === 2 && nu1.items.map((i) => i.id).sort().join() === 'medicine,water',
    JSON.stringify(nu1),
  );
  check('nothing left to unlock at Lv 99', nextUnlocks(99) === null);

  console.log('Progression — level gates and field tiers');
  {
    const { e, done } = isolatedEngine('progress');
    e.state.coins = 1_000_000;
    check('corn locked at Lv 1', e.buySeed('corn').error === 'locked' && (e.state.inventory.corn ?? 0) === 0);
    check('water locked at Lv 1', e.buyItem('water').error === 'locked');
    check('sprinkler locked at Lv 1', e.buyTool('sprinkler').error === 'locked');
    check('electricity locked at Lv 1', e.buyPower().error === 'locked');
    check('field upgrade locked at Lv 1', e.upgradeField(0).error === 'locked' && e.state.plots[0].tier === 1);
    e.state.inventory.pumpkin = 1;
    check('an owned seed above your level is still plantable', e.plant(0, 'pumpkin').ok === true);
    e.state.plots[0] = { ...e.state.plots[0], cropId: null, state: 'empty', growthProgress: 0 }; // free the field again

    e.state.level = 3;
    check('corn unlocks at Lv 3', e.buySeed('corn').ok === true);
    const before = e.state.coins;
    check(
      'upgrade to Fertile field costs 2,000',
      e.upgradeField(0).ok === true && e.state.plots[0].tier === 2 && e.state.coins === before - 2000,
    );
    check('Greenhouse locked until Lv 6', e.upgradeField(0).error === 'locked');
    e.state.level = 6;
    check('upgrade to Greenhouse at Lv 6', e.upgradeField(0).ok === true && e.state.plots[0].tier === 3);
    check('no tier above Greenhouse', e.upgradeField(0).error === 'max-tier');

    e.state.level = 8;
    check('apple tree buyable at Lv 8', e.buySeed('apple').ok === true && e.state.inventory.apple === 1);
    e.plow();
    const plain = e.state.plots[e.state.plots.length - 1].id;
    check('apple tree refused on a tier-1 field', e.plant(plain, 'apple').error === 'tier-too-low');
    check('apple tree planted on a Greenhouse', e.plant(0, 'apple').ok === true);
    check('new fields start at tier 1', e.state.plots.find((p) => p.id === plain)?.tier === 1);
    done();
  }

  console.log('Supplies — water, fertilizer, medicine');
  {
    const { e, done } = isolatedEngine('supplies');
    e.state.level = 3;
    e.state.coins = 100_000;
    e.state.plots = [newPlot(0), newPlot(1), newPlot(2)];
    e.state.inventory = { carrot: 3 };
    for (const id of [0, 1, 2]) e.plant(id, 'carrot');
    check('buyItem water', e.buyItem('water').ok === true && e.state.items.water === 1 && e.state.coins === 100_000 - 150);
    check('water applies to a growing crop', e.applyItem(1, 'water').ok === true && e.state.plots[1].watered && e.state.items.water === 0);
    check('no water left → no-item', e.applyItem(0, 'water').error === 'no-item');
    e.state.items.water = 1;
    check('water twice on one crop → already-applied', e.applyItem(1, 'water').error === 'already-applied');
    e.state.plots[2].tier = 2;
    const now = Date.now();
    sunny(e, now, true);
    e.tick(now);
    const g = CROPS.carrot.growSeconds;
    check('plain field grows at the base rate', near(e.state.plots[0].growthProgress, 1 / g));
    check('watered crop grows ×1.5', near(e.state.plots[1].growthProgress, 1.5 / g));
    check('Fertile field grows ×1.25', near(e.state.plots[2].growthProgress, 1.25 / g));

    check('buyItem fertilizer', e.buyItem('fertilizer').ok === true);
    check('fertilizer applies', e.applyItem(0, 'fertilizer').ok === true && e.state.plots[0].fertilized);
    e.state.plots[0].growthProgress = 1;
    e.state.plots[0].state = 'mature';
    const xp0 = e.state.xp;
    e.harvest(0);
    check('fertilized carrot gives round(5 × 1.5) = 8 XP', e.state.xp - xp0 === 8, `got ${e.state.xp - xp0}`);
    check(
      'harvest clears boosts but keeps tier and last crop',
      !e.state.plots[0].fertilized && !e.state.plots[0].watered && e.state.plots[0].lastCropId === 'carrot',
    );
    check('water on an empty field → not-applicable', e.applyItem(0, 'water').error === 'not-applicable');

    e.state.items.medicine = 2;
    check('medicine on a healthy crop → not-applicable', e.applyItem(1, 'medicine').error === 'not-applicable');
    e.state.plots[1].state = 'wilted';
    e.state.plots[1].sunnyIdleSeconds = 999_999;
    const cured = e.applyItem(1, 'medicine').ok;
    const curedPlot = e.state.plots[1] as { state: string; sunnyIdleSeconds: number };
    check(
      'medicine cures a wilted crop',
      cured === true && curedPlot.state === 'growing' && curedPlot.sunnyIdleSeconds === 0 && e.state.items.medicine === 1,
    );
    e.state.plots[2].state = 'dead';
    check('medicine cannot revive a dead crop', e.applyItem(2, 'medicine').error === 'not-applicable' && e.state.items.medicine === 1);
    done();
  }

  console.log('Automation — tools and electricity');
  {
    const { e, done } = isolatedEngine('auto');
    e.state.level = 6;
    e.state.coins = 100_000;
    for (const t of ['harvester', 'planter', 'sprinkler']) e.buyTool(t);
    check('tools install switched on', ['harvester', 'planter', 'sprinkler'].every((t) => e.state.tools[t]?.on === true));
    check('a tool can only be bought once', e.buyTool('harvester').error === 'owned');
    check('tools cost 21,000 together', e.state.coins === 100_000 - 21_000);
    e.state.plots[0] = { ...newPlot(0), cropId: 'carrot', lastCropId: 'carrot', state: 'mature', growthProgress: 1 };
    e.state.inventory = { carrot: 1 };
    const now = Date.now();
    e.state.devWeather = 'rainy'; // automation works in any weather
    const coins0 = e.state.coins;
    e.tick(now);
    check('no electricity → tools do nothing', e.state.plots[0].state === 'mature' && e.state.power === 0);
    check('buyPower adds a 50 ⚡ pack', e.buyPower().ok === true && e.state.power === 50);
    const coins1 = e.state.coins;
    const xp0 = e.state.xp;
    e.tick(now);
    const p = e.state.plots[0];
    check('harvester harvested (+5 XP)', e.state.xp - xp0 === 5, `got ${e.state.xp - xp0}`);
    check('planter replanted the last crop', p.state === 'growing' && p.cropId === 'carrot' && (e.state.inventory.carrot ?? 0) === 0);
    check('sprinkler watered it', p.watered === true);
    check('three actions used 3 ⚡', e.state.power === 47, `got ${e.state.power}`);
    check('automation never produces coins', e.state.coins === coins1 && coins1 === coins0 - POWER_PACK.cost);

    check('toggleTool switches a tool off', e.toggleTool('harvester').ok === true && e.state.tools.harvester.on === false);
    check('toggleTool refuses an unowned tool', e.toggleTool('nope').error === 'not-owned');
    p.state = 'mature';
    p.growthProgress = 1;
    e.tick(now);
    check('switched-off harvester leaves the crop', p.state === 'mature' && e.state.power === 47);

    // Planter fallback: no seed of the last crop → most valuable owned seed that fits.
    e.state.plots.push({ ...newPlot(1), lastCropId: 'pumpkin' });
    e.state.inventory = { wheat: 1, apple: 1, carrot: 1 };
    e.tick(now);
    const fallback = e.state.plots.find((q) => q.id === 1)!;
    check(
      'planter falls back to the best seed the field can hold (wheat, not apple)',
      fallback.cropId === 'wheat',
      `got ${fallback.cropId}`,
    );
    done();
  }

  console.log('Plan limits — detection');
  {
    const at = new Date(2026, 9, 31, 10, 0, 0).getTime(); // local 10:00
    const iso = new Date(at).toISOString();
    const claudeErr = (error: string, text: string) => ({
      type: 'assistant',
      timestamp: iso,
      isApiErrorMessage: true,
      error,
      message: { model: '<synthetic>', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } },
    });
    check(
      'Claude auth failure is not a limit',
      detectClaudeLimit(claudeErr('authentication_failed', 'Failed to authenticate: OAuth session expired and could not be refreshed')) === null,
    );
    check('normal Claude usage is not a limit', detectClaudeLimit({ type: 'assistant', message: { usage: { output_tokens: 5 } } }) === null);
    const epoch = detectClaudeLimit(claudeErr('rate_limit', 'Claude AI usage limit reached|1793530800'));
    check('Claude limit with |epoch reset', epoch?.state === 'limited' && epoch.until === 1793530800000, JSON.stringify(epoch));
    const clock = detectClaudeLimit(claudeErr('rate_limit', "You've hit your limit · resets 3pm (America/Chicago)"));
    check('Claude "resets 3pm" → today 15:00 local', clock?.until === new Date(2026, 9, 31, 15, 0, 0).getTime());
    const late = detectClaudeLimit({ ...claudeErr('rate_limit', '5-hour limit reached ∙ resets 9am'), timestamp: new Date(2026, 9, 31, 16, 0, 0).toISOString() });
    check('Claude "resets 9am" after 9am → tomorrow 09:00', late?.until === new Date(2026, 10, 1, 9, 0, 0).getTime());
    const bare = detectClaudeLimit(claudeErr('', 'Claude usage limit reached.'));
    check('Claude limit text with no reset → +5 h fallback', bare?.until === at + LIMIT_FALLBACK_MS);

    const codex = (rate_limits: unknown) => ({ timestamp: iso, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits } });
    const realShape = {
      limit_id: 'codex', primary: { used_percent: 9.0, window_minutes: 10080, resets_at: 1793524664 },
      secondary: null, rate_limit_reached_type: null,
    };
    check('Codex snapshot under the limit → clear', detectCodexLimit(codex(realShape))?.state === 'clear');
    const full = detectCodexLimit(codex({ ...realShape, primary: { used_percent: 100, window_minutes: 300, resets_at: 1793530000 } }));
    check('Codex window at 100% → limited until its reset', full?.state === 'limited' && full.until === 1793530000000);
    const typed = detectCodexLimit(codex({
      ...realShape,
      primary: { used_percent: 97, resets_at: 1793520000 },
      secondary: { used_percent: 60, resets_at: 1793990000 },
      rate_limit_reached_type: 'primary',
    }));
    check('Codex rate_limit_reached_type → limited (latest window reset)', typed?.state === 'limited' && typed.until === 1793990000000);
    const legacy = detectCodexLimit(codex({ primary: { used_percent: 100, resets_in_seconds: 3600 } }));
    check('Codex legacy resets_in_seconds', legacy?.until === at + 3_600_000);
    const errEvt = detectCodexLimit({
      timestamp: iso, type: 'event_msg',
      payload: { type: 'error', message: "You've hit your usage limit. Try again in 2 hours 30 minutes." },
    });
    check('Codex usage-limit error event → limited', errEvt?.state === 'limited' && errEvt.until === at + 9_000_000);
    check('parseRetryIn handles days', parseRetryIn('try again in 1 day 2 hours') === 93_600_000);
    check('Codex response items are ignored', detectCodexLimit({ type: 'response_item', payload: {} }) === null);
  }

  console.log('Plan limits — farm protection');
  {
    const { e, done } = isolatedEngine('limits');
    e.state.inventory = { carrot: 1 };
    e.plant(0, 'carrot');
    const now = Date.now();
    sunny(e, now, false); // working hours, idle
    e.reportLimit({ agent: 'codex', state: 'limited', until: now + 60_000, at: now }, now);
    check('limit recorded', e.state.planLimits.codex?.until === now + 60_000);
    check('snapshot lists the active limit', e.snapshot(now).activeLimits.length === 1);
    e.tick(now);
    check('no wilt clock while limited', e.state.plots[0].sunnyIdleSeconds === 0);
    e.tick(now + 61_000);
    check('limit expires at its reset time', !e.state.planLimits.codex && e.state.plots[0].sunnyIdleSeconds === 1);
    e.reportLimit({ agent: 'codex', state: 'limited', until: now - 1, at: now - 10 }, now);
    check('a stale limit (already reset) is ignored', !e.state.planLimits.codex);

    e.reportLimit({ agent: 'codex', state: 'limited', until: now + 60_000, at: now }, now);
    e.reportLimit({ agent: 'claude', state: 'limited', until: now + 60_000, at: now }, now);
    e.ingest({ agent: 'claude', tokens: 100, at: now });
    check('real usage clears that agent’s limit only', !e.state.planLimits.claude && !!e.state.planLimits.codex);
    e.reportLimit({ agent: 'codex', state: 'clear', at: now }, now);
    check('a clear signal lifts the limit', !e.state.planLimits.codex);

    // Growth continues while one agent is limited and the other is working.
    e.reportLimit({ agent: 'codex', state: 'limited', until: now + 60_000, at: now }, now);
    const g0 = e.state.plots[0].growthProgress;
    sunny(e, now, true);
    e.tick(now);
    check('crops still grow while another agent is active', e.state.plots[0].growthProgress > g0);
    done();
  }

  console.log('Plan limits — live tail (integration)');
  {
    const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-limit-tail-'));
    fs.mkdirSync(path.join(ldir, 'proj'));
    const lfile = path.join(ldir, 'proj', 'session.jsonl');
    fs.writeFileSync(lfile, '');
    const limits: LimitEvent[] = [];
    const ladapter = new ClaudeAdapter({ root: ldir, offsets: {}, onEvent: () => {}, onLimit: (l) => limits.push(l) });
    ladapter.start();
    await sleep(500);
    const resetAt = Math.floor(Date.now() / 1000) + 3600;
    fs.appendFileSync(
      lfile,
      JSON.stringify({
        type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', timestamp: new Date().toISOString(),
        message: { content: [{ type: 'text', text: `Claude AI usage limit reached|${resetAt}` }] },
      }) + '\n',
    );
    await sleep(800);
    ladapter.stop?.();
    check('tailed Claude limit record reaches onLimit', limits.length === 1 && limits[0].until === resetAt * 1000, JSON.stringify(limits));
    fs.rmSync(ldir, { recursive: true, force: true });
  }

  console.log('Save migration — v0.2.1 → v0.3.0');
  {
    const old = {
      version: 1, onboarded: true, difficulty: 'normal',
      workingHours: { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
      coins: 1234.5, xp: 40, level: 2, inventory: { pumpkin: 2 },
      plots: [
        { id: 0, cropId: 'wheat', growthProgress: 0.5, state: 'growing', sunnyIdleSeconds: 10 },
        { id: 3, cropId: null, growthProgress: 0, state: 'empty', sunnyIdleSeconds: 0 },
      ],
      manualBlocked: false, devWeather: null, lastActivityAt: 5,
      ingestOffsets: { '/a.jsonl': 10 }, createdAt: 1, updatedAt: 2,
    };
    const m = migrate(old);
    check('migrated save is version 2', m.version === 2);
    check(
      'new farm-wide fields default empty',
      Object.keys(m.items).length === 0 && m.power === 0 && Object.keys(m.tools).length === 0 && Object.keys(m.planLimits).length === 0,
    );
    check(
      'plots gain tier 1, no boosts, lastCropId from the current crop',
      m.plots[0].tier === 1 && m.plots[0].watered === false && m.plots[0].fertilized === false && m.plots[0].lastCropId === 'wheat',
    );
    check('plot ids, progress, and seeds are kept', m.plots[1].id === 3 && m.plots[0].growthProgress === 0.5 && m.inventory.pumpkin === 2);
    check('coins, level, and ingest offsets are kept', m.coins === 1234.5 && m.level === 2 && m.ingestOffsets['/a.jsonl'] === 10);

    const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfarm-migrate-'));
    fs.writeFileSync(path.join(mdir, 'state.json'), JSON.stringify(old));
    const prev = process.env.TOKENFARM_STATE_DIR;
    process.env.TOKENFARM_STATE_DIR = mdir;
    const me = new Engine();
    check('an old state.json loads through the engine', me.state.plots[0].tier === 1 && me.state.inventory.pumpkin === 2);
    cancelPendingSave();
    process.env.TOKENFARM_STATE_DIR = prev;
    fs.rmSync(mdir, { recursive: true, force: true });
  }

  console.log('');
  if (failures) {
    console.error(`FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log('All checks passed ✓');
  process.exit(0);
}

main();
