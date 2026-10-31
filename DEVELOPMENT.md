# 🛠️ TokenFarm development guide

**English** | [简体中文](DEVELOPMENT.zh-CN.md)

This guide covers running TokenFarm from source, configuration, developer mode, tests,
and the project layout. For what the game is and how to play it, see the
[README](README.md); for release history, see the [changelog](CHANGELOG.md).

## Setup

TokenFarm requires Node.js 20 or newer.

```bash
npm ci
```

## Development mode

```bash
npm run dev
```

This starts both processes:

| Process | URL | Purpose |
| --- | --- | --- |
| Game server | http://localhost:8787 | Tails agent logs, runs the simulation, and provides SSE plus actions |
| Vite UI | http://localhost:5173 | Browser interface with development proxying |

Open http://localhost:5173. To observe the full grow, wilt, and death cycle in
seconds instead of hours:

```bash
TOKENFARM_FAST=1 npm run dev
```

## Production build

```bash
npm run build
npm start
```

The server serves the generated `web-dist/` application at http://localhost:8787.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKENFARM_FAST` | unset | Set to `1` to shorten activity, growth, wilt, and death timers. |
| `TOKENFARM_DEV` | unset | Set to `1` to enable [developer mode](#developer-mode). `npm run dev` sets this automatically; `npm start` does not. |
| `TOKENFARM_PORT` | `8787` | Override the game server port, e.g. to run a second, isolated instance alongside a primary one. |
| `TOKENFARM_STATE_DIR` | `~/.tokenfarm` (user) · `~/.tokenfarm-dev` (dev) | Directory containing the persistent `state.json` save file. When unset, developer mode (`TOKENFARM_DEV=1`) uses a separate `~/.tokenfarm-dev` sandbox; setting this variable overrides both. |
| `TOKENFARM_CLAUDE_DIR` | `~/.claude/projects` | Root directory containing Claude Code session logs. |
| `TOKENFARM_CODEX_DIR` | `$CODEX_HOME/sessions`, otherwise `~/.codex/sessions` | Explicit Codex rollout root; this override takes precedence over both defaults. |

If `TOKENFARM_CODEX_DIR` is unset and `CODEX_HOME` is defined, TokenFarm watches
`$CODEX_HOME/sessions`.

Priced values — seed costs, plow cost, the coin conversion divisor, difficulty
multipliers, the XP-per-level curve, each crop's grow time, XP reward, unlock level
and minimum field tier, supplies, field tiers, electricity, and tools — are the
canonical record in [`server/src/game/prices.json`](server/src/game/prices.json);
edit that one file to tune the economy. Remaining timing constants (activity window,
wilt/death clocks, the 5-hour plan-limit fallback) live in
[`server/src/game/config.ts`](server/src/game/config.ts).

## Developer mode

`npm run dev` runs in **developer mode** (it sets `TOKENFARM_DEV=1`); `npm start`
runs in normal user mode. Developer mode adds controls for testing the game without
waiting on real agent token activity:

- **Adjustable state.** Edit coins, XP, and level directly; override the weather
  (Auto / ☀️ Sunny / 🌧️ Rainy); and per planted plot, drag a growth-% slider (100%
  = ready) or force its state (growing / mature / wilted / dead / empty). Editable
  fields keep focus and your input across the live refresh.
- **Fake token flow.** A left-side box lets you enter `input_tokens`,
  `cache_creation_input_tokens`, and `output_tokens`; it previews the coins that
  burst yields at the current conversion divisor and difficulty, and the **Inject**
  button runs it through the real ingestion path — handy for tuning
  `conversionDivisor`.
- **Restart.** A bottom-center **Restart** button wipes all progress and returns
  to first-launch onboarding. It preserves log ingest offsets, so a restart does
  not re-read your whole token history back into coins.

All controls are hidden in user mode, and the server rejects their actions
(`dev-only`) unless `TOKENFARM_DEV=1`, so a `npm start` build cannot invoke them.

**Separate save profile.** Developer mode uses its own isolated save directory —
`~/.tokenfarm-dev` — instead of the real `~/.tokenfarm`. Running `npm run dev` (and
its Restart / edits) therefore never touches your real game or its token-ingest
progress: it keeps its own offsets, so the next `npm start` still collects every
token since your last user session, including any that arrived during a dev session.
`npm start` never creates or reads the dev profile. (`TOKENFARM_STATE_DIR` overrides
both.)

## Verification

Before completing a change, run:

```bash
npm test          # accounting, path, weather, economy, progression, automation, plan-limit, migration, and live-tail checks
npm run typecheck # TypeScript validation
npm run build     # production browser bundle in web-dist/
```

The live-tail checks cover both providers, startup-history protection, incomplete
lines, malformed records, new sessions, truncation recovery, persisted offsets,
concurrent aggregation, and plan-limit records. Saves from older versions are
upgraded automatically on load; that migration is tested too.

## Project structure

```text
TokenFarm/
├── server/src/
│   ├── index.ts              HTTP, SSE, actions, static files, and adapter startup
│   ├── sse.ts                SSE client registry and broadcasting
│   ├── game/
│   │   ├── prices.json       Canonical price record (crops, supplies, tiers, tools, XP curve)
│   │   ├── config.ts         Loads prices.json; economy, catalogs, unlocks, and timers
│   │   ├── engine.ts         Coin ingestion, simulation, automation, and player actions
│   │   ├── state.ts          Save-state schema, migration, and atomic JSON persistence
│   │   └── weather.ts        Working schedule and blocked-mode weather
│   ├── ingest/
│   │   ├── types.ts          Normalized token/limit events and adapter interface
│   │   ├── jsonlTailer.ts    Recursive JSONL watching and byte offsets
│   │   ├── claudeAdapter.ts  Claude Code usage normalization
│   │   ├── codexAdapter.ts   Codex rollout usage normalization
│   │   └── limits.ts         Plan-limit detection for both agents
│   └── test/run.ts           Assertion and live-tail integration harness
├── web/
│   ├── index.html
│   └── src/
│       ├── api.ts            SSE subscription and action requests
│       ├── i18n.ts           English/Chinese copy catalog and language toggle
│       ├── main.ts           Application state, interactions, and version badge
│       ├── render.ts         Onboarding and farm markup
│       ├── tutorial.ts       Versioned guided walkthrough
│       └── style.css         Farm, modal, badge, and tutorial styling
├── README.md                 Project introduction, quick start, and game guide
├── DEVELOPMENT.md            This guide
├── CHANGELOG.md              Keep a Changelog-style release history
├── package.json              Scripts, dependencies, and release version
└── vite.config.ts            Development proxy and production build
```

Every user-facing document has a Simplified-Chinese counterpart (`*.zh-CN.md`), and
every UI string has English and Chinese entries in `web/src/i18n.ts`.

## Versioning

TokenFarm follows [Semantic Versioning](https://semver.org/) and keeps a
[Keep a Changelog](https://keepachangelog.com/)-style history in
[CHANGELOG.md](CHANGELOG.md). While the project remains below 1.0.0:

- Minor releases (`0.x.0`) add player-facing features and include walkthrough steps
  for those features.
- Patch releases (`0.x.y`) contain fixes or tuning without new tutorial steps.
- Version `1.0.0` is reserved for a feature-complete stable release.

The in-game version badge reads `package.json` through Vite's `__APP_VERSION__` build
constant, so the package and interface share one version source.

## Roadmap

Deferred ideas include more coding-agent adapters, exact personal cloud usage if an
API becomes available, OpenTelemetry as a multi-agent ingestion layer, richer
artwork, and a dedicated VS Code panel extension.
