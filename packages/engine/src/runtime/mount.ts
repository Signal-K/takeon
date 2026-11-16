import type { MissionState, RoverSpec } from '../types.js';
import type { ViewKind } from '../scene/types.js';
import { getBody } from '../world/registry.js';
import { defaultSpec } from '../parts/assembly.js';
import { RoverGame } from '../core/game.js';
import { createHostRuntime } from '../core/host.js';
import type { HostOutbound, HostRuntime, RuntimeClock } from '../core/host.js';

/**
 * The packaged client's entry (KES-212 phase 3). A shell loads `takeon-runtime.js` in a WebView or page and either
 * calls `TakeOnRuntime.mount(canvas, config, send)` itself, or lets `TakeOnRuntime.boot()` read the config from the
 * page and find the platform bridge. Nothing here knows about accounts, economy or progression.
 */
export interface RuntimeConfig {
  /** A registered body id (`mars`, `moon`, ...). */
  body: string;
  seed?: number;
  /** Rover parts. Omit `spec` and set `rover: false` for a landscape with no vehicle. */
  spec?: RoverSpec;
  rover?: boolean;
  resume?: MissionState;
  clock?: RuntimeClock;
  startView?: ViewKind;
  /** Built-in keyboard and touch controls (default true). A shell sending its own commands may turn them off. */
  controls?: boolean;
  audio?: boolean;
}

export class RuntimeConfigError extends Error {}

/** Builds the game for `config` on `canvas` and wraps it in the host bridge. */
export function mount(canvas: HTMLCanvasElement, config: RuntimeConfig, send: (msg: HostOutbound) => void): HostRuntime {
  const body = getBody(config.body);
  if (!body) throw new RuntimeConfigError(`unknown body "${config.body}"`);
  const withRover = config.rover !== false;
  const game = new RoverGame({
    canvas,
    body,
    seed: config.seed,
    spec: withRover ? (config.spec ?? defaultSpec()) : undefined,
    showRover: withRover,
    resume: config.resume,
    controls: config.controls,
    audio: config.audio,
    startView: config.startView,
  });
  const rect = canvas.getBoundingClientRect();
  game.resize(rect.width || canvas.width || 1, rect.height || canvas.height || 1, globalThis.devicePixelRatio || 1);
  return createHostRuntime(game, send, { clock: config.clock });
}

/** A platform's way to hand a message to the shell. */
export type BridgeSend = (msg: HostOutbound) => void;

interface BridgeGlobals {
  webkit?: { messageHandlers?: { takeon?: { postMessage(msg: unknown): void } } };
  TakeOnAndroid?: { postMessage(json: string): void };
  parent?: unknown;
  postMessage?: unknown;
}

/**
 * Finds the shell: WKWebView (`webkit.messageHandlers.takeon`), Android (`TakeOnAndroid.postMessage`, a JSON string),
 * or an embedding page (`parent.postMessage`). Falls back to a no-op so a bare page still runs.
 */
export function findBridge(g: BridgeGlobals = globalThis as unknown as BridgeGlobals): { name: 'ios' | 'android' | 'parent' | 'none'; send: BridgeSend } {
  const ios = g.webkit?.messageHandlers?.takeon;
  if (ios) return { name: 'ios', send: (msg) => ios.postMessage(msg) };
  const android = g.TakeOnAndroid;
  if (android) return { name: 'android', send: (msg) => android.postMessage(JSON.stringify(msg)) };
  const parent = g.parent as { postMessage?: (msg: unknown, origin: string) => void } | undefined;
  if (parent && parent !== (g as unknown) && typeof parent.postMessage === 'function') {
    return { name: 'parent', send: (msg) => parent.postMessage!({ takeon: msg }, '*') };
  }
  return { name: 'none', send: () => undefined };
}

/**
 * Boots the page: reads the config from `?config=<json>` or `window.TAKEON_CONFIG`, mounts on `#takeon`, and exposes
 * `window.takeon.receive(msg)` for the shell to call (`evaluateJavaScript`, `evaluateJavascript`, or a `message` event
 * with `{ takeon: msg }`). A bad config is reported to the shell as `{ kind: 'error', error: 'invalid' }`.
 */
export function boot(): HostRuntime | null {
  const g = globalThis as unknown as Window & { TAKEON_CONFIG?: RuntimeConfig; takeon?: { receive(msg: unknown): void } };
  const bridge = findBridge(g as unknown as BridgeGlobals);
  const canvas = (g.document?.getElementById('takeon') as HTMLCanvasElement | null) ?? null;
  let config: RuntimeConfig | undefined = g.TAKEON_CONFIG;
  try {
    const raw = new URLSearchParams(g.location?.search ?? '').get('config');
    if (raw) config = JSON.parse(raw) as RuntimeConfig;
  } catch {
    config = undefined;
  }
  if (!canvas || !config || typeof config.body !== 'string') {
    bridge.send({ v: 1, kind: 'error', error: 'invalid' });
    return null;
  }
  let runtime: HostRuntime;
  try {
    runtime = mount(canvas, config, bridge.send);
  } catch {
    bridge.send({ v: 1, kind: 'error', error: 'invalid' });
    return null;
  }
  g.takeon = { receive: (msg) => runtime.receive(typeof msg === 'string' ? safeParse(msg) : msg) };
  g.addEventListener?.('message', (e: MessageEvent) => {
    const data = e.data as { takeon?: unknown } | null;
    if (data && typeof data === 'object' && 'takeon' in data) runtime.receive(data.takeon);
  });
  // Keep the canvas matched to the page; a host-clock shell may also send `resize` itself.
  g.addEventListener?.('resize', () => runtime.receive({ v: 1, kind: 'resize', width: g.innerWidth, height: g.innerHeight, dpr: g.devicePixelRatio || 1 }));
  g.document?.addEventListener('visibilitychange', () => runtime.receive({ v: 1, kind: g.document.hidden ? 'pause' : 'resume' }));
  return runtime;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
