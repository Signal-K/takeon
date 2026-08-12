# TakeOn — agent notes

## Desk-first agent workflow

Desk is the sole project-management system for TakeOn. Before changing code, resolve the relevant Desk ticket or create one with `create_ticket`. During work, update it when scope, status, blockers, or decisions change. Before finishing, add implementation evidence and tests with `add_comment`, move it to the correct Desk status, attach useful file references with `attach_file_ref`, and include the Desk key in the commit subject or body. Never use Knowns, `.knowns`, Plate, or workspace ticket Markdown as a replacement for Desk ticket state. If no Desk key exists, stop before committing and create or resolve the ticket.

Isometric voxel rover game. npm workspaces monorepo + Go PocketBase spoke.

## Commands

```bash
npm install && npm run build      # engine → pixi → ui → editor → web (order matters)
npm test                          # engine + @takeon/ui unit tests (vitest)
npm run dev                       # Next.js dev server on :3400 (editor at /editor)
cd desktop && npm install && npm start   # optional Electron shell for the editor
cd pocketbase && TAKEON_ALLOW_ANON=true go run . serve --http 127.0.0.1:8094
node scripts/export-catalog.mjs   # regen pocketbase/seed/*.json after catalog edits
node scripts/fetch-dem.mjs        # embed real MOLA/LOLA DEM patches (needs trek.nasa.gov)
```

Runtime verification recipe: `.claude/skills/verify/SKILL.md`.

## Architecture rules

- **All gameplay rules live in `packages/engine/src/sim/` and `parts/`** —
  renderers and web UI only observe. The sim is deterministic, fixed 10 Hz.
- **Layers are enforced**: `util → world → sim → scene → render → input`, with
  `core` on top (`test/layering.test.ts` fails on an upward import). `scene/`
  flattens a frame into renderer-agnostic entities; `render/` has two views
  (`IsoRenderer`, `FlatRenderer`) behind the `SceneView` interface. Architecture
  overview: `docs/ENGINE.md`.
- **Entity art is componentised**: the rover is a list of registered parts
  (`render/rover.ts`, `registerRoverPart`), the 2D view has a painter per entity
  kind (`registerFlatPainter`). Add hardware as a part, not as more branches.
- **UI lives in `packages/ui` (`@takeon/ui`), never in `web/`.** Every
  component is registered by key via `createSlot` and resolved through
  `TakeOnUIProvider`, so a parent app (Landnam, the editor, the Next.js app)
  can replace/wrap/restyle any of them. Adding a component means adding a slot
  key + a `SLOT_KEYS` entry; `web/` stays a thin host. See `docs/UI.md`.
- **Authoring APIs belong in the engine, not the editor** — `world/authoring.ts`
  (draft/validate/field schema/export), `world/analysis.ts` (heightfield,
  slopes, reachability, stats) and `world/registry.ts` (runtime body registry)
  are pure and DOM-free so they stay testable and reusable. `@takeon/editor`
  is only a UI over them.
- Worlds regenerate deterministically from `(BodyDef, seed)`; persistence
  stores only voxel `edits` + entity state (`MissionState`). Never persist raw
  voxels. **Anything that changes generation output must be opt-in per body** —
  that is why `terrain.noise` exists; `test/noise.test.ts` asserts the shipped
  bodies stay byte-identical. Same rule for `terrain.biomes` (chunked biome
  skins, `world/biomes.ts`) and `world/kinds.ts` (planet/moon/asteroid/gaseous
  preset inheritance + `instantiateBody()` for host-supplied properties like
  real temperature) — both additive, both opt-in. `world/layers.ts` is the
  seam for a *module* to add a second world grid (caves, sky); core registers
  none, so mining stays top-down deposits + ice. See `docs/ENGINE.md`.
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
  Resolve destinations with `getBody`/`listBodies` (registry-aware), never by
  scanning `BODIES` — editor drafts and backend rows register at runtime.

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
- New `GameEvents` keys must be added to `GAME_EVENT_KEYS` (`types.ts`); a
  compile-time guard fails the build otherwise, and the UI firehose iterates it.
- `RoverGameOptions.startView` (not `view`) picks the initial renderer —
  `@takeon/pixi`'s mount options already use `view` for the host canvas.
- React packages build with `tsc`; stylesheets are copied by
  `scripts/copy-assets.mjs` (tsc ignores CSS). Their `exports` maps need a
  `default` condition or Next's webpack resolver rejects the package path.
- The iso painter's order is diagonal (`x+y` asc, then z asc); dynamic entities
  are drawn after chunk blits and occluders re-stamped
  (`renderer.redrawOccluders`) — don't reorder without checking cliffs.

## Documentation & Decisions: Craft, Desk, ZenNotes

As of 2026-07-21, this is the canonical split for where writing lives, monorepo-wide (see `~/Navigation/CLAUDE.md`):

- **Craft** — long-form writing: planning docs, ideation, proposals, spec drafts, research notes. Every Craft doc tied to active Takeon work must be **tagged** and **attached to its Desk ticket(s)/story** (`attach_craft_doc`).
- **ZenNotes** (`~/Navigation/workspace`, ZenNotes MCP) — canonical home for **decisions and rules**: finalized specs, feature definitions and their limits, design decisions. Search here first for authoritative rules.
- **Desk** (MCP server `desk`, `projectId: "project-takeon"` if registered) — tickets/stories/epics; system of record for ticket state.

Flow: research/ideation in Craft → tag + attach to the Desk ticket once it needs review or action → once a decision lands, write the durable rule/spec into ZenNotes, not just a Craft doc or ticket comment.
