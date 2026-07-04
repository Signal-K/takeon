# Verify TakeOn

How to build, run and drive this repo for runtime verification.

## Build & launch

```bash
npm install                       # workspace root
npm run build -w @takeon/engine   # engine must build before web
npm run build -w takeon-web
cd web && npm run start &         # serves on http://127.0.0.1:3400
```

Backend (optional — the web app falls back to localStorage without it):

```bash
cd pocketbase
TAKEON_ALLOW_ANON=true go run . serve --http 127.0.0.1:8094
curl http://127.0.0.1:8094/api/takeon/health
```

To point the web app at it, set `NEXT_PUBLIC_TAKEON_PB_URL=http://127.0.0.1:8094`
before `next build` (env is inlined at build time).

## Gotchas

- `pkill -f next-server` **matches your own shell's command line** and kills
  it (exit 144). Use `pkill -f 'next[-]server'`.
- Rebuilding `.next` while an old `next start` is running serves stale chunk
  hashes (404/400 on `_next/static`). Always kill + restart after rebuild.
- Playwright: launch Chromium with `executablePath: '/opt/pw-browsers/chromium'`.

## Flows worth driving (Playwright)

1. `/customize` → fill `input[aria-label="Rover name"]`, click part options
   (`.part-option:has-text("Field Lab")` etc.), click `button.primary:has-text("Buy rover")`.
   Full science build (Field Lab + Scoop + NavCam + Sounder) costs 1540 of
   1600 starting credits.
2. `/launch` → `.card:has-text("The Moon") button.primary` → lands on `/mission`.
3. Mission: wait `.hud-top .meter`; canvas is `.mission-canvas`. Click canvas
   to focus, then Arrow keys drive. Action buttons: `.action-btn:has-text("Mine")`
   etc. — Photo/Scan only render when the rover has those modules.
4. Mining yield appears as `.toast.good` with `+N <resource>`; cargo meter is
   the 3rd `.hud-top .meter`.
5. Resume: go `/` — active mission card has `button:has-text("Resume mission")`;
   cargo must survive the round-trip.
6. End: `.hud-top button:has-text("End")` → modal → `button.primary` → back on
   `/` with credits chip updated.
7. Canvas paint check: sample `getImageData` for >10 distinct colors.

Bennu (irregular asteroid) needs a fuel tank module; good probe for void-edge
terrain. Mobile: 390x760 viewport, d-pad `.dpad button[aria-label^="Drive"]`.
