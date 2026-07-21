# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

## [Unreleased]

_Nothing yet._

## [0.2.1] - 2026-07-20

### Added

- **Simplified-Chinese localization.** The entire browser interface — HUD, weather,
  plots, seed shop, onboarding, guided tutorial, and developer controls — can now
  render in 简体中文. Crop names are translated in the browser (胡萝卜 / 小麦 / 玉米 /
  南瓜), keeping the server/web boundary intact.
- **In-app language toggle.** A bottom-right **中文 / EN** button switches the whole
  UI between English and Chinese instantly and re-renders the live view (including an
  open tutorial). The choice persists in browser `localStorage` under
  `tokenfarm.lang`; English is the default on first load.
- **Bilingual documentation.** The README and this changelog now ship Chinese
  counterparts — [`README.zh-CN.md`](README.zh-CN.md) and
  [`CHANGELOG.zh-CN.md`](CHANGELOG.zh-CN.md) — with a language selector at the top of
  each file.

## [0.2.0] - 2026-07-20

### Added

- **Seed shop and inventory.** A shop now sells seeds into a per-crop inventory:
  buy a seed with coins, then plant an owned seed on a plowed field. Planting
  consumes a seed from stock rather than charging coins at plant time. The shop
  panel shows each crop's price, XP reward, grow time, and how many you own, with a
  hint on empty fields when you have no seeds yet.
- **Three new crops.** Alongside Wheat 🌾 (1,500 coins), the farm now grows
  Carrot 🥕 (500, fast, +5 XP), Corn 🌽 (2,500, +12 XP), and Pumpkin 🎃 (6,000,
  slow, +25 XP) — a cheap-to-premium progression ladder. XP remains a harvest
  reward only; it is not spent on anything yet.
- **Canonical price record.** All priced values — seed costs, plow cost, the coin
  conversion divisor, difficulty multipliers, the XP-per-level curve, and each
  crop's grow time and XP reward — now live in one human-readable
  [`server/src/game/prices.json`](server/src/game/prices.json), loaded at startup.
  Tune the economy by editing that one file.
- **Gradual leveling curve.** XP required per level now follows an ascending band
  curve (`xpLevelBands` in `prices.json`) instead of a flat rate — early levels are
  quick and higher levels cost progressively more, holding at the top band's rate
  beyond it (no level cap). Add bands to raise it further.
- **Developer mode.** Launching with `npm run dev` enables a developer mode whose
  testing controls never appear in a `npm start` (user-mode) build. The mode is
  decided by the npm entry point: `dev:server` sets `TOKENFARM_DEV=1`, and the
  server reports the flag to the browser over the existing snapshot stream.
  - **Adjustable game state.** Directly edit the coin balance, XP, and level;
    override the weather (Auto / ☀️ Sunny / 🌧️ Rainy); and, per planted plot, drag
    a growth-% slider (100% = ready) or force its state (growing / mature / wilted /
    dead / empty). Every editable control survives the per-second refresh while
    focused.
  - **Fake token flow.** A left-side box takes `input_tokens`,
    `cache_creation_input_tokens`, and `output_tokens`, previews the resulting coins
    at the current conversion divisor and difficulty, and injects the burst through
    the real ingestion path — useful for tuning `conversionDivisor`.
  - **Restart button.** A bottom-center **Restart** control fully wipes progress
    and returns to first-launch onboarding, while preserving log ingest offsets so
    a restart does not re-tail and refund your entire token history.
  - **Isolated save profile.** Developer mode uses its own `~/.tokenfarm-dev`
    directory instead of the real `~/.tokenfarm`, so its edits/Restart never touch
    your real game and — keeping separate ingest offsets — never consume your token
    usage; `npm start` (user mode) never creates or reads the dev profile.
  - All dev actions are enforced server-side and return `dev-only` in user mode, so
    a production build cannot invoke them. The player-facing tutorial is unchanged,
    since developer mode is a developer tool that is absent from user-mode builds.
- **Smarter onboarding.** The working-days picker auto-groups into Weekdays /
  Weekend / Everyday chips (defaulting to weekdays) and requires at least one day;
  the difficulty picker uses friendlier labels with a plain-language explanation of
  the coin ratio. The in-game footer summarizes working days with the same grouping.
- **`TOKENFARM_PORT` override.** The game server port (default `8787`) can now be
  set with `TOKENFARM_PORT`, so a second, isolated instance can run alongside a
  primary one.

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

[Unreleased]: https://github.com/ShawnMenz/TokenFarm/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/ShawnMenz/TokenFarm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ShawnMenz/TokenFarm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ShawnMenz/TokenFarm/releases/tag/v0.1.0
