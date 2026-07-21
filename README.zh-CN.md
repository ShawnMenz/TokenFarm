# 🌾 TokenFarm

[English](README.md) | **简体中文**

[![CI](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml/badge.svg)](https://github.com/ShawnMenz/TokenFarm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TokenFarm 是一个个人单人的氛围农场游戏，本地编程助手的 token 用量是游戏内金币的唯一
来源。使用 Claude Code 或 Codex 工作，再用产出的金币种植作物、扩建农场，并把收获转化为
经验。

游戏安静地运行在终端旁边。近期的助手活动就像阳光：你工作时作物会生长，在工作时间内长时间
不活跃后开始枯萎，而在休息时间则受到保护。

> 状态：**v0.2.1 — 完整的简体中文界面，并内置英文 / 中文应用内切换，构建于 v0.2.0 的
> 种子商店、新作物、渐进升级曲线与扩展的开发者模式之上。** 参见
> [更新日志](CHANGELOG.zh-CN.md)。

## v0.2.1 新增

- **简体中文界面。** 整个界面 —— 顶栏、天气、地块、种子商店、初始设置、教程以及开发者
  控件 —— 均已完整本地化为简体中文。
- **应用内语言切换。** 右下角的 **中文 / EN** 按钮可即时在英文与中文之间切换整个界面；
  你的选择会保存在浏览器中（`tokenfarm.lang`）。首次加载默认使用英文。
- **双语文档。** 本 README 与[更新日志](CHANGELOG.zh-CN.md)现已提供中文版本 ——
  [`README.zh-CN.md`](README.zh-CN.md) 与 [`CHANGELOG.zh-CN.md`](CHANGELOG.zh-CN.md)
  ，并在每个文件顶部相互链接。

## v0.2.0 新增

- **种子商店与库存**，新增三种作物 —— 胡萝卜 🥕、玉米 🌽 与南瓜 🎃，与小麦 🌾 并列。
  先购买种子，再从库存中种下已拥有的种子。
- **渐进升级曲线**（前期升级快、后期成本更高、无等级上限），以及单一权威的
  [`prices.json`](server/src/game/prices.json) 经济数据记录。
- **更聪明的初始设置** —— 分组的工作日选择器（工作日 / 周末 / 每天）与更友好的难度说明。
- **扩展的开发者模式**（`npm run dev`）—— 调整金币、经验、等级、作物生长、地块状态与
  天气；用于调校经济的模拟 token 流注入器；以及一个永不触碰真实存档的独立
  `~/.tokenfarm-dev` 沙盒。

完整清单请见 [v0.2.0 更新日志](CHANGELOG.zh-CN.md#020---2026-07-20)。

## v0.1.0 包含的内容

- 来自 Claude Code 与 Codex CLI/桌面端的并发本地采集。
- 按难度缩放的 token 转金币，并以整数金币展示。
- 工作时间天气、活动驱动的生长、枯萎、恢复与死亡。
- 种植与收获小麦、经验与等级、移除作物，以及通过 **+** 磁贴无限扩建田地。
- 首次启动设置、引导式教程，以及可重播的右下角版本徽章。
- 本地存档状态与采集偏移量的持久化。
- 开发与生产服务器、自动化检查、TypeScript 校验与生产构建。

完整功能清单作为新增工作记录在 [v0.1.0 更新日志](CHANGELOG.zh-CN.md#010---2026-07-17)。

## Token 用量如何变成金币

```text
Claude Code  ~/.claude/projects/**/*.jsonl ─┐
                                             ├─▶ TokenFarm 服务器 ──SSE──▶ 浏览器农场
Codex       ~/.codex/sessions/**/*.jsonl ────┘    tail → 金币 + 模拟
```

TokenFarm 只统计它运行期间被追加写入的记录。文件第一次被看到时会跳过已有的会话历史，而
持久化的字节偏移量可防止已消费的记录在重启后被重复奖励。

可计数的用量按各提供方归一化：

```text
Claude Code 货币 = input_tokens
                 + cache_creation_input_tokens
                 + output_tokens

Codex 货币       = input_tokens
                 + cache_write_input_tokens
                 + output_tokens
```

Claude 的 `cache_read_input_tokens` 不计入。Codex 只读取每轮的 `last_token_usage`；
累计总量与单独的推理总量不会叠加，缓存输入的元数据也不会被扣除。

可计数的 token 按所选难度换算：

```text
获得金币 = 可计数 token × 难度倍率 ÷ 100
```

简单为 ×1.5、普通为 ×1.0、困难为 ×0.5。小数部分的累积保留在存档状态中，界面则展示并花费
整数金币部分。

## 游戏循环

1. 在首次启动的初始设置中选择难度与工作时间表。
2. 在本地使用 Claude Code 或 Codex 工作，实时赚取金币。
3. 在种子商店中花费金币，然后把已拥有的种子种到田里 —— 或用 **+** 磁贴开垦新田地。
4. 在晴天的工作时间内保持助手活跃以让作物生长。枯萎的作物在活动恢复后可以复原。
5. 收获成熟作物获得经验，或移除枯萎和死亡的作物以复用它们的田地。

天气有两种状态：

- **☀️ 晴天：** 配置的工作时间。活跃的助手用量让作物生长；不活跃则推进枯萎计时。
- **🌧️ 雨天：** 非工作时间、周末，或手动屏蔽模式。作物受保护，既不生长也不衰减。

Token 是金币的唯一来源；收获奖励的是经验，而非金币。

## 商店与作物

**🛒 种子商店**将种子售入按作物分列的库存。用金币购买一个种子，然后把已拥有的种子种到空的
（已开垦）田地上 —— 种植从你的库存中扣除，而不会再次收取金币。每张商店卡片会显示种子的
价格、经验奖励、生长时间以及你的持有数量。

| 作物 | 金币 | 生长时间 | 收获经验 |
| --- | --- | --- | --- |
| 胡萝卜 🥕 | 500 | 15 分钟 | +5 |
| 小麦 🌾 | 1,500 | 30 分钟 | +10 |
| 玉米 🌽 | 2,500 | 30 分钟 | +12 |
| 南瓜 🎃 | 6,000 | 60 分钟 | +25 |

经验在收获时获得并驱动升级；它不是可花费的货币。以上所有数值都定义在
[`server/src/game/prices.json`](server/src/game/prices.json)（参见「配置」一节）。

## 环境要求

- Node.js 20 或更新版本，以及 npm。
- 至少一个受支持的本地编程助手：Claude Code 或本地 Codex CLI/桌面端的会话文件。

无需 API 密钥或账号集成。TokenFarm 仅读取本地的 JSONL 会话文件。

## 安装与运行

```bash
npm install
npm run dev
```

开发模式会同时启动两个进程：

| 进程 | 地址 | 用途 |
| --- | --- | --- |
| 游戏服务器 | http://localhost:8787 | 追踪助手日志、运行模拟，并提供 SSE 与操作接口 |
| Vite 界面 | http://localhost:5173 | 带开发代理的浏览器界面 |

打开 http://localhost:5173。在 VS Code 中，内置的 **Simple Browser: Show** 命令可以把
农场固定在编辑器窗格里、紧挨着终端。

若想快速观察完整的生长、枯萎与死亡周期：

```bash
TOKENFARM_FAST=1 npm run dev
```

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TOKENFARM_FAST` | 未设置 | 设为 `1` 可缩短活动、生长、枯萎与死亡计时。 |
| `TOKENFARM_DEV` | 未设置 | 设为 `1` 启用开发者模式。`npm run dev` 会自动设置它；`npm start` 不会。 |
| `TOKENFARM_PORT` | `8787` | 覆盖游戏服务器端口，例如在主实例旁运行第二个隔离实例。 |
| `TOKENFARM_STATE_DIR` | `~/.tokenfarm`（用户）· `~/.tokenfarm-dev`（开发） | 存放持久化 `state.json` 存档文件的目录。未设置时，开发者模式（`TOKENFARM_DEV=1`）使用独立的 `~/.tokenfarm-dev` 沙盒；设置此变量会覆盖两者。 |
| `TOKENFARM_CLAUDE_DIR` | `~/.claude/projects` | 包含 Claude Code 会话日志的根目录。 |
| `TOKENFARM_CODEX_DIR` | `$CODEX_HOME/sessions`，否则 `~/.codex/sessions` | 显式的 Codex rollout 根目录；此覆盖优先于两个默认值。 |

若 `TOKENFARM_CODEX_DIR` 未设置且已定义 `CODEX_HOME`，TokenFarm 会监听
`$CODEX_HOME/sessions`。

所有定价数值 —— 种子成本、开垦成本、金币换算除数、难度倍率、每级经验曲线，以及每种作物的
生长时间与经验奖励 —— 的权威记录都在
[`server/src/game/prices.json`](server/src/game/prices.json)；编辑这一个文件即可调校
经济。其余的计时常量（活动窗口、枯萎/死亡时钟）位于
[`server/src/game/config.ts`](server/src/game/config.ts)。

## 开发者模式

`npm run dev` 以**开发者模式**运行（它会设置 `TOKENFARM_DEV=1`）；`npm start` 以普通用户
模式运行。开发者模式增加了一些控件，便于在无需等待真实助手 token 活动的情况下测试游戏：

- **可调整的状态。** 直接编辑金币、经验与等级；覆盖天气（自动 / ☀️ 晴天 / 🌧️ 雨天）；
  并对每个已种植的地块，拖动生长百分比滑块（100% = 成熟）或强制其状态
  （生长 / 成熟 / 枯萎 / 死亡 / 空）。可编辑字段在实时刷新期间会保持焦点与你的输入。
- **模拟 token 流。** 左侧的一个框允许你输入 `input_tokens`、
  `cache_creation_input_tokens` 与 `output_tokens`；它会按当前换算除数与难度预览这段
  爆发会产出多少金币，而 **Inject** 按钮会把它送入真实的采集路径 —— 便于调校
  `conversionDivisor`。
- **重启。** 底部居中的**重启**按钮会清除所有进度并返回首次启动的初始设置。它会保留日志
  采集偏移量，因此重启不会把你的整段 token 历史重新读回成金币。

所有控件在用户模式下都隐藏，且服务器会拒绝其操作（返回 `dev-only`），除非设置了
`TOKENFARM_DEV=1`，因此 `npm start` 构建无法调用它们。

**独立存档配置。** 开发者模式使用自己的隔离存档目录 —— `~/.tokenfarm-dev` —— 而不是真实的
`~/.tokenfarm`。因此运行 `npm run dev`（及其重启 / 编辑）永远不会触碰你的真实游戏或其
token 采集进度：它保留自己的偏移量，所以下一次 `npm start` 仍会收集自上次用户会话以来的
每一个 token，包括开发会话期间到达的那些。`npm start` 永远不会创建或读取开发配置。
（`TOKENFARM_STATE_DIR` 会覆盖两者。）

## 教程与版本徽章

初始设置完成后，新玩家会获得对农场中每个 v0.1.0 功能的引导式导览。教程完成状态保存在浏览器
`localStorage` 的 `tokenfarm.tutorialVersion` 键下。

右下角的徽章显示 `v 0.2.1`。它的值来自 `package.json`，经由 Vite 的 `__APP_VERSION__`
构建常量，因此包与界面共享同一个版本来源。点击徽章可重播完整教程。

徽章旁边有一个 **中文 / EN** 按钮，可在英文与简体中文之间切换界面。该选择保存在浏览器
`localStorage` 的 `tokenfarm.lang` 键下（默认英文），并作用于整个界面，包括正在进行的
教程。

## 验证

```bash
npm test          # 记账、路径、天气、经济与实时追踪检查
npm run typecheck # TypeScript 校验
npm run build     # web-dist/ 中的生产浏览器包
```

实时追踪检查覆盖两个提供方、启动历史保护、不完整的行、格式错误的记录、新会话、截断恢复、
持久化偏移量与并发聚合。

## 生产环境

```bash
npm run build
npm start
```

服务器会在 http://localhost:8787 提供生成的 `web-dist/` 应用。

## 项目结构

```text
TokenFarm/
├── server/src/
│   ├── index.ts              HTTP、SSE、操作、静态文件与适配器启动
│   ├── sse.ts                SSE 客户端注册表与广播
│   ├── game/
│   │   ├── prices.json       权威定价记录（种子、开垦、经验曲线、作物）
│   │   ├── config.ts         加载 prices.json；经济、作物与计时
│   │   ├── engine.ts         金币采集、模拟与玩家操作
│   │   ├── state.ts          存档状态结构与原子 JSON 持久化
│   │   └── weather.ts        工作时间表与屏蔽模式天气
│   ├── ingest/
│   │   ├── types.ts          归一化的 token 事件与适配器接口
│   │   ├── jsonlTailer.ts    递归 JSONL 监听与字节偏移量
│   │   ├── claudeAdapter.ts  Claude Code 用量归一化
│   │   └── codexAdapter.ts   Codex rollout 用量归一化
│   └── test/run.ts           断言与实时追踪集成测试
├── web/
│   ├── index.html
│   └── src/
│       ├── api.ts            SSE 订阅与操作请求
│       ├── i18n.ts           英文/中文文案目录与语言切换
│       ├── main.ts           应用状态、交互与版本徽章
│       ├── render.ts         初始设置与农场标记
│       ├── tutorial.ts       版本化的引导式导览
│       └── style.css         农场、弹窗、徽章与教程样式
├── CHANGELOG.md              Keep a Changelog 风格的发布历史
├── package.json              脚本、依赖与发布版本
└── vite.config.ts            开发代理与生产构建
```

## 版本管理

TokenFarm 遵循[语义化版本](https://semver.org/)，并维护
[Keep a Changelog](https://keepachangelog.com/) 风格的历史。仓库当前完整的开发状态即为
初始的 `0.1.0` 发布。

在项目保持低于 1.0.0 期间：

- 次版本发布（`0.x.0`）新增面向玩家的功能，并为这些功能包含导览步骤。
- 补丁发布（`0.x.y`）包含修复或调校，不新增教程步骤。
- 版本 `1.0.0` 保留给功能完整的稳定发布。

## 当前限制

个人 Codex Cloud 任务不计入，因为其个人任务界面未暴露 TokenFarm 经济所需的精确每轮 token
用量。本地 Codex CLI/桌面端 rollout 受支持。

## 路线图

已推迟的想法包括作物与田地分级、化肥、电力、器具与自动化、枯萎作物的药物、完整的等级解锁树、
自动的方案额度检测、更多编程助手适配器、若有 API 可用则统计精确的个人云用量、作为多助手采集
层的 OpenTelemetry、更丰富的美术，以及专门的 VS Code 面板扩展。
