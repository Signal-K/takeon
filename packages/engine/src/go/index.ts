/** Additive Go-backed entry. The default engine/Pixi simulation stays unchanged
 * until the capability gaps tracked in SSL-778 are closed. No gameplay rules
 * live here: this module only loads WASM and translates its JSON boundary. */
export interface CoreCapabilities {
  protocolVersion: 1;
  orders: string[];
  unsupported: string[];
  snapshotFormat: 'takeon-go/v1';
}
export interface CoreEvent { kind: string; x?: number; y?: number; detail?: string; amount?: number }
export interface CoreWindow { x: number; y: number; w: number; h: number; size: number; heights: number[]; mats: number[]; ore: number[] }
export interface GoEngine {
  step(dtSeconds: number): CoreEvent[];
  order(kind: string, arg?: number): boolean;
  orderMine(x: number, y: number): boolean;
  bank(): boolean;
  seedCache(): void;
  seedCargo(cargo: Record<string, number>): void;
  deposit(): number;
  state<T = unknown>(): T;
  mission<T = unknown>(): T;
  window(x: number, y: number, w: number, h: number): CoreWindow;
  snapshot(): string;
  restore(snapshot: string): void;
  dispose(): void;
}
export interface GoCore {
  readonly capabilities: CoreCapabilities;
  createEngine(seed: number, bodyId: string): GoEngine;
}
export interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
export interface GoConstructor { new(): GoRuntime }
export type CoreTransport = (request: string) => string;

/** A transport is also useful for native/headless hosts and contract tests. */
export function connectGoCore(transport: CoreTransport): GoCore {
  const call = <T>(op: string, args: Record<string, unknown> = {}): T => {
    const response = JSON.parse(transport(JSON.stringify({ ...args, op }))) as { ok: boolean; value?: T; error?: string };
    if (!response.ok) throw new Error(`takeon-core ${op}: ${response.error ?? 'request failed'}`);
    return response.value as T;
  };
  const capabilities = call<CoreCapabilities>('capabilities');
  if (capabilities.protocolVersion !== 1) throw new Error('takeon-core: unsupported bridge protocol');
  return {
    capabilities,
    createEngine(seed, bodyId) {
      if (!Number.isSafeInteger(seed)) throw new Error('takeon-core: seed must be a safe integer');
      const engineId = call<number>('create', { seed: seed >>> 0, bodyId });
      let disposed = false;
      const invoke = <T>(op: string, args: Record<string, unknown> = {}): T => {
        if (disposed) throw new Error('takeon-core: engine is disposed');
        return call<T>(op, { ...args, engineId });
      };
      return {
        step: dt => {
          if (!Number.isFinite(dt) || dt < 0 || dt > 60) throw new Error('takeon-core: dt must be between 0 and 60 seconds');
          return invoke<CoreEvent[]>('step', { dt });
        },
        order: (kind, arg = 0) => invoke('order', { kind, arg }),
        orderMine: (x, y) => invoke('orderMine', { x, y }),
        bank: () => invoke('bank'),
        seedCache: () => { invoke('seedCache'); },
        seedCargo: cargo => {
          if (Object.values(cargo).some(v => !Number.isFinite(v) || v < 0)) throw new Error('takeon-core: cargo must be finite and nonnegative');
          invoke('seedCargo', { cargo });
        },
        deposit: () => invoke('deposit'),
        state: <T>() => invoke<T>('state'),
        mission: <T>() => invoke<T>('mission'),
        window: (x, y, w, h) => invoke('window', { x, y, w, h }),
        snapshot: () => invoke('snapshot'),
        restore: snapshot => { invoke('restore', { snapshot }); },
        dispose: () => { if (!disposed) { invoke('dispose'); disposed = true; } },
      };
    },
  };
}

type Globals = typeof globalThis & { Go?: GoConstructor; takeonCore?: CoreTransport };
export interface LoadGoCoreOptions {
  /** Node hosts pass readFile(import.meta.resolve('@takeon/engine/go/takeon.wasm')). */
  wasmBytes?: BufferSource;
  /** Browser hosts can serve the build artifacts from their own static origin. */
  wasmURL?: string | URL;
  wasmExecURL?: string | URL;
}
let loading: Promise<GoCore> | undefined;

/** One Go VM can host many independent games. Failed loads can be retried.
 * Load the shim and WASM produced by the same Go toolchain together. */
export function loadGoCore(options: LoadGoCoreOptions = {}): Promise<GoCore> {
  if (!loading) {
    loading = (async () => {
      const globals = globalThis as Globals;
      // Import this artifact even if another Go version's shim is installed.
      const shim = options.wasmExecURL ?? new URL('./wasm_exec.js', import.meta.url);
      await import(/* @vite-ignore */ String(shim));
      if (!globals.Go) throw new Error('takeon-core: WASM shim did not install Go');
      const go = new globals.Go();
      const bytes = options.wasmBytes ?? await (async () => {
        const response = await fetch(options.wasmURL ?? new URL('./takeon.wasm', import.meta.url));
        if (!response.ok) throw new Error(`takeon-core: WASM fetch failed (${response.status})`);
        return response.arrayBuffer();
      })();
      const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
      const previous = globals.takeonCore;
      // Go installs its synchronous boundary before blocking in main/select.
      // Observe startup rejection so failures cannot become unhandled promises.
      const running = go.run(instance);
      if (!globals.takeonCore || globals.takeonCore === previous) {
        await Promise.race([running, Promise.resolve()]);
        throw new Error('takeon-core: Go did not install its bridge');
      }
      void running.catch(error => { console.error('takeon-core runtime stopped', error); });
      return connectGoCore(globals.takeonCore);
    })().catch(error => { loading = undefined; throw error; });
  }
  return loading;
}
