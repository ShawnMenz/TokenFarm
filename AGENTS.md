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
- Keep public setup and behavior documentation in `README.md` and release history
  in `CHANGELOG.md`.
