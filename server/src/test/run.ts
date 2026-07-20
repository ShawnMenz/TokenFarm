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
import { defaultState, stateDir } from '../game/state.js';
import { CROPS, PLOW_COST, xpForLevel } from '../game/config.js';
import { Engine } from '../game/engine.js';
import type { TokenEvent } from '../ingest/types.js';

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
  engine.state.plots.push({
    id: 1,
    cropId: 'wheat',
    growthProgress: 0.5,
    state: 'growing',
    sunnyIdleSeconds: 0,
  });
  const offsetsRef = engine.state.ingestOffsets;
  offsetsRef['/some/session.jsonl'] = 123;

  check('restart succeeds in dev mode', engine.restart().ok === true);
  check('restart resets coins', engine.state.coins === 0);
  check('restart resets xp and level', engine.state.xp === 0 && engine.state.level === 1);
  check('restart returns to onboarding', engine.snapshot().onboarded === false);
  check('restart resets to a single field', engine.state.plots.length === 1);
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
    shopEngine.buySeed('pumpkin').error === 'insufficient-coins' &&
      shopEngine.state.coins === 500 &&
      (shopEngine.state.inventory.pumpkin ?? 0) === 0,
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
  shopEngine.buySeed('corn'); // own 1 corn
  process.env.TOKENFARM_DEV = '1';
  shopEngine.restart();
  check('restart clears inventory', Object.keys(shopEngine.state.inventory).length === 0);
  if (prevDev === undefined) delete process.env.TOKENFARM_DEV;
  else process.env.TOKENFARM_DEV = prevDev;

  fs.rmSync(shopDir, { recursive: true, force: true });
  if (prevShopStateDir === undefined) delete process.env.TOKENFARM_STATE_DIR;
  else process.env.TOKENFARM_STATE_DIR = prevShopStateDir;

  console.log('');
  if (failures) {
    console.error(`FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log('All checks passed ✓');
  process.exit(0);
}

main();
