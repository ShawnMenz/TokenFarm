# 🛠️ TokenFarm 开发指南

[English](DEVELOPMENT.md) | **简体中文**

本指南介绍如何从源码运行 TokenFarm、配置、开发者模式、测试以及项目结构。游戏介绍与玩法请见
[README](README.zh-CN.md)；发布历史请见[更新日志](CHANGELOG.zh-CN.md)。

## 环境准备

TokenFarm 需要 Node.js 20 或更新版本。

```bash
npm ci
```

## 开发模式

```bash
npm run dev
```

这会同时启动两个进程：

| 进程 | 地址 | 用途 |
| --- | --- | --- |
| 游戏服务器 | http://localhost:8787 | 追踪助手日志、运行模拟，并提供 SSE 与操作接口 |
| Vite 界面 | http://localhost:5173 | 带开发代理的浏览器界面 |

打开 http://localhost:5173。若想在几秒内（而不是几小时）观察完整的生长、枯萎与死亡周期：

```bash
TOKENFARM_FAST=1 npm run dev
```

## 生产构建

```bash
npm run build
npm start
```

服务器会在 http://localhost:8787 提供生成的 `web-dist/` 应用。

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TOKENFARM_FAST` | 未设置 | 设为 `1` 可缩短活动、生长、枯萎与死亡计时。 |
| `TOKENFARM_DEV` | 未设置 | 设为 `1` 启用[开发者模式](#开发者模式)。`npm run dev` 会自动设置它；`npm start` 不会。 |
| `TOKENFARM_PORT` | `8787` | 覆盖游戏服务器端口，例如在主实例旁运行第二个隔离实例。 |
| `TOKENFARM_STATE_DIR` | `~/.tokenfarm`（用户）· `~/.tokenfarm-dev`（开发） | 存放持久化 `state.json` 存档文件的目录。未设置时，开发者模式（`TOKENFARM_DEV=1`）使用独立的 `~/.tokenfarm-dev` 沙盒；设置此变量会覆盖两者。 |
| `TOKENFARM_CLAUDE_DIR` | `~/.claude/projects` | 包含 Claude Code 会话日志的根目录。 |
| `TOKENFARM_CODEX_DIR` | `$CODEX_HOME/sessions`，否则 `~/.codex/sessions` | 显式的 Codex rollout 根目录；此覆盖优先于两个默认值。 |

若 `TOKENFARM_CODEX_DIR` 未设置且已定义 `CODEX_HOME`，TokenFarm 会监听
`$CODEX_HOME/sessions`。

所有定价数值 —— 种子成本、开垦成本、金币换算除数、难度倍率、每级经验曲线、每种作物的生长
时间、经验奖励、解锁等级与最低田地等级，以及农资、田地等级、电力和工具 —— 的权威记录都在
[`server/src/game/prices.json`](server/src/game/prices.json)；编辑这一个文件即可调校
经济。其余的计时常量（活动窗口、枯萎/死亡时钟、5 小时的额度保护兜底时长）位于
[`server/src/game/config.ts`](server/src/game/config.ts)。

## 开发者模式

`npm run dev` 以**开发者模式**运行（它会设置 `TOKENFARM_DEV=1`）；`npm start` 以普通用户
模式运行。开发者模式增加了一些控件，便于在无需等待真实助手 token 活动的情况下测试游戏：

- **可调整的状态。** 直接编辑金币、经验与等级；覆盖天气（自动 / ☀️ 晴天 / 🌧️ 雨天）；
  并对每个已种植的地块，拖动生长百分比滑块（100% = 成熟）或强制其状态
  （生长 / 成熟 / 枯萎 / 死亡 / 空）。可编辑字段在实时刷新期间会保持焦点与你的输入。
- **模拟 token 流。** 左侧的一个框允许你输入 `input_tokens`、
  `cache_creation_input_tokens` 与 `output_tokens`；它会按当前换算除数与难度预览这段
  爆发会产出多少金币，而 **注入** 按钮会把它送入真实的采集路径 —— 便于调校
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

## 验证

完成修改前请运行：

```bash
npm test          # 记账、路径、天气、经济、升级、自动化、额度、存档迁移与实时追踪检查
npm run typecheck # TypeScript 校验
npm run build     # web-dist/ 中的生产浏览器包
```

实时追踪检查覆盖两个提供方、启动历史保护、不完整的行、格式错误的记录、新会话、截断恢复、
持久化偏移量、并发聚合以及额度记录。旧版本的存档会在加载时自动升级，这一迁移同样有测试。

## 项目结构

```text
TokenFarm/
├── server/src/
│   ├── index.ts              HTTP、SSE、操作、静态文件与适配器启动
│   ├── sse.ts                SSE 客户端注册表与广播
│   ├── game/
│   │   ├── prices.json       权威定价记录（作物、农资、田地等级、工具、经验曲线）
│   │   ├── config.ts         加载 prices.json；经济、目录、解锁与计时
│   │   ├── engine.ts         金币采集、模拟、自动化与玩家操作
│   │   ├── state.ts          存档状态结构、迁移与原子 JSON 持久化
│   │   └── weather.ts        工作时间表与屏蔽模式天气
│   ├── ingest/
│   │   ├── types.ts          归一化的 token/额度事件与适配器接口
│   │   ├── jsonlTailer.ts    递归 JSONL 监听与字节偏移量
│   │   ├── claudeAdapter.ts  Claude Code 用量归一化
│   │   ├── codexAdapter.ts   Codex rollout 用量归一化
│   │   └── limits.ts         两个助手的额度检测
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
├── README.md                 项目介绍、快速开始与游戏指南
├── DEVELOPMENT.md            本指南
├── CHANGELOG.md              Keep a Changelog 风格的发布历史
├── package.json              脚本、依赖与发布版本
└── vite.config.ts            开发代理与生产构建
```

每个面向用户的文档都有对应的简体中文版本（`*.zh-CN.md`），每条界面文案都在
`web/src/i18n.ts` 中同时提供英文与中文。

## 版本管理

TokenFarm 遵循[语义化版本](https://semver.org/)，并在[更新日志](CHANGELOG.zh-CN.md)中
维护 [Keep a Changelog](https://keepachangelog.com/) 风格的历史。在项目保持低于 1.0.0
期间：

- 次版本发布（`0.x.0`）新增面向玩家的功能，并为这些功能包含导览步骤。
- 补丁发布（`0.x.y`）包含修复或调校，不新增教程步骤。
- 版本 `1.0.0` 保留给功能完整的稳定发布。

游戏内的版本徽章经由 Vite 的 `__APP_VERSION__` 构建常量读取 `package.json`，因此包与界面
共享同一个版本来源。

## 路线图

已推迟的想法包括更多编程助手适配器、若有 API 可用则统计精确的个人云用量、作为多助手采集层的
OpenTelemetry、更丰富的美术，以及专门的 VS Code 面板扩展。
