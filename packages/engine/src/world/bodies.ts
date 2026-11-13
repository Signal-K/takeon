import type { BodyDef } from '../types.js';
import { bodies } from '../data/core-catalog.js';
/** Built-in content is shared with Go/mobile; host registration remains additive. */
export const BODIES = bodies as unknown as BodyDef[];
