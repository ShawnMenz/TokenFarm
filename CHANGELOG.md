# Changelog

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-07-17

Initial playable release: the complete local TokenFarm loop, powered by Claude Code
and Codex activity.

### Added

- **Claude Code and Codex token ingestion.** TokenFarm tails local Claude Code
  sessions under `~/.claude/projects` and Codex rollouts under
  `~/.codex/sessions`, with environment-variable overrides for both providers.
  Both adapters run concurrently and feed one normalized token stream and coin
  balance.
- **Provider-aligned token accounting.** Claude Code counts input, cache-creation,
  and output tokens while excluding cache reads. Codex counts per-turn input,
  cache-write, and output tokens from `last_token_usage`, excluding cumulative totals
  and duplicate reasoning totals.
- **Resilient shared JSONL tailing.** Recursive session watching persists a byte
  offset per file, skips history found on first startup, defers incomplete trailing
  records, ignores malformed records, detects new sessions, and recovers from file
  truncation.
- **Token-only economy.** Countable agent tokens convert to coins using Easy ×1.5,
  Normal ×1.0, or Difficult ×0.5 difficulty. Accrual retains fractional precision,
  while the UI presents and spends whole coins.
- **Working-hours weather.** Configurable local working days and hours produce ☀️
  Sunny weather; off-hours and weekends produce 🌧️ Rainy weather. Recent agent
  activity grows crops during sunny time, while sunny inactivity advances a generous
  wilt-and-death clock. Rainy time protects the farm.
- **Blocked protection.** The manual **I'm blocked** control forces rainy weather so
  external delays do not punish the player.
- **Complete wheat crop lifecycle.** Players spend coins to plant wheat, watch its
  growth stages, revive wilting crops by resuming agent activity, harvest mature
  crops for XP, level up, and remove wilted or dead crops after a confirmation.
  Wheat seed costs 1,500 coins in the initial balance.
- **Expandable farm.** New farms begin with one plantable field. A persistent **+**
  tile spends 300 coins to plow each additional field, allowing the farm to expand
  without a fixed plot limit.
- **Persistent local state.** Coins, progress, fields, preferences, activity, blocked
  state, and ingestion offsets are saved atomically to
  `~/.tokenfarm/state.json` by default and resume across restarts.
- **Real-time local application.** A Node.js and TypeScript server exposes action
  endpoints, streams snapshots over Server-Sent Events, and serves the Vite and
  TypeScript browser farm in production.
- **First-launch onboarding.** New players choose Easy, Normal, or Difficult and set
  their working days and hours before entering the farm.
- **Guided tutorial and release badge.** A spotlight walkthrough explains coins,
  dual-agent income, weather, blocked protection, XP, fields, difficulty, and working
  hours. Progress is stored locally, the bottom-right `v 0.1.0` badge is injected
  from `package.json`, and clicking it replays the complete tour.
- **Fast demonstration mode.** `TOKENFARM_FAST=1` shortens activity, growth, wilt,
  and death timers so the full loop can be observed in seconds.
- **Configuration overrides.** Environment variables select the state directory,
  Claude log root, Codex log root, and fast-mode timing without requiring API keys or
  account integrations.
- **Verification workflows.** The repository includes parser, accounting, path,
  weather, coin-math, JSONL-tail, restart-offset, truncation, and concurrent-provider
  checks, plus TypeScript validation and a production build command.

<!--
When this project gains a git remote, wire the version headers to compare links, e.g.:
[Unreleased]: https://github.com/OWNER/tokenfarm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/tokenfarm/releases/tag/v0.1.0
-->
