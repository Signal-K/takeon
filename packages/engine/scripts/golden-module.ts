/**
 * Golden vectors for the mission/module contract (module/state.ts).
 *   npx -y esbuild packages/engine/scripts/golden-module.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/takeon-golden-module.mjs && node /tmp/takeon-golden-module.mjs golden
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createWorldState,
  explore,
  returnToBase,
  resetWorld,
  deriveMissionProgress,
  serializeWorldState,
  parseWorldState,
} from '../src/module/state.js';
import type { TakeonWorldState } from '../src/module/types.js';

const out = process.argv[2] ?? 'golden';
mkdirSync(out, { recursive: true });

// Scripted sequences: op list -> after each op, state + progress + serialized JSON.
type Op =
  | { op: 'explore'; x: number; y: number; data?: number; samples?: number }
  | { op: 'return' }
  | { op: 'reset' };
const SCRIPTS: { base: { x: number; y: number }; ops: Op[] }[] = [
  {
    base: { x: 0, y: 0 },
    ops: [
      { op: 'explore', x: 1, y: 0, data: 2 },
      { op: 'explore', x: 1, y: 1, samples: 1 },
      { op: 'explore', x: 1, y: 0, data: 1 },
      { op: 'explore', x: 2, y: 1, data: 3, samples: 1 },
      { op: 'return' },
      { op: 'explore', x: 5, y: 5, data: 4, samples: 2 },
      { op: 'explore', x: 6, y: 5 },
      { op: 'return' },
      { op: 'reset' },
      { op: 'explore', x: -1, y: -1, data: 1 },
    ],
  },
  {
    base: { x: 40, y: 64 },
    ops: [
      { op: 'explore', x: 41, y: 64, data: 8 },
      { op: 'explore', x: 42, y: 64, samples: 3 },
      { op: 'explore', x: 43, y: 64 },
      { op: 'return' },
    ],
  },
];
const runs = SCRIPTS.map((s) => {
  let st: TakeonWorldState = createWorldState(s.base);
  const steps = [{ state: st, progress: deriveMissionProgress(st), json: serializeWorldState(st) }];
  for (const o of s.ops) {
    st = o.op === 'explore' ? explore(st, { x: o.x, y: o.y }, { data: o.data, samples: o.samples }) : o.op === 'return' ? returnToBase(st) : resetWorld(st);
    steps.push({ state: st, progress: deriveMissionProgress(st), json: serializeWorldState(st) });
  }
  return { base: s.base, ops: s.ops, steps };
});

// Persistence tolerance: raw payload (string) -> parsed state + progress.
const RAW: unknown[] = [
  null,
  'garbage{',
  '{}',
  JSON.stringify({ schemaVersion: 1, base: { x: 3, y: 4 }, explored: ['3,4', '4,4'], data: 5, samples: 2 }),
  JSON.stringify({ schemaVersion: 2, base: { x: 1, y: 1 }, rover: { x: 2, y: 2 }, explored: [], heldData: 2, heldSamples: 1, bankedData: 9, bankedSamples: 3 }),
  JSON.stringify({
    schemaVersion: 2, base: { x: 0, y: 0 }, explored: ['0,0', 1, '1,0'], bankedData: 'x',
    mission: { id: 'm2', name: 'Two', objectives: [{ kind: 'explore', label: 'A', target: 2 }] },
  }),
  JSON.stringify({ mission: { id: 'empty', name: 'E', objectives: [] }, bankedData: 100 }),
];
const parsed = RAW.map((raw) => {
  const st = parseWorldState(raw);
  return { raw: typeof raw === 'string' || raw === null ? raw : null, state: st, progress: deriveMissionProgress(st) };
});

writeFileSync(`${out}/module.json`, JSON.stringify({ runs, parsed }));
