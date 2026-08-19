# TakeOn Atlas

A deliberately small, static frontend for exploring TakeOn as the shared field
layer of Star Sailors. It is not a second player app: the demo is a local
engine mount, while the other routes make the host-game boundary visible.

## Routes

- `/demo` — local Mars rover mission using `@takeon/engine`.
- `/ecosystem` — host roles across Landnam, Atlas, Saily and shared services.
- `/landnam` — the Landnam command-deck → TakeOn field-sandbox handoff.
- `/language` — how UI density and visual language shift as TakeOn usage grows.

The demo loop is created only on `/demo` and disposed on route change. There
is no account, network request, remote save, analytics SDK or always-running
background process.

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
