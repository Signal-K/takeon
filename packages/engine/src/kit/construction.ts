import { beam, box, flat, light, modelBounds, partBounds, type Part } from './mesh.js';

/**
 * A structure going up, drawn from its finished model:
 *
 * - 0 – 0.14: stakes and a string line mark the footprint, then the
 *   foundation slab is poured.
 * - 0.14 – 0.9: the model rises from the slab in height order (each part
 *   grows to its full height in turn) inside scaffolding, with a tower crane
 *   at the back corner swinging loads over it.
 * - 0.9 – 1: the scaffold and crane are gone; the finished model stands.
 *
 * Lights and windows wait for the part that carries them to be finished.
 */

export const FOUNDATION_END = 0.14;
export const STRUCTURE_END = 0.9;

const SCAFFOLD = '#d9a441';
const CRANE = '#f0b429';
const STAKE = '#e8692e';

/** The model as built up to `buildZ` (model units of height). */
export function clipModel(parts: readonly Part[], buildZ: number): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    switch (p.kind) {
      case 'flat':
        out.push(p);
        break;
      case 'box': {
        const h = Math.min(p.h, buildZ - p.z);
        if (h <= 0.002) break;
        out.push(h >= p.h ? p : { ...p, h, windows: undefined, door: p.door && p.door.h <= h ? p.door : undefined, top: '#9a9ea4' });
        break;
      }
      case 'cyl': {
        const h = Math.min(p.h, buildZ - p.z);
        if (h <= 0.002) break;
        out.push(h >= p.h ? p : { ...p, h, r1: p.r0 + (p.r1 - p.r0) * (h / p.h), ports: undefined, top: '#9a9ea4' });
        break;
      }
      case 'beam': {
        const lo = Math.min(p.a[2], p.b[2]);
        const hi = Math.max(p.a[2], p.b[2]);
        if (buildZ <= lo) break;
        if (buildZ >= hi) {
          out.push(p);
          break;
        }
        const t = (buildZ - p.a[2]) / (p.b[2] - p.a[2]);
        const cut: [number, number, number] = [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t, buildZ];
        out.push(p.a[2] < p.b[2] ? { ...p, b: cut } : { ...p, a: cut });
        break;
      }
      default: {
        // Roofs, panels, dishes and lamps go on once the level under them is up.
        if (partBounds(p)[5] <= buildZ + 0.02) out.push(p);
      }
    }
  }
  return out;
}

/** Corner stakes and a string line round the footprint. */
function stakes(f0: number, f1: number, s0: number, s1: number): Part[] {
  const out: Part[] = [];
  for (const [f, s] of [[f0, s0], [f1, s0], [f1, s1], [f0, s1]] as const) {
    out.push(beam([f, s, 0], [f, s, 0.2], 0.025, '#c9b28a'));
    out.push(box(f, s, 0.17, 0.035, 0.035, 0.04, STAKE));
  }
  const w = 0.012;
  out.push(flat([[f0, s0 - w], [f1, s0 - w], [f1, s0 + w], [f0, s0 + w]], STAKE, 0.006));
  out.push(flat([[f0, s1 - w], [f1, s1 - w], [f1, s1 + w], [f0, s1 + w]], STAKE, 0.006));
  out.push(flat([[f0 - w, s0], [f0 + w, s0], [f0 + w, s1], [f0 - w, s1]], STAKE, 0.006));
  out.push(flat([[f1 - w, s0], [f1 + w, s0], [f1 + w, s1], [f1 - w, s1]], STAKE, 0.006));
  return out;
}

/** Poles and rails round a core, up to `top`. */
function scaffold(f0: number, f1: number, s0: number, s1: number, top: number): Part[] {
  const out: Part[] = [];
  const pad = 0.07;
  const F0 = f0 - pad, F1 = f1 + pad, S0 = s0 - pad, S1 = s1 + pad;
  const poles: [number, number][] = [];
  const along = (a: number, b: number) => {
    const n = Math.max(1, Math.round((b - a) / 0.45));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  for (const f of along(F0, F1)) poles.push([f, S0], [f, S1]);
  for (const s of along(S0, S1).slice(1, -1)) poles.push([F0, s], [F1, s]);
  for (const [f, s] of poles) out.push(beam([f, s, 0.04], [f, s, top], 0.02, SCAFFOLD));
  for (let z = 0.3; z <= top + 1e-6; z += 0.3) {
    out.push(beam([F0, S0, z], [F1, S0, z], 0.018, SCAFFOLD), beam([F1, S0, z], [F1, S1, z], 0.018, SCAFFOLD));
    out.push(beam([F1, S1, z], [F0, S1, z], 0.018, SCAFFOLD), beam([F0, S1, z], [F0, S0, z], 0.018, SCAFFOLD));
    // Planks on the two walkways the camera sees.
    out.push(box((F0 + F1) / 2, S1 + 0.03, z, F1 - F0, 0.06, 0.012, '#b7864a'));
    out.push(box(F1 + 0.03, (S0 + S1) / 2, z, 0.06, S1 - S0, 0.012, '#b7864a'));
  }
  return out;
}

/** A tower crane at the back corner, its jib swinging over the work. */
function crane(f0: number, f1: number, s0: number, s1: number, top: number, hookZ: number, time: number): Part[] {
  const mf = f0 - 0.28, ms = s0 - 0.28;
  const H = top + 0.55;
  const out: Part[] = [];
  const w = 0.11;
  for (const [df, ds] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) out.push(beam([mf + (df * w) / 2, ms + (ds * w) / 2, 0], [mf + (df * w) / 2, ms + (ds * w) / 2, H], 0.022, CRANE));
  for (let z = 0.15; z < H; z += 0.2) out.push(beam([mf - w / 2, ms + w / 2, z], [mf + w / 2, ms + w / 2, z + 0.2], 0.014, CRANE), beam([mf + w / 2, ms - w / 2, z], [mf + w / 2, ms + w / 2, z + 0.2], 0.014, CRANE));
  out.push(box(mf, ms, H, 0.16, 0.16, 0.1, '#4b5561'));
  // Jib toward the middle of the work, swinging slowly.
  const cf = (f0 + f1) / 2, cs = (s0 + s1) / 2;
  const base = Math.atan2(cs - ms, cf - mf);
  const ang = base + Math.sin(time * 0.7) * 0.35;
  const reach = Math.hypot(cf - mf, cs - ms) * 1.35 + 0.2;
  const jz = H + 0.1;
  const tip: [number, number, number] = [mf + Math.cos(ang) * reach, ms + Math.sin(ang) * reach, jz];
  const back: [number, number, number] = [mf - Math.cos(ang) * 0.4, ms - Math.sin(ang) * 0.4, jz];
  out.push(beam([mf, ms, jz], tip, 0.04, CRANE), beam(back, [mf, ms, jz], 0.04, CRANE));
  out.push(beam([mf, ms, jz + 0.22], tip, 0.012, '#c7ccd2'), beam([mf, ms, jz + 0.22], back, 0.012, '#c7ccd2'));
  out.push(beam([mf, ms, jz], [mf, ms, jz + 0.22], 0.025, CRANE));
  out.push(box(back[0], back[1], jz - 0.1, 0.14, 0.14, 0.1, '#6b737d'));
  // The hook, travelling out along the jib, a load hanging under it.
  const k = 0.55 + Math.sin(time * 1.1) * 0.25;
  const hf = mf + Math.cos(ang) * reach * k, hs = ms + Math.sin(ang) * reach * k;
  const hz = Math.min(jz - 0.15, Math.max(hookZ + 0.18, 0.25));
  out.push(beam([hf, hs, jz], [hf, hs, hz], 0.008, '#30353b'));
  out.push(box(hf, hs, hz - 0.08, 0.16, 0.08, 0.08, '#8e9aa6'));
  out.push(light(mf, ms, H + 0.36, 0.025, '#d8432f', 0.9));
  return out;
}

/**
 * The parts to draw for a structure at build `progress` (0..1). Draw the
 * finished model as a ghost first (`drawModel(..., { ghost: true })`) while
 * `progress < STRUCTURE_END`, so the player sees what is coming.
 */
export function constructionParts(model: readonly Part[], progress: number, time = 0): Part[] {
  const p = Math.max(0, Math.min(1, progress));
  if (p >= 1) return [...model];
  const solids = model.filter((q) => q.kind !== 'flat');
  if (solids.length === 0) return [...model];
  // The slab is the model's lowest wide box, else its bounds.
  const [f0, f1, s0, s1, , zTop] = modelBounds(solids);
  const slab = solids.find((q) => q.kind === 'box' && q.z === 0 && q.h <= 0.08 && q.l >= (f1 - f0) * 0.8);
  const slabH = slab && slab.kind === 'box' ? slab.h : 0.04;
  if (p < FOUNDATION_END) {
    const q = p / FOUNDATION_END;
    const out = stakes(f0, f1, s0, s1);
    if (q > 0.35) out.push(box((f0 + f1) / 2, (s0 + s1) / 2, 0, f1 - f0, s1 - s0, slabH * Math.min(1, (q - 0.35) / 0.65), '#a3a6aa'));
    return out;
  }
  if (p >= STRUCTURE_END) return [...model];
  const q = (p - FOUNDATION_END) / (STRUCTURE_END - FOUNDATION_END);
  const buildZ = slabH + (zTop - slabH) * q;
  const out = clipModel(model, Math.max(slabH + 0.001, buildZ));
  // Scaffold round the core (the parts that stand above the slab).
  const core = solids.filter((x) => partBounds(x)[4] >= slabH - 0.001 && x.kind !== 'light');
  const [cf0, cf1, cs0, cs1] = core.length ? modelBounds(core) : [f0, f1, s0, s1];
  const top = Math.min(zTop + 0.05, buildZ + 0.25);
  out.push(...scaffold(cf0, cf1, cs0, cs1, Math.max(0.3, top)));
  out.push(...crane(cf0, cf1, cs0, cs1, zTop, buildZ, time));
  return out;
}
