// Preserve the synchronous engine API without running Go during SSR/import.
// The first simulation/world/stat call starts one VM from the paired Go build.
import { installGoShim, wasmBase64 } from './artifacts.js';
import type { CoreTransport } from './index.js';
let transport: CoreTransport | undefined;
function initialize(): CoreTransport {
  if (transport) return transport;
  const GoShim = installGoShim();
  const bytes = Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0));
  const go = new GoShim();
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), go.importObject);
  const previous = (globalThis as typeof globalThis & { takeonCore?: CoreTransport }).takeonCore;
  void go.run(instance).catch((error: unknown) => console.error('takeon-core stopped', error));
  transport = (globalThis as typeof globalThis & { takeonCore: CoreTransport }).takeonCore;
  if (!transport || transport === previous) {
    transport = undefined;
    throw new Error('takeon-core: Go did not install its bridge');
  }
  return transport;
}
export function coreCall<T>(op: string, args: Record<string, unknown> = {}): T {
  const response = JSON.parse(initialize()(JSON.stringify({ ...args, op })));
  if (!response.ok) throw new Error(`takeon-core ${op}: ${response.error}`);
  return response.value as T;
}

export function coreCapabilities(): import('./index.js').CoreCapabilities {
  return coreCall('capabilities');
}
