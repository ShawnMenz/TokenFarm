# TokenFarm

## Development

- Requires Node.js 20 or newer.
- Install dependencies with `npm ci`.
- Before completing a change, run `npm test`, `npm run typecheck`, and
  `npm run build`.

## Project shape

- `server/src/` owns local log ingestion, game state, simulation, HTTP, and SSE.
- `web/src/` owns the browser interface and user interactions.
- Preserve this server/web boundary unless a change explicitly requires a new
  shared interface.

## Local planning

- `.scratch/` is an intentionally ignored local workspace for specs and plans.
- Use one feature directory per effort and keep its primary spec in
  `.scratch/<feature>/spec.md`.
- Do not rely on local planning files as public documentation.

## Repository hygiene

- Never commit local Claude or Codex logs, `.env` files, TokenFarm state,
  Playwright artifacts, generated `web-dist/` output, or dependencies.
- Keep the project introduction, quick start, and game guide in `README.md`;
  configuration, developer mode, tests, and project structure in `DEVELOPMENT.md`;
  and release history in `CHANGELOG.md`. The README links to the other two and never
  carries release notes. Each has a `*.zh-CN.md` counterpart kept in step.
