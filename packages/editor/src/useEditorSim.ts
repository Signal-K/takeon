import { EventBus, Simulation, type BodyDef, type RoverSpec, type VoxelWorld } from '@takeon/engine';
import { useEffect, useMemo, useState } from 'react';

/**
 * Keeps one generated world alive for the whole editor.
 *
 * Generation is deterministic but not free (a 112² world is ~12k columns), so
 * inspector edits are debounced and every panel — viewport, maps, analysis —
 * shares the same `Simulation` instance. That also guarantees the numbers in
 * the analysis panel describe exactly the world being drawn.
 */
export interface EditorSim {
  sim: Simulation | null;
  world: VoxelWorld | null;
  /** Bumped on every regeneration, for panels that cache derived images. */
  version: number;
  /** Wall-clock generation time of the last build, in ms. */
  ms: number;
  generating: boolean;
  error: string | null;
  regenerate(): void;
}

export function useEditorSim(body: BodyDef, spec: RoverSpec, enabled = true, debounceMs = 180): EditorSim {
  const [nonce, setNonce] = useState(0);
  const [pending, setPending] = useState(false);
  // Only the fields that feed generation should trigger a rebuild; palette or
  // description edits must not throw away the world you are looking at.
  const signature = useMemo(
    () =>
      JSON.stringify([
        body.id,
        body.size,
        body.maxHeight,
        body.seed,
        body.dem ?? null,
        body.terrain,
        body.minerals ?? null,
        nonce,
      ]),
    [body, nonce],
  );
  const [built, setBuilt] = useState<{ sim: Simulation | null; ms: number; error: string | null; version: number }>({
    sim: null,
    ms: 0,
    error: null,
    version: 0,
  });

  useEffect(() => {
    if (!enabled) return;
    setPending(true);
    const timer = setTimeout(() => {
      const started = now();
      try {
        const sim = new Simulation({ body, spec, events: new EventBus() });
        setBuilt((b) => ({ sim, ms: now() - started, error: null, version: b.version + 1 }));
      } catch (err) {
        setBuilt((b) => ({ ...b, error: err instanceof Error ? err.message : String(err) }));
      }
      setPending(false);
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      setPending(false);
    };
    // `signature` captures every generation input; `body`/`spec` identity churn
    // on unrelated edits would otherwise rebuild the world constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, debounceMs]);

  return {
    sim: built.sim,
    world: built.sim?.world ?? null,
    version: built.version,
    ms: built.ms,
    generating: pending,
    error: built.error,
    regenerate: () => setNonce((n) => n + 1),
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
