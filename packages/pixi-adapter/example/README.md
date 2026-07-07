# @takeon/pixi examples

## `mock-mount.mjs`

Proves the mount contract with a **mock** Pixi namespace — no real Pixi, no
WebGL. It mounts a mission, pumps the ticker by hand, checks the sprite is on
the stage and the texture refreshes each frame, then tears down and verifies
everything is released.

It needs a DOM, so run it in a browser:

```bash
npx esbuild packages/pixi-adapter/example/mock-mount.mjs --bundle --format=iife --outfile=/tmp/mount.js
# inline /tmp/mount.js into a minimal <html><body><script>…</script></body></html> and open it
# console prints: "MOUNT OK { updates: 10 }" then "TEARDOWN OK"
```

In a real app you pass `import * as PIXI from 'pixi.js'`, `app.stage`,
`app.ticker` and `app.canvas` instead of the mocks — see `docs/INTEGRATION.md`.
