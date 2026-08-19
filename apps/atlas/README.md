# TakeOn Atlas

A deliberately small, static frontend for exploring TakeOn as the shared field
layer of Star Sailors. It is not a second player app: the demo is a local
engine mount, while the other routes make the host-game boundary visible.

## Routes

- `/demo` — the small, local Mars baseline using `@takeon/engine`.
- `/demos` — entry point for the three runnable host-specific scenes.
- `/demos/landnam` — Shackleton Rim surface operations: a lunar Prospector,
  programme-to-field language, and a Landnam-specific hotbar.
- `/demos/atlas` — a Mallee dark-sky station: an instrument carrier and an
  observing-protocol hotbar, without replacing Atlas's sky-map UI.
- `/demos/saily` — Cloudspotting Mars context: a compact evidence scene that
  returns to Saily's daily game loop.
- `/field/:host` — a dedicated full-window version of each host scene; the
  demo pages open it in a new tab.
- `/ecosystem` — host roles across Landnam, Atlas, Saily and shared services.
- `/landnam` — the Landnam command-deck → TakeOn field-sandbox handoff.
- `/language` — how UI density and visual language shift as TakeOn usage grows.

The demo loop is created only on `/demo` and disposed on route change. There
is no account, network request, remote save, analytics SDK or always-running
background process.

Tap-to-route uses the engine's safe local route planner: it avoids both climbs
the rover cannot make and drops that would damage it. Use **Set route** then
tap multiple terrain points to define waypoints; each leg is checked locally.
Arrow keys/WASD and standard gamepads work on every scene (left stick/D-pad to
drive; A mine, B scan, X photo). The reset/return control starts a fresh,
deterministic field session without reloading the site.

## Local development

```bash
npm run atlas
npm run atlas:build
```

## Cloudflare deployment

`wrangler.jsonc` deploys Vite's `dist/` as a Cloudflare static-assets SPA;
unknown navigation routes return `index.html` and are resolved client-side.

```bash
npm run deploy -w @takeon/atlas
```

Use `npm run deploy:dry-run -w @takeon/atlas` to validate a release without
publishing. Deployment requires the operator's existing Wrangler login; this
repository stores no Cloudflare credential.
