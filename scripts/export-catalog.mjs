// Regenerate the backend's seed catalog from the engine's built-in data:
//   npm run build -w @takeon/engine && node scripts/export-catalog.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { PARTS } = await import('../packages/engine/dist/parts/catalog.js');
const { BODIES } = await import('../packages/engine/dist/world/bodies.js');

const out = join(here, '..', 'pocketbase', 'seed');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'parts.json'), JSON.stringify(PARTS, null, 2));
writeFileSync(join(out, 'bodies.json'), JSON.stringify(BODIES, null, 2));
console.log(`Wrote ${PARTS.length} parts and ${BODIES.length} bodies to pocketbase/seed/`);
