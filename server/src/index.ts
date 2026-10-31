import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './game/engine.js';
import { ClaudeAdapter } from './ingest/claudeAdapter.js';
import { CodexAdapter } from './ingest/codexAdapter.js';
import { addClient, broadcast, sendTo } from './sse.js';
import { SERVER_PORT } from './game/config.js';
import { STATE_FILE } from './game/state.js';

const engine = new Engine();
engine.onChange((snap) => broadcast(snap));
engine.start();

// All providers feed one economy and mutate the same persisted absolute-path
// offset map, so each log resumes independently across restarts.
const adapters = [
  new ClaudeAdapter({
    offsets: engine.state.ingestOffsets,
    onEvent: (event) => engine.ingest(event),
    onLimit: (event) => engine.reportLimit(event),
  }),
  new CodexAdapter({
    offsets: engine.state.ingestOffsets,
    onEvent: (event) => engine.ingest(event),
    onLimit: (event) => engine.reportLimit(event),
  }),
];
for (const adapter of adapters) adapter.start();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web-dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // guard
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function handleAction(action: string, body: any) {
  switch (action) {
    case 'plow':
      return engine.plow();
    case 'buySeed':
      return engine.buySeed(String(body.cropId));
    case 'plant':
      return engine.plant(Number(body.plotId), String(body.cropId));
    case 'harvest':
      return engine.harvest(Number(body.plotId));
    case 'clear':
      return engine.clear(Number(body.plotId));
    case 'onboard':
      return engine.onboard(body.difficulty, body.workingHours);
    case 'toggleBlocked':
      return engine.toggleBlocked();
    case 'buyItem':
      return engine.buyItem(String(body.itemId));
    case 'applyItem':
      return engine.applyItem(Number(body.plotId), String(body.itemId));
    case 'upgradeField':
      return engine.upgradeField(Number(body.plotId));
    case 'buyTool':
      return engine.buyTool(String(body.toolId));
    case 'toggleTool':
      return engine.toggleTool(String(body.toolId));
    case 'buyPower':
      return engine.buyPower();
    case 'setCoins':
      return engine.setCoins(Number(body.amount));
    case 'setXp':
      return engine.setXp(Number(body.amount));
    case 'setLevel':
      return engine.setLevel(Number(body.amount));
    case 'setGrowth':
      return engine.setGrowth(Number(body.plotId), Number(body.progress));
    case 'setPlotState':
      return engine.setPlotState(Number(body.plotId), String(body.state));
    case 'setWeather':
      return engine.setWeather(String(body.weather));
    case 'injectTokens':
      return engine.injectTokens(body);
    case 'restart':
      return engine.restart();
    default:
      return { ok: false, error: 'unknown-action' };
  }
}

function serveStatic(pathname: string, res: ServerResponse): void {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(WEB_DIST, path.normalize(rel));
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback / dev hint.
      if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(fs.readFileSync(path.join(WEB_DIST, 'index.html')));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('TokenFarm: run `npm run dev` and open http://localhost:5173');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/events') {
    addClient(res);
    sendTo(res, engine.snapshot());
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/action/')) {
    const body = await readBody(req);
    const result = handleAction(url.pathname.slice('/action/'.length), body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(SERVER_PORT, () => {
  console.log(`TokenFarm server → http://localhost:${SERVER_PORT}`);
  console.log(`  state file: ${STATE_FILE}`);
  console.log(`  dev UI:     http://localhost:5173  (run: npm run dev)`);
});
