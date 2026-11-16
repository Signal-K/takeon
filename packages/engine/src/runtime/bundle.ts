/**
 * The single-file runtime bundle (`dist/runtime/takeon-runtime.js`, global `TakeOnRuntime`). Built by
 * `npm run build:runtime`; `dist/runtime/index.html` loads it and calls `TakeOnRuntime.boot()`.
 */
export { mount, boot, findBridge, RuntimeConfigError } from './mount.js';
export { RUNTIME_VERSION } from '../core/host.js';
export { PROTOCOL_VERSION } from '../core/protocol.js';
