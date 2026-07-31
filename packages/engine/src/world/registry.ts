import type { BodyDef } from '../types.js';
import { BODIES } from './bodies.js';

/**
 * Runtime destination registry.
 *
 * `BODIES` is the built-in catalog, but hosts (a backend row, a game built on
 * TakeOn, or the editor's live preview) need to add or override destinations
 * without patching the engine. Registered bodies shadow built-ins with the
 * same id, so an editor can iterate on "mars" and every consumer that resolves
 * through `getBody`/`listBodies` sees the edit.
 *
 * The registry only affects lookup — generation stays deterministic from
 * `(BodyDef, seed)`, so nothing here changes how a world is built.
 */
const registered = new Map<string, BodyDef>();

/** Add or replace a destination. Returns the stored def. */
export function registerBody(def: BodyDef): BodyDef {
  registered.set(def.id, def);
  return def;
}

/** Register several at once (e.g. a catalog fetched from a backend). */
export function registerBodies(defs: BodyDef[]): void {
  for (const def of defs) registerBody(def);
}

/** Remove a registered body. Built-ins are never removed, only unshadowed. */
export function unregisterBody(id: string): boolean {
  return registered.delete(id);
}

/** Drop every registered body, restoring the built-in catalog. */
export function clearRegisteredBodies(): void {
  registered.clear();
}

/** Whether this id was registered at runtime (vs. a built-in). */
export function isRegisteredBody(id: string): boolean {
  return registered.has(id);
}

/** Registered bodies only, in registration order. */
export function registeredBodies(): BodyDef[] {
  return [...registered.values()];
}

/**
 * The effective catalog: built-ins in declaration order (replaced in place by
 * a registered override of the same id), then any purely custom bodies.
 */
export function listBodies(): BodyDef[] {
  const out = BODIES.map((b) => registered.get(b.id) ?? b);
  const builtinIds = new Set(BODIES.map((b) => b.id));
  for (const [id, def] of registered) if (!builtinIds.has(id)) out.push(def);
  return out;
}

/** Resolve a destination by id; registered bodies win over built-ins. */
export function getBody(id: string): BodyDef | undefined {
  return registered.get(id) ?? BODIES.find((b) => b.id === id);
}
