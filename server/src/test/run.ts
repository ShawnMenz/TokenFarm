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
import { defaultState } from '../game/state.js';
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

  console.log('');
  if (failures) {
    console.error(`FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log('All checks passed ✓');
  process.exit(0);
}

main();
