# Verify TakeOn

How to build, run and drive this repo for runtime verification.

## Build & launch

```bash
npm install                       # workspace root
npm run build                     # engine → pixi → ui → editor → web (order matters)
cd web && npm run start &         # serves on http://127.0.0.1:3400
```

Individual packages: `npm run build -w @takeon/engine`, `-w @takeon/ui`,
`-w @takeon/editor`, `-w takeon-web`. The engine must build before the rest.

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
- Playwright: launch Chromium with
  `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
  (check the versioned directory name — the unversioned `chromium/` path has no
  binary in it).
- HUD markup comes from `@takeon/ui` and is `tk-` prefixed; editor markup comes
  from `@takeon/editor` and is `tke-` prefixed. Site chrome (garage, customiser,
  launch) still uses the plain classes in `web/app/globals.css`.

## Flows worth driving (Playwright)

1. `/customize` → fill `input[aria-label="Rover name"]`, click part options
   (`.part-option:has-text("Field Lab")` etc. — module options *toggle*, so
   clicking "Sample Scoop"/"NavCam" removes the defaults), then `button.primary`
   (label is "Buy rover & pick target"); it routes to `/launch?rover=<id>`.
2. `/launch` → `.card:has-text("The Moon") button.primary` → lands on `/mission`.
   Launch needs the `?rover=` param; visiting it bare shows "Pick a rover first".
3. Mission: wait `.tk-hudbar .tk-meter` (power/hull/hold gauges); canvas is
   `.tk-canvas`. Click the canvas for the tile menu (`.tk-tilemenu`, with
   "Drive here" / "Mine …"), or use `.tk-dpad button[aria-label^="Drive"]`.
   Action buttons are the hex cells `.tk-action:has-text("Mine")` etc. —
   Photo/Scan only render when the rover carries those modules. Modals close
   via `.tk-modal-close` or the footer `button:has-text("Close")`.
4. Mining yield appears as `.tk-toast-good` with `+N <resource>`; cargo meter is
   the 3rd `.tk-hudbar .tk-meter`; `.tk-action:has-text("Hold")` opens the cargo
   table (`.tk-table tbody tr`).
5. Resume: go `/` — active mission card has `button:has-text("Resume mission")`;
   cargo must survive the round-trip.
6. End: `.tk-hudbar button:has-text("End")` → modal → `.tk-btn-primary` → back
   on `/` with the credits chip updated.
7. Canvas paint check: sample `getImageData` for >10 distinct colors. The iso
   view paints ~1000 distinct colours at 1600×1000; the flat map ~100+.
8. Views: `.tk-hudbar button[title*="2D map"]` switches to the top-down map
   (`game.view === 'flat'`), the same button (`title*="3D diorama"`) switches
   back. Tile picking, tap-to-drive and the tile menu work in both.

### Editor (`/editor`)

Layout is one grid of uniform `.tke-card`s (Scene 2×2, Inspector, Maps,
Analysis, Rover, then Destinations and Events spanning 2) — no sidebars, no
tab-switching between Maps/Analysis/Rover. Chrome is light by default.

1. Wait for `.tke-toolbar`. `.tke-list-item` lists 6 built-in destinations;
   `.tke-field` are inspector rows; `.tke-status` shows `96² · N ms`.
2. Drag a terrain slider (`.tke-group:has-text("Terrain") input[type="range"]`)
   → the world regenerates (status ms changes) and the entry gets an
   `.tke-badge` reading "edited". Undo is `button[title^="Undo"]`.
3. Maps: `.tke-tab:has-text("Slope"|"Surface"|"Ore density"|"Drivable"|"Noise")`
   then sample `.tke-map` with `getImageData` (each view should paint several
   distinct colours). `.tke-slice` is the cross-section.
4. Analysis card: `.tke-stat` tiles (Columns, Height, Relief, Drivable, Cliffs,
   Landing) — visible without switching views.
5. Play mode: `.tke-primary:has-text("Play")` mounts the real HUD inside the
   scene card (`.tk-hudbar .tk-meter` = 3). Drive with the d-pad; engine events
   land in `.tke-console-line`. `.tke-primary:has-text("Stop")` returns.
6. Scene view is `.tke-scene` (drag to pan, wheel to zoom, R rotates).
   `.tke-viewport-bar button:has-text("3D")` switches it to the 2D map (the
   button then reads "2D"); the card hint says which is live.
9. Noise: the inspector has a *Noise field* group (7 fields). Setting type +
   fractal regenerates the world, and the Maps `Noise` tab previews the exact
   field with a caption from `describeNoise`; `Scatter` previews blue-noise
   placement.
7. Theme toggle: `.tke-toolbar button[title*="dark chrome"]` / `[title*="light
   chrome"]`, persisted in `localStorage` under `takeon.editor.theme`.
8. Layout check worth keeping: every `.tke-card-head` should measure the same
   height, and standard cards the same width/height, at any viewport.

Bennu (irregular asteroid) needs a fuel tank module; good probe for void-edge
terrain. Mobile: 390x760 viewport, d-pad `.tk-dpad button[aria-label^="Drive"]`.
