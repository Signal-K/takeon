import type { RoverSpec } from '../types.js';
import { DEFAULT_ROVER_LOOK, type FieldRoverLook } from './meshes.js';

/**
 * The field rover's fit-out from a Landnam/TakeOn `RoverSpec` (KES-543).
 *
 * The same rover build drives TakeOn's iso painter (`render/rover.ts`) through
 * its stats; this reads the part ids directly, so the field module stays free
 * of the parts catalog and the Go core. The mapping matches the stats the
 * painter tests: tracks (grip ≥ 0.8), solar or RTG power, a camera, a
 * scanner, a tool, and a cargo module.
 */
export function roverLookFromSpec(spec: Partial<RoverSpec> | null | undefined): FieldRoverLook {
  if (!spec) return { ...DEFAULT_ROVER_LOOK };
  const modules = spec.modules ?? [];
  const has = (prefix: string) => modules.some(m => m.startsWith(prefix));
  const chassis = spec.chassis?.includes('hauler') ? 'hauler' : spec.chassis?.includes('lab') ? 'lab' : 'scout';
  return {
    color: spec.color || DEFAULT_ROVER_LOOK.color,
    chassis,
    tracks: !!spec.wheels?.includes('tracks'),
    solar: !!spec.power?.startsWith('power-solar'),
    rtg: !!spec.power?.startsWith('power-rtg'),
    camera: has('cam-'),
    scanner: has('scan-'),
    tool: has('tool-'),
    cargo: has('cargo-'),
  };
}
