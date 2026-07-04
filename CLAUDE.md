# TakeOn — agent notes

Isometric voxel rover game. npm workspaces monorepo + Go PocketBase spoke.

## Commands

```bash
npm install && npm run build      # builds engine → pixi adapter → web (order matters)
npm test                          # engine unit tests (vitest)
npm run dev                       # Next.js dev server on :3400
cd pocketbase && TAKEON_ALLOW_ANON=true go run . serve --http 127.0.0.1:8094
node scripts/export-catalog.mjs   # regen pocketbase/seed/*.json after catalog edits
```

Runtime verification recipe: `.claude/skills/verify/SKILL.md`.

## Architecture rules

- **All gameplay rules live in `packages/engine/src/sim/` and `parts/`** —
  renderer and web UI only observe. The sim is deterministic, fixed 10 Hz.
- Worlds regenerate deterministically from `(BodyDef, seed)`; persistence
  stores only voxel `edits` + entity state (`MissionState`). Never persist raw
  voxels.
- The engine has **zero runtime dependencies** and must keep working without
  DOM access for tests (canvas bits are guarded; `OffscreenCanvas` fallback).
- Web ↔ storage goes through `SyncAdapter` (`net/sync.ts`) only. The web app
  must stay fully playable with `LocalSync` (no backend).
- Economy constants are duplicated by design: `packages/engine/src/net/sync.ts`
  (`RESOURCE_VALUE`, `STARTING_CREDITS`, `DISCOVERY_CREDITS`) ⇄
  `pocketbase/routes.go`. Change both or the server will disagree with the UI.
- Part/body catalogs: source of truth is the engine
  (`parts/catalog.ts`, `world/bodies.ts`); `scripts/export-catalog.mjs` exports
  them to `pocketbase/seed/` which the Go backend embeds + upserts on serve.

## PocketBase spoke conventions (Star Sailors ecosystem)

- Identity lives on the **shared** backend; this spoke verifies JWTs by
  delegating to `SHARED_PB_URL /api/collections/users/auth-refresh`
  (`auth.go`, 5-min cache). `TAKEON_ALLOW_ANON=true` for dev.
- Collections are created by **JS migrations** in `pb_migrations/` (Landnam
  convention), stay superuser-locked, and are accessed only via the custom
  `/api/takeon/*` routes in `routes.go`.
- Cross-posting discoveries to other spokes: `hooks.go` —
  `OnRecordAfterCreateSuccess("takeon_discoveries")`, direct HTTP POST with
  `X-Internal-Api-Key`, idempotency key `userId:anomalyId`. No queue/bus.

## Gotchas

- `pkill -f next-server` kills your own shell (self-match) — use
  `pkill -f 'next[-]server'`; always restart `next start` after rebuilding.
- Engine tsconfig uses `moduleResolution: bundler` with `.js` import suffixes;
  keep both or Next/tsc will disagree.
- The iso painter's order is diagonal (`x+y` asc, then z asc); dynamic entities
  are drawn after chunk blits and occluders re-stamped
  (`renderer.redrawOccluders`) — don't reorder without checking cliffs.
