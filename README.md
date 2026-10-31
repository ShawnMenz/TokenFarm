# 🌾 TokenFarm

**English** | [简体中文](README.zh-CN.md)

[![CI](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml/badge.svg)](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TokenFarm is a personal, single-player ambient farm where local coding-agent token
usage becomes the only source of in-game coins. Work with Claude Code or Codex, then
spend the resulting coins to plant crops, expand the farm, and turn harvests into XP.

The game runs quietly beside a terminal. Recent agent activity acts like sunlight:
crops grow while you work, begin to wilt after generous stretches of working-hours
inactivity, and remain protected during rest time.

- 📜 **What's new:** see the [changelog](CHANGELOG.md).
- 🛠️ **Configuration, developer mode, and project structure:** see the
  [development guide](DEVELOPMENT.md).

## Quick start

You need **Node.js 20 or newer** and at least one local coding agent: **Claude Code**
or the **Codex** CLI/Desktop app. No API key or account connection is required —
TokenFarm only reads the session logs those agents already write on your machine.

```bash
git clone https://github.com/ShawnMenz/TokenFarm.git
cd TokenFarm
npm install
npm run build
npm start
```

Open **http://localhost:8787**, choose a difficulty and your working hours, then go
back to coding. Coins arrive as soon as your agent uses tokens. In VS Code, the
**Simple Browser: Show** command keeps the farm in a pane beside your terminal.

Your farm is saved to `~/.tokenfarm/state.json` and picks up where you left off the
next time you run `npm start`.

## Game guide

### The loop

1. Choose a difficulty and working schedule during first-launch setup.
2. Work with Claude Code or Codex to earn coins in real time.
3. Buy seeds in the [shop](#crops-and-levels) and plant them on a field — or plow
   another field with the **+** tile (300 coins each, no limit).
4. Keep your agent active during sunny working hours so crops grow.
5. Harvest mature crops for XP. Remove wilted or dead crops to reuse their fields.
6. Level up to unlock new crops, [supplies](#supplies),
   [field upgrades](#field-upgrades), and [tools](#tools-and-electricity) that run the
   farm for you.

### Coins come from tokens

```text
Claude Code  ~/.claude/projects/**/*.jsonl ─┐
                                             ├─▶ TokenFarm server ──SSE──▶ Browser farm
Codex       ~/.codex/sessions/**/*.jsonl ────┘    tail → coins + simulation
```

Tokens are the only coin faucet — harvesting gives XP, never coins. Countable usage is
normalized per agent:

```text
Claude Code currency = input_tokens
                     + cache_creation_input_tokens
                     + output_tokens

Codex currency       = input_tokens
                     + cache_write_input_tokens
                     + output_tokens
```

Claude `cache_read_input_tokens` are excluded. Codex reads only the per-turn
`last_token_usage`; cumulative totals and separate reasoning totals are not added.
Countable tokens become coins at your difficulty's rate:

```text
coins earned = countable tokens × difficulty multiplier ÷ 200
```

Easy uses ×1.5, Normal ×1.0, and Difficult ×0.5. Fractions are kept in your save; the
interface shows and spends whole coins.

Only usage written while TokenFarm is running counts. Session history that already
exists the first time TokenFarm sees a log is skipped, and saved read positions stop
anything from being rewarded twice after a restart. Personal Codex Cloud tasks don't
count, because they don't expose per-turn token usage; local Codex CLI/Desktop
sessions do.

### Weather and wilting

- **☀️ Sunny:** your working hours. While your agent is active (any token use in the
  last 2 minutes), crops grow. While it's idle, a wilt clock runs.
- **🌧️ Rainy:** off-hours, weekends, or **I'm blocked** mode. Crops are protected —
  they neither grow nor decay.

The wilt clock is generous: a crop wilts after about 2.5 working days of idle sunny
time and dies after 5. A wilting crop recovers as soon as your agent is active again,
or you can cure it with medicine. Dead crops can only be removed. Waiting on something
outside your control? Flip **I'm blocked** to force rainy weather.

### Plan-limit protection

If Claude Code or Codex hits a usage limit, you can't keep working with it, so letting
crops wilt would be unfair. TokenFarm reads the limit from the same local logs:

- **Codex** records a usage snapshot on every turn. A full window (100%) means limited
  until that window resets.
- **Claude Code** writes an error record when a usage limit is reached. Its reset time
  is read from the message when present; otherwise protection lasts 5 hours.

While a limit is active, idle working-hours time doesn't count toward wilting, and the
weather line says which agent is limited and until when. Crops still grow if you keep
working with the other agent. Protection ends at the reset time, or as soon as that
agent produces real usage again.

### Crops and levels

| Crop | Coins | Grow time | Harvest XP | Unlocks at |
| --- | --- | --- | --- | --- |
| Carrot 🥕 | 500 | 15 min | +5 | Lv 1 |
| Wheat 🌾 | 1,500 | 30 min | +10 | Lv 1 |
| Corn 🌽 | 2,500 | 30 min | +12 | Lv 3 |
| Pumpkin 🎃 | 6,000 | 60 min | +25 | Lv 5 |
| Apple Tree 🍎 | 12,000 | 120 min | +60 | Lv 8 · needs a Fertile Field or better |

Grow time is active, sunny working time. Buying a seed puts it in your stock; planting
uses one from stock, so you never pay twice.

XP fills the bar under your coins. Early levels take 100 XP each, and later levels
cost progressively more, with no level cap. Your level decides what the shop sells:
locked cards show 🔒 and the level they open at, and the line under the XP bar shows
your next unlock. Seeds you already own stay plantable even above your level.

### Supplies

Supplies are one-use items. Buy them into your stock, then use them from a field.

| Supply | Coins | Unlocks at | Effect |
| --- | --- | --- | --- |
| 💧 Water | 150 | Lv 2 | The crop it's used on grows ×1.5 faster. |
| 💊 Medicine | 400 | Lv 2 | Cures a wilting crop (a dead crop can't be saved). |
| 🧪 Fertilizer | 300 | Lv 3 | The crop it's used on gives ×1.5 XP at harvest (rounded). |

Water and fertilizer can each be used once per crop; small 💧/🧪 badges show which a
field already has. A **💊 Cure** button appears on wilting crops when you have
medicine.

### Field upgrades

An empty field shows an **⬆️** button once its next tier is unlocked. Upgrades are
permanent and stack with water.

| Field tier | Upgrade cost | Unlocks at | Growth |
| --- | --- | --- | --- |
| Field | — | Lv 1 | ×1.0 |
| Fertile Field | 2,000 | Lv 3 | ×1.25 |
| Greenhouse | 8,000 | Lv 6 | ×1.5 |

### Tools and electricity

Tools are bought once and then act on their own every second, spending ⚡ electricity
for each action. Electricity comes in packs of 50 ⚡ for 500 coins (unlocks at Lv 4)
and shows next to your coins. Each tool has an **On/Off** switch on its shop card.

| Tool | Coins | Unlocks at | What it does (1 ⚡ per action) |
| --- | --- | --- | --- |
| 🚿 Sprinkler | 5,000 | Lv 4 | Waters growing crops. |
| 🤖 Harvester | 8,000 | Lv 5 | Harvests mature crops (you still get the XP). |
| 🚜 Planter | 8,000 | Lv 6 | Replants empty fields from your seed stock — the crop last grown there if you have it, otherwise the most valuable seed the field can hold. |

Tools never produce coins, so your agent's tokens remain the only coin source.

### Tutorial and language

After setup, a short guided tour points out each part of the farm. When an update adds
features, returning players see only the new steps. Click the version badge in the
bottom-right corner to replay the full tour.

The **中文 / EN** button next to the badge switches the whole interface between English
and Simplified Chinese instantly; your choice is remembered in the browser.
