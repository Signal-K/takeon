import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architectural layering guard.
 *
 * The engine ships as one package, but its folders are layered so a future
 * split into @takeon/world / @takeon/rover / @takeon/sync stays mechanical:
 * lower layers must never import upward. This test parses every relative
 * import in src/ and fails on any edge outside the allowed matrix — so the
 * dependency direction can't silently degrade.
 *
 * Current known straddles that block a physical split today (documented in
 * docs/INTEGRATION.md): render→sim (the renderer draws the mission, not just
 * the world), the shared types.ts, and structure/recipe verbs living inside
 * Simulation. If those are ever untangled, tighten this matrix.
 */
const SRC = join(__dirname, '..', 'src');

/** folder -> folders it may import from (types.ts and same-folder are free). */
const ALLOWED: Record<string, string[]> = {
  util: [],
  audio: [],
  module: [],
  parts: [],
  world: ['util'],
  net: ['parts', 'world', 'util'],
  sim: ['parts', 'world', 'util'],
  // The scene model flattens a running sim into renderer-agnostic entities,
  // so it sits above sim and below every renderer.
  scene: ['sim', 'world', 'util'],
  render: ['scene', 'sim', 'world', 'util'],
  input: ['render'],
  core: ['scene', 'sim', 'render', 'input', 'audio', 'util'],
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('engine internal layering', () => {
  it('no folder imports outside its allowed layer set', () => {
    const violations: string[] = [];
    for (const folder of Object.keys(ALLOWED)) {
      for (const file of tsFiles(join(SRC, folder))) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/from '\.\.\/([a-z]+)\//g)) {
          const target = m[1];
          if (!ALLOWED[folder].includes(target)) {
            violations.push(`${folder} → ${target} (${file.slice(SRC.length + 1)})`);
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the allowed matrix itself is acyclic', () => {
    // Defensive: if someone edits ALLOWED to permit a cycle, catch it here.
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const visit = (n: string): void => {
      if (seen.has(n)) return;
      expect(visiting.has(n), `cycle through '${n}'`).toBe(false);
      visiting.add(n);
      for (const dep of ALLOWED[n] ?? []) visit(dep);
      visiting.delete(n);
      seen.add(n);
    };
    for (const n of Object.keys(ALLOWED)) visit(n);
  });
});
