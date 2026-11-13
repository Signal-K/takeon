import type { BodyDef } from '../types.js';
import { listBiomes } from './biomes.js';
import { allowedBiomesForKind } from './kinds.js';
import { getDem } from './dem/index.js';
/** Resolve host registries to data before entering Go. No terrain rules here. */
export function coreBody(body: BodyDef) {
  return {
    ...body,
    coreDEM: body.dem ? getDem(body.dem) : undefined,
    coreBiomes: listBiomes().map((b) => ({
      ...b,
      climate: b.climate ? [b.climate.min, b.climate.max] : undefined,
    })),
    coreAllowedBiomes: body.kind ? allowedBiomesForKind(body.kind) : undefined,
  };
}
