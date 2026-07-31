# Adapting the UI (`@takeon/ui`)

TakeOn's HUD is a React package, and **every component in it is replaceable by
the app that sits on top of TakeOn**. A game built on the module — Landnam, or
anything else in the Star Sailors ecosystem — can keep the parts it likes,
restyle the parts it doesn't, and swap out whole panels, without forking this
repo.

Two pieces make that work:

- **`MissionProvider`** owns a running mission: engine lifecycle, a React-shaped
  HUD snapshot, toasts, autosave and the player actions. It contains no styling
  and no routing.
- **`TakeOnUIProvider`** is a registry. Every built-in component is registered
  under a key and looked up at render time, so overriding a key replaces that
  component everywhere it appears — including inside components you did not
  override.

```tsx
import { MissionProvider, MissionScreen, TakeOnUIProvider } from '@takeon/ui';
import '@takeon/ui/styles.css';

<TakeOnUIProvider
  components={{ ActionBar: MyActionBar }}     // replace a component
  labels={{ 'action.mine': 'Dig' }}           // reskin the words
  classNames={{ HudBar: 'my-hud' }}           // restyle in place
  slots={{ 'hudBar.end': <MyQuestChip /> }}   // inject extra chrome
  theme={{ accent: '#ff8a3d' }}               // recolour via CSS variables
>
  <MissionProvider body={body} spec={spec} sync={myAdapter}>
    <MissionScreen />
  </MissionProvider>
</TakeOnUIProvider>;
```

Or the one-liner, which wires all three together:

```tsx
<TakeOnMission body={body} spec={spec} sync={myAdapter} ui={{ ... }} />
```

## The four levers, cheapest first

### 1. `theme` — CSS variables

Every colour, radius and font in the stock skin comes from a `--tk-*` custom
property: `bg`, `panel`, `panel-soft`, `border`, `text`, `text-dim`, `accent`,
`accent-2`, `good`, `warn`, `bad`, `radius`, `font`. Setting them re-skins the
whole HUD without overriding a single rule (they can also be set in plain CSS
on any ancestor).

### 2. `labels` — strings and icons

Every user-visible string is looked up by key with the built-in text as
fallback: `action.mine`, `action.build`, `hud.battery`, `hud.end`, `tile.drive`,
`end.confirm`, `common.close`, and so on. Useful for tone ("Dig", "Salvage"),
localisation, or matching your game's vocabulary.

### 3. `classNames` and `slots` — extend without replacing

`classNames` appends classes to a component's root element, keyed by slot name.
`slots` injects content at named anchors:

`hudBar.start`, `hudBar.end`, `actionBar.start`, `actionBar.end`,
`tileMenu.end`, `mission.overlay` (exported as `SLOT_ANCHORS`).

### 4. `components` — replace outright

Keys (exported as `SLOT_KEYS`):

| Key | What it is |
|---|---|
| `MissionScreen` | The whole layout |
| `MissionCanvas` | The render surface (mounting it boots the engine) |
| `HudBar` | Top status strip |
| `DPad` | Touch drive pad |
| `ActionBar` | Mine / photo / scan / build / craft / place / repair / deposit / hold |
| `Minimap` | Corner map |
| `TileMenu` | Tap-a-tile context menu |
| `BuildPanel`, `CraftPanel`, `CargoPanel`, `EndMissionDialog` | Modal panels |
| `ToastStack` | Event feedback |
| `Meter`, `Modal`, `Chip` | Shared primitives — override these to restyle everything at once |

An override receives the same props as the default and can render the default
to *wrap* rather than replace it:

```tsx
import { HudBar, useMission } from '@takeon/ui';

function MyHudBar(props) {
  const { hud } = useMission();
  return (
    <>
      <HudBar.Default {...props} />
      <MyOxygenGauge value={hud?.battery ?? 0} />
    </>
  );
}
```

Rendering `<HudBar/>` (not `.Default`) from inside its own override is safe too:
the registry suppresses the override one level deep instead of recursing.

## Building a completely custom HUD

Drop the stock screen and use the hooks. The provider still handles the engine
loop, persistence and toasts:

```tsx
import { MissionProvider, MissionCanvas, useMission } from '@takeon/ui';

function MyHud() {
  const { hud, actions, setPanel } = useMission();
  if (!hud) return null;
  return (
    <div className="my-hud">
      <Battery value={hud.battery} max={hud.batteryMax} />
      <button onClick={actions.mine} disabled={!hud.can.mine}>Mine</button>
      <button onClick={() => setPanel('build')}>Build</button>
    </div>
  );
}

<MissionProvider body={body} spec={spec} sync={sync}>
  <MissionCanvas />
  <MyHud />
</MissionProvider>;
```

`useMission()` gives you `hud` (battery, durability, cargo, banked yield,
daylight, weather, position, anomaly counts, capabilities, current order),
`actions` (every player verb, including `save` and `endMission`), panel and
tile-menu state, the live `RoverGame`, and the toast queue.

For a HUD outside a mission (shared chrome that renders on any screen), use
`useMissionMaybe()`, which returns `null` instead of throwing.

## Hooking into the game

`MissionProvider` props cover the integration points a host game needs:

| Prop | Purpose |
|---|---|
| `sync` | A `SyncAdapter` — autosave, photo upload, discovery recording and mission payout all route through it |
| `onSave`, `onEnd`, `onPhoto`, `onDiscovery` | Callbacks if you'd rather persist yourself |
| `onEvent` | Firehose of **every** engine event (`GAME_EVENT_KEYS`) for quests, XP and analytics |
| `onReady` | The `RoverGame` instance, for anything the wrapper doesn't expose |
| `toasts`, `audio`, `controls`, `autosaveMs`, `hudIntervalMs` | Turn built-in behaviour off when the host provides its own |

The provider deliberately does **no data loading**: the host resolves which
world and rover to run (from a route, a database, a quest) and hands them in.
See `web/app/mission/page.tsx` — the standalone app is itself just a host, and
uses no private API.

## Where the rules stay

Overriding UI never changes gameplay. All rules live in
`packages/engine/src/sim/` and `parts/`; components only observe state and call
actions. A game that replaces every component still plays identical missions —
which is the point of the split.
