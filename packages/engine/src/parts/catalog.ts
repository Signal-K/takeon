import type { PartDef } from '../types.js';
import { parts } from '../data/core-catalog.js';
export const PARTS = parts as unknown as PartDef[];

export function getPart(id: string, catalog: PartDef[] = PARTS): PartDef | undefined {
  return catalog.find((p) => p.id === id);
}
