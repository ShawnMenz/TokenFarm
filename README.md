# 🌾 TokenFarm

[![CI](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml/badge.svg)](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TokenFarm is a personal, single-player ambient farm where local coding-agent token
usage becomes the only source of in-game coins. Work with Claude Code or Codex, then
spend the resulting coins to plant crops, expand the farm, and turn harvests into XP.

The game runs quietly beside a terminal. Recent agent activity acts like sunlight:
crops grow while you work, begin to wilt after generous stretches of working-hours
inactivity, and remain protected during rest time.

> Status: **v0.1.0 — complete initial playable release with Claude Code and Codex
> support.** See [the changelog](CHANGELOG.md).

## What is included in v0.1.0

- Concurrent local ingestion from Claude Code and Codex CLI/Desktop.
- Difficulty-scaled token-to-coin conversion with whole-coin presentation.
- Working-hours weather, activity-driven growth, wilting, recovery, and death.
- Planting and harvesting wheat, XP and levels, crop removal, and unlimited field
  expansion through the **+** tile.
- First-launch setup, a guided tutorial, and a replayable bottom-right version badge.
- Local save-state and ingestion-offset persistence.
- Development and production servers, automated checks, TypeScript validation, and
  production builds.

The complete feature inventory is filed as new work in the
[v0.1.0 changelog](CHANGELOG.md#010---2026-07-17).

## How token usage becomes coins

```text
Claude Code  ~/.claude/projects/**/*.jsonl ─┐
                                             ├─▶ TokenFarm server ──SSE──▶ Browser farm
Codex       ~/.codex/sessions/**/*.jsonl ────┘    tail → coins + simulation
```

TokenFarm watches only records appended while it is running. Existing session
history is skipped the first time a file is seen, and persisted byte offsets prevent
already-consumed records from being rewarded after a restart.

Countable usage is normalized per provider:

```text
Claude Code currency = input_tokens
                     + cache_creation_input_tokens
                     + output_tokens

Codex currency       = input_tokens
                     + cache_write_input_tokens
                     + output_tokens
```

Claude `cache_read_input_tokens` are excluded. Codex reads only the per-turn
`last_token_usage`; cumulative totals and separate reasoning totals are not added,
and cached-input metadata is not deducted.

Countable tokens are converted using the selected difficulty:

```text
coins earned = countable tokens × difficulty multiplier ÷ 100
```

Easy uses ×1.5, Normal ×1.0, and Difficult ×0.5. Fractional accrual is retained in
the save state, while the interface displays and spends the whole-coin portion.

## Gameplay loop

1. Choose a difficulty and working schedule during first-launch onboarding.
2. Work locally with Claude Code or Codex to earn coins in real time.
3. Spend coins to plant wheat or plow another field with the **+** tile.
4. Keep the agent active during sunny working hours to grow crops. A wilted crop can
   recover when activity resumes.
5. Harvest mature wheat for XP, or remove wilted and dead crops to reuse their fields.

Weather has two states:

- **☀️ Sunny:** configured working time. Active agent usage grows crops; inactivity
  advances the wilt clock.
- **🌧️ Rainy:** off-hours, weekends, or manual blocked mode. Crops are protected and
  neither grow nor decay.

Tokens are the only coin faucet; harvesting awards XP rather than coins.

## Requirements

- Node.js 20 or newer and npm.
- At least one supported local coding agent: Claude Code or local Codex CLI/Desktop
  session files.

No API key or account integration is required. TokenFarm reads local JSONL session
files only.

## Install and run

```bash
npm install
npm run dev
```

Development mode starts both processes:

| Process | URL | Purpose |
| --- | --- | --- |
| Game server | http://localhost:8787 | Tails agent logs, runs the simulation, and provides SSE plus actions |
| Vite UI | http://localhost:5173 | Browser interface with development proxying |

Open http://localhost:5173. In VS Code, the built-in **Simple Browser: Show** command
can keep the farm in an editor pane beside the terminal.

To observe the full grow, wilt, and death cycle quickly:

```bash
TOKENFARM_FAST=1 npm run dev
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKENFARM_FAST` | unset | Set to `1` to shorten activity, growth, wilt, and death timers. |
| `TOKENFARM_STATE_DIR` | `~/.tokenfarm` | Directory containing the persistent `state.json` save file. |
| `TOKENFARM_CLAUDE_DIR` | `~/.claude/projects` | Root directory containing Claude Code session logs. |
| `TOKENFARM_CODEX_DIR` | `$CODEX_HOME/sessions`, otherwise `~/.codex/sessions` | Explicit Codex rollout root; this override takes precedence over both defaults. |

If `TOKENFARM_CODEX_DIR` is unset and `CODEX_HOME` is defined, TokenFarm watches
`$CODEX_HOME/sessions`. Balance values such as the conversion divisor, multipliers,
crop price, plow price, and timers live in
[`server/src/game/config.ts`](server/src/game/config.ts).

## Tutorial and version badge

After onboarding, new players receive a guided tour of every v0.1.0 feature visible
in the farm. Tutorial completion is stored in browser `localStorage` under
`tokenfarm.tutorialVersion`.

The bottom-right badge reads `v 0.1.0`. Its value comes from `package.json` through
Vite's `__APP_VERSION__` build constant, so the package and interface share one
version source. Click the badge to replay the complete tutorial.

## Verification

```bash
npm test          # accounting, path, weather, economy, and live-tail checks
npm run typecheck # TypeScript validation
npm run build     # production browser bundle in web-dist/
```

The live-tail checks cover both providers, startup-history protection, incomplete
lines, malformed records, new sessions, truncation recovery, persisted offsets, and
concurrent aggregation.

## Production

```bash
npm run build
npm start
```

The server serves the generated `web-dist/` application at http://localhost:8787.

## Project structure

```text
TokenFarm/
├── server/src/
│   ├── index.ts              HTTP, SSE, actions, static files, and adapter startup
│   ├── sse.ts                SSE client registry and broadcasting
│   ├── game/
│   │   ├── config.ts         Economy, crops, prices, and timers
│   │   ├── engine.ts         Coin ingestion, simulation, and player actions
│   │   ├── state.ts          Save-state schema and atomic JSON persistence
│   │   └── weather.ts        Working schedule and blocked-mode weather
│   ├── ingest/
│   │   ├── types.ts          Normalized token events and adapter interface
│   │   ├── jsonlTailer.ts    Recursive JSONL watching and byte offsets
│   │   ├── claudeAdapter.ts  Claude Code usage normalization
│   │   └── codexAdapter.ts   Codex rollout usage normalization
│   └── test/run.ts           Assertion and live-tail integration harness
├── web/
│   ├── index.html
│   └── src/
│       ├── api.ts            SSE subscription and action requests
│       ├── main.ts           Application state, interactions, and version badge
│       ├── render.ts         Onboarding and farm markup
│       ├── tutorial.ts       Versioned guided walkthrough
│       └── style.css         Farm, modal, badge, and tutorial styling
├── CHANGELOG.md              Keep a Changelog-style release history
├── package.json              Scripts, dependencies, and release version
└── vite.config.ts            Development proxy and production build
```

## Versioning

TokenFarm follows [Semantic Versioning](https://semver.org/) and maintains a
[Keep a Changelog](https://keepachangelog.com/)-style history. The repository's
complete current development state is the initial `0.1.0` release.

While the project remains below 1.0.0:

- Minor releases (`0.x.0`) add player-facing features and include walkthrough steps
  for those features.
- Patch releases (`0.x.y`) contain fixes or tuning without new tutorial steps.
- Version `1.0.0` is reserved for a feature-complete stable release.

## Current limitation

Personal Codex Cloud tasks do not count because their personal task interface does
not expose the exact per-turn token usage required by TokenFarm's economy. Local
Codex CLI/Desktop rollouts are supported.

## Roadmap

Deferred ideas include crop and field tiers, fertilizer, electricity, utensils and
automation, medicine for wilted crops, a full level-unlock tree, automatic plan-limit
detection, more coding-agent adapters, exact personal cloud usage if an API becomes
available, OpenTelemetry as a multi-agent ingestion layer, richer artwork, and a
dedicated VS Code panel extension.
