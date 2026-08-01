import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createRoverGame,
  GAME_EVENT_KEYS,
  RESOURCE_NAMES,
  STRUCTURES,
  WEATHER_INFO,
  type ActiveWeather,
  type Anomaly,
  type BodyDef,
  type GameEventKey,
  type GameEvents,
  type MissionState,
  type PhotoMeta,
  type ResourceKey,
  type RoverGame,
  type RoverOrder,
  type RoverSpec,
  type StructureType,
  type SyncAdapter,
  type Vec2,
  type ViewKind,
} from '@takeon/engine';

/**
 * Owns one running mission: it boots the engine against a canvas, keeps a
 * React-friendly snapshot of the rover state, routes engine events to toasts
 * and persistence, and exposes the player actions.
 *
 * The provider is deliberately free of routing, data loading and styling —
 * a host loads the `MissionState` it wants resumed and hands it in, so the
 * same provider works in the Next.js app, in the editor's play mode and
 * inside another game's screen.
 */

export type ToastKind = 'info' | 'warn' | 'good' | 'bad';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface MissionHud {
  /** Game seconds since landing. */
  time: number;
  battery: number;
  batteryMax: number;
  durability: number;
  durabilityMax: number;
  fuel: number;
  fuelMax: number;
  cargo: Partial<Record<ResourceKey, number>>;
  cargoUsed: number;
  cargoMax: number;
  banked: Partial<Record<ResourceKey, number>>;
  /** 0 = night, 1 = noon. */
  daylight: number;
  weather: { type: ActiveWeather['type']; name: string; icon: string; intensity: number } | null;
  status: MissionState['status'];
  pos: Vec2;
  facing: 0 | 1 | 2 | 3;
  /** Which action buttons the fitted parts support. */
  can: { mine: boolean; photo: boolean; scan: boolean };
  mobility: number;
  /** Which renderer is live: the iso diorama or the flat 2D map. */
  view: ViewKind;
  structures: number;
  anomalies: { total: number; scanned: number; documented: number };
  order: RoverOrder | null;
}

export type MissionPanel = 'build' | 'craft' | 'end' | 'cargo' | null;

export interface TileMenuTarget {
  tile: Vec2;
  /** Canvas-space position of the tap, for placing the menu. */
  x: number;
  y: number;
}

export interface MissionActions {
  move(dir: 0 | 1 | 2 | 3): void;
  walkTo(x: number, y: number): void;
  orderMine(x: number, y: number): void;
  cancelOrder(): void;
  mine(): void;
  photo(): void;
  scan(): void;
  build(type: StructureType): void;
  craft(recipeId: string): void;
  placeBlock(): void;
  repair(): void;
  deposit(): void;
  launchCargo(): void;
  upgradeMobility(): void;
  rotateView(): void;
  /** Switch renderer: 'iso' diorama or 'flat' top-down map. */
  setView(view: ViewKind): void;
  /** Flip between the two built-in views; returns the new one. */
  toggleView(): ViewKind;
  centreCamera(): void;
  demolish(id: string): void;
  rotateStructure(id: string): void;
  /** Persist immediately (also runs on autosave and on tab hide). */
  save(): Promise<void>;
  /** Bank the yield and finish. Resolves with the credits awarded. */
  endMission(): Promise<number>;
}

export interface MissionContextValue {
  game: RoverGame | null;
  body: BodyDef;
  spec: RoverSpec;
  hud: MissionHud | null;
  status: 'booting' | 'running' | 'ended' | 'error';
  error: string | null;
  toasts: Toast[];
  pushToast(text: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
  actions: MissionActions;
  /** Attach the render surface; `MissionCanvas` does this for you. */
  attachCanvas(el: HTMLCanvasElement | null): void;
  canvas: HTMLCanvasElement | null;
  panel: MissionPanel;
  setPanel(panel: MissionPanel): void;
  tileMenu: TileMenuTarget | null;
  setTileMenu(target: TileMenuTarget | null): void;
  minimapVisible: boolean;
  setMinimapVisible(visible: boolean): void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

export interface MissionProviderProps {
  body: BodyDef;
  spec: RoverSpec;
  seed?: number;
  /** A previously serialised mission to continue. */
  resume?: MissionState;
  /** Persistence. Omit for a throwaway session (editor play mode). */
  sync?: SyncAdapter;
  /** Autosave period in ms; 0 disables. Default 20000. */
  autosaveMs?: number;
  /** HUD sampling period in ms. Default 250. */
  hudIntervalMs?: number;
  /** Built-in keyboard/touch controls. Default true. */
  controls?: boolean;
  /** Synthesised audio. Default true. */
  audio?: boolean;
  /** Built-in event toasts. Default true. */
  toasts?: boolean;
  /** Which renderer to open in. Default the isometric diorama. */
  view?: ViewKind;
  onReady?(game: RoverGame): void;
  onPhoto?(dataUrl: string | null, meta: PhotoMeta): void;
  onSave?(state: MissionState): void | Promise<void>;
  onDiscovery?(anomaly: Anomaly): void;
  onEnd?(result: { state: MissionState; credits: number; banked: Partial<Record<ResourceKey, number>> }): void;
  onError?(message: string): void;
  /** Firehose of engine events, for host analytics/quests. */
  onEvent?<K extends GameEventKey>(key: K, payload: GameEvents[K]): void;
  children: ReactNode;
}

let toastSeq = 0;

export function MissionProvider(props: MissionProviderProps) {
  const {
    body,
    spec,
    seed,
    resume,
    sync,
    autosaveMs = 20000,
    hudIntervalMs = 250,
    controls = true,
    audio = true,
    toasts: toastsEnabled = true,
    view,
    children,
  } = props;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [game, setGame] = useState<RoverGame | null>(null);
  const [hud, setHud] = useState<MissionHud | null>(null);
  const [status, setStatus] = useState<MissionContextValue['status']>('booting');
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [panel, setPanel] = useState<MissionPanel>(null);
  const [tileMenu, setTileMenu] = useState<TileMenuTarget | null>(null);
  const [minimapVisible, setMinimapVisible] = useState(true);

  const gameRef = useRef<RoverGame | null>(null);
  // Callbacks live in a ref so re-renders never restart the mission.
  const cb = useRef(props);
  cb.current = props;

  const pushToast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      if (toastsEnabled) pushToast(text, kind);
    },
    [pushToast, toastsEnabled],
  );

  useEffect(() => {
    if (!canvas) return;
    let game: RoverGame;
    try {
      game = createRoverGame({
        canvas,
        body,
        spec,
        seed,
        resume,
        controls,
        audio,
        startView: view,
        onPhoto: (dataUrl, meta) => {
          toast(`📷 ${meta.caption}`, 'good');
          cb.current.onPhoto?.(dataUrl, meta);
          void sync?.uploadPhoto(meta, dataUrl, gameRef.current?.sim.missionId ?? '').catch(() => undefined);
        },
        onTileTap: (tile, pos) => {
          setTileMenu({ tile, x: pos.x, y: pos.y });
          return true;
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('error');
      cb.current.onError?.(message);
      return;
    }

    gameRef.current = game;
    setGame(game);
    setStatus('running');
    setError(null);
    cb.current.onReady?.(game);

    const off = wireEvents(game, toast, (anomaly) => {
      cb.current.onDiscovery?.(anomaly);
      void sync?.recordDiscovery(anomaly, game.sim.body.id, game.sim.missionId).catch(() => undefined);
    }, (key, payload) => cb.current.onEvent?.(key, payload));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
      game.resize(rect.width || canvas.width, rect.height || canvas.height, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    game.start();

    const hudTimer = setInterval(() => setHud(sampleHud(game)), hudIntervalMs);
    setHud(sampleHud(game));

    const save = () => {
      const state = game.save();
      void cb.current.onSave?.(state);
      void sync?.saveMission(state, game.sim.rover.spec.name).catch(() => undefined);
    };
    const saveTimer = autosaveMs > 0 ? setInterval(save, autosaveMs) : null;
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHide);
    // Save once up front so the mission is immediately resumable.
    save();

    return () => {
      off();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onHide);
      clearInterval(hudTimer);
      if (saveTimer) clearInterval(saveTimer);
      save();
      game.dispose();
      gameRef.current = null;
      setGame(null);
      setHud(null);
      setStatus('booting');
    };
    // Restarting a mission is a remount concern: only the render surface and
    // the identity of the world/rover may trigger a reboot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, body.id, spec.id, resume?.id, seed, controls, audio, view, sync]);

  const actions = useMemo<MissionActions>(() => {
    const g = () => gameRef.current;
    return {
      move: (dir) => g()?.move(dir),
      walkTo: (x, y) => g()?.walkTo(x, y),
      orderMine: (x, y) => g()?.orderMine(x, y),
      cancelOrder: () => g()?.cancelOrder(),
      mine: () => g()?.mine(),
      photo: () => g()?.photo(),
      scan: () => g()?.scan(),
      build: (type) => g()?.build(type),
      craft: (recipeId) => g()?.craft(recipeId),
      placeBlock: () => g()?.placeBlock(),
      repair: () => g()?.repair(),
      demolish: (id) => g()?.demolish(id),
      rotateStructure: (id) => g()?.rotateStructure(id),
      launchCargo: () => g()?.launchCargo(),
      upgradeMobility: () => g()?.upgradeMobility(),
      rotateView: () => g()?.rotateView(),
      setView: (view) => g()?.setView(view),
      toggleView: () => g()?.toggleView() ?? 'iso',
      centreCamera: () => g()?.setCameraFollow(true),
      deposit: () => {
        const moved = g()?.deposit() ?? 0;
        toast(
          moved > 0 ? `Banked ${moved} units in cache` : 'No cache adjacent',
          moved > 0 ? 'good' : 'warn',
        );
      },
      save: async () => {
        const cur = g();
        if (!cur) return;
        const state = cur.save();
        await cb.current.onSave?.(state);
        await sync?.saveMission(state, cur.sim.rover.spec.name).catch(() => undefined);
      },
      endMission: async () => {
        const cur = g();
        if (!cur) return 0;
        cur.stop();
        const state = cur.save();
        if (state.status === 'active') state.status = 'complete';
        const banked = { ...cur.sim.banked };
        let credits = 0;
        if (sync) {
          try {
            credits = await sync.completeMission(state, banked);
            await sync.saveMission(state, cur.sim.rover.spec.name).catch(() => undefined);
          } catch (err) {
            console.warn('[takeon] completeMission failed', err);
          }
        }
        await cb.current.onSave?.(state);
        setStatus('ended');
        cb.current.onEnd?.({ state, credits, banked });
        return credits;
      },
    };
  }, [sync, toast]);

  const value = useMemo<MissionContextValue>(
    () => ({
      game,
      body,
      spec,
      hud,
      status,
      error,
      toasts,
      pushToast,
      dismissToast,
      actions,
      attachCanvas: setCanvas,
      canvas,
      panel,
      setPanel,
      tileMenu,
      setTileMenu,
      minimapVisible,
      setMinimapVisible,
    }),
    [
      game,
      body,
      spec,
      hud,
      status,
      error,
      toasts,
      pushToast,
      dismissToast,
      actions,
      canvas,
      panel,
      tileMenu,
      minimapVisible,
    ],
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

/** Mission state and actions. Throws outside a `MissionProvider`. */
export function useMission(): MissionContextValue {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error('useMission must be used inside <MissionProvider>');
  return ctx;
}

/** Mission state when there is one, `null` otherwise (safe in shared chrome). */
export function useMissionMaybe(): MissionContextValue | null {
  return useContext(MissionContext);
}

export function useHud(): MissionHud | null {
  return useMission().hud;
}

export function useMissionActions(): MissionActions {
  return useMission().actions;
}

function sampleHud(game: RoverGame): MissionHud {
  const r = game.sim.rover;
  const w = game.sim.weather;
  const anomalies = game.sim.anomalies;
  return {
    time: game.sim.time,
    battery: r.battery,
    batteryMax: r.stats.batteryCapacity,
    durability: r.durability,
    durabilityMax: r.stats.durabilityMax,
    fuel: r.fuel,
    fuelMax: r.stats.fuelCapacity,
    cargo: { ...r.cargo },
    cargoUsed: r.cargoUsed,
    cargoMax: r.stats.cargoCapacity,
    banked: { ...game.sim.banked },
    daylight: game.sim.daylight(),
    weather: w
      ? {
          type: w.type,
          name: WEATHER_INFO[w.type].name,
          icon: WEATHER_INFO[w.type].icon,
          intensity: w.intensity,
        }
      : null,
    status: game.sim.status,
    pos: { ...r.pos },
    facing: r.facing,
    can: {
      mine: r.stats.miningPower > 0,
      photo: r.stats.photoQuality > 0,
      scan: r.stats.scanRadius > 0,
    },
    mobility: r.upgrades?.mobility ?? 0,
    view: game.view,
    structures: game.sim.structures.length,
    anomalies: {
      total: anomalies.length,
      scanned: anomalies.filter((a) => a.scanned).length,
      documented: anomalies.filter((a) => a.documented).length,
    },
    order: game.currentOrder(),
  };
}

/**
 * Default event→toast mapping, plus the host firehose. Returns an unsubscribe.
 * Keeping it here (rather than in a component) means a fully custom HUD still
 * gets the same feedback for free.
 */
function wireEvents(
  game: RoverGame,
  toast: (text: string, kind?: ToastKind) => void,
  onDiscovery: (anomaly: Anomaly) => void,
  onEvent: <K extends GameEventKey>(key: K, payload: GameEvents[K]) => void,
): () => void {
  const offs: (() => void)[] = [];
  // Host firehose first: every engine event reaches `onEvent`, including the
  // ones the stock HUD has nothing to say about.
  for (const key of GAME_EVENT_KEYS) {
    offs.push(game.events.on(key, (payload) => onEvent(key, payload)));
  }
  const on = <K extends GameEventKey>(key: K, fn: (payload: GameEvents[K]) => void) => {
    offs.push(game.events.on(key, fn));
  };

  on('mined', ({ resource, amount }) => {
    if (resource) toast(`+${amount} ${RESOURCE_NAMES[resource]}`, 'good');
  });
  on('cargoFull', () => toast('Cargo hold full', 'warn'));
  on('blocked', ({ reason }) => {
    if (reason === 'cliff') toast('Too steep for this drivetrain', 'warn');
    else if (reason === 'battery') toast('Not enough battery', 'warn');
    else if (reason === 'edge') toast('Nothing to drive on there', 'warn');
  });
  on('scan', ({ found }) =>
    toast(
      found.length > 0 ? `Scanner: ${found.length} anomaly signal(s) marked` : 'Scanner: no new signals',
      found.length > 0 ? 'good' : 'info',
    ),
  );
  on('anomalyDocumented', ({ anomaly }) => {
    toast(`★ Discovery documented: ${anomaly.name}`, 'good');
    onDiscovery(anomaly);
  });
  on('built', ({ structure }) => toast(`Constructed ${STRUCTURES[structure.type].name}`, 'good'));
  on('buildFailed', ({ reason }) => toast(reason, 'warn'));
  on('demolished', ({ type }) => toast(`Demolished ${STRUCTURES[type].name}`, 'info'));
  on('demolishFailed', ({ reason }) => toast(reason, 'warn'));
  on('crafted', ({ resource, amount }) => toast(`Refined ${amount} ${RESOURCE_NAMES[resource]}`, 'good'));
  on('craftFailed', ({ reason }) => toast(reason, 'warn'));
  on('blockPlaced', () => toast('Block placed', 'good'));
  on('cargoLaunched', ({ total, auto }) =>
    toast(`🚀 ${auto ? 'Auto-launch' : 'Launch'}: ${total} units away`, 'good'),
  );
  on('launchFailed', ({ reason }) => toast(reason, 'warn'));
  on('upgraded', ({ level }) => toast(`Mobility kit fitted (tier ${level})`, 'good'));
  on('upgradeFailed', ({ reason }) => toast(reason, 'warn'));
  on('habitatComplete', () => toast('🏠 Habitat complete', 'good'));
  on('damaged', ({ amount, reason }) => {
    if (amount >= 1) toast(`Chassis damage −${amount.toFixed(0)} (${reason})`, 'bad');
  });
  on('repaired', ({ amount }) => toast(`Repaired +${amount.toFixed(0)} durability`, 'good'));
  on('roverLost', ({ reason }) => toast(`Rover lost: ${reason}`, 'bad'));
  on('weather', ({ type, phase }) => {
    const info = WEATHER_INFO[type];
    if (phase === 'start') toast(`${info.icon} ${info.warning}`, 'warn');
    else toast(`${info.icon} ${info.name} has passed.`, 'good');
  });
  on('meteorImpact', ({ distance }) => {
    if (distance <= 2.5) toast('☄ Direct hit — chassis damage!', 'bad');
    else if (distance <= 6) toast('☄ Impact close by!', 'warn');
  });

  return () => {
    for (const off of offs) off();
  };
}
