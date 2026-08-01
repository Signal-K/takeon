import type { Anomaly, RoverState, Structure } from '../types.js';
import type { SceneEntity, SceneEntityKind } from '../scene/types.js';

/**
 * Top-down entity painters for the 2D view.
 *
 * The flat view is a *readable* projection, not a miniature of the diorama:
 * entities become chunky glyphs sized in tiles, so a 96² world stays legible
 * zoomed out. Painters are registered per entity kind, so a host game can draw
 * its own entities (or replace ours) without touching the renderer.
 */

export interface FlatPaintContext {
  /** Pixels per tile at the current zoom. */
  tile: number;
  /** 0 = night, 1 = noon. */
  daylight: number;
  /** Smooth render clock in seconds. */
  time: number;
  /** Screen-space facing after view rotation. */
  facing: 0 | 1 | 2 | 3;
}

export type FlatPainter = (ctx: CanvasRenderingContext2D, entity: SceneEntity, p: FlatPaintContext) => void;

const painters = new Map<SceneEntityKind, FlatPainter>();

export function registerFlatPainter(kind: SceneEntityKind, painter: FlatPainter): void {
  painters.set(kind, painter);
}

export function getFlatPainter(kind: SceneEntityKind): FlatPainter | undefined {
  return painters.get(kind);
}

export function listFlatPainterKinds(): SceneEntityKind[] {
  return [...painters.keys()];
}

// ── Built-ins ───────────────────────────────────────────────────────────

registerFlatPainter('rover', (ctx, entity, p) => {
  const rover = entity.ref as RoverState | undefined;
  // Floor the glyph size: zoomed out to the whole world a tile is a few
  // pixels, and the thing you are driving must never vanish.
  const r = Math.max(4, p.tile * 0.42);
  const colour = rover?.spec.color || '#c8d6e5';

  // Halo so the rover never disappears against bright terrain.
  ctx.fillStyle = 'rgba(8,12,22,0.45)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
  ctx.fill();

  // Hull: a rounded chevron pointing where it is facing.
  ctx.save();
  ctx.rotate((p.facing * Math.PI) / 2 + Math.PI / 4);
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(10,14,24,0.85)';
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.beginPath();
  ctx.moveTo(r * 1.25, 0);
  ctx.lineTo(-r * 0.85, r * 0.95);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.85, -r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Status dot: charge state, matching the HUD's language.
  const battery = Number(entity.data?.battery ?? 0);
  const stats = rover?.stats;
  const charge = stats && stats.batteryCapacity > 0 ? battery / stats.batteryCapacity : 1;
  ctx.fillStyle = charge < 0.2 ? '#ff5f5f' : charge < 0.5 ? '#ffb03a' : '#6fdc8c';
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, r * 0.28), 0, Math.PI * 2);
  ctx.fill();

  if (entity.data?.mining) {
    const pulse = 0.5 + 0.5 * Math.sin(p.time * 8);
    ctx.strokeStyle = `rgba(255,176,58,${0.35 + pulse * 0.4})`;
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.9 + pulse * 0.25), 0, Math.PI * 2);
    ctx.stroke();
  }
});

const STRUCTURE_GLYPHS: Record<string, { colour: string; glyph: string }> = {
  'solar-array': { colour: '#4a7fd4', glyph: '▤' },
  beacon: { colour: '#ffd166', glyph: '▲' },
  'drill-rig': { colour: '#c96f4a', glyph: '⌁' },
  cache: { colour: '#7bd88f', glyph: '▣' },
  refinery: { colour: '#b07de0', glyph: '⬒' },
  'habitat-frame': { colour: '#9aa7b8', glyph: '⌂' },
  habitat: { colour: '#e6edf5', glyph: '⌂' },
  'launch-pad': { colour: '#ff8a5c', glyph: '▲' },
  generator: { colour: '#ffb03a', glyph: '⚡' },
  pylon: { colour: '#5fe3d8', glyph: '↕' },
};

registerFlatPainter('structure', (ctx, entity, p) => {
  const st = entity.ref as Structure | undefined;
  const spec = STRUCTURE_GLYPHS[entity.variant ?? ''] ?? { colour: '#9aa7b8', glyph: '▪' };
  const size = Math.max(6, p.tile * 0.78);
  const powered = Boolean(entity.data?.powered);
  const progress = Number(entity.data?.progress ?? 1);

  ctx.fillStyle = 'rgba(8,12,22,0.5)';
  ctx.fillRect(-size / 2 - 1, -size / 2 - 1, size + 2, size + 2);
  ctx.fillStyle = powered ? spec.colour : shadeHex(spec.colour, 0.55);
  ctx.fillRect(-size / 2, -size / 2, size, size);

  if (progress < 1) {
    // Under construction: fill from the bottom as the frame goes up.
    ctx.fillStyle = 'rgba(10,14,24,0.55)';
    ctx.fillRect(-size / 2, -size / 2, size, size * (1 - progress));
  }

  if (size > 9) {
    ctx.fillStyle = 'rgba(8,12,22,0.9)';
    ctx.font = `${Math.round(size * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.glyph, 0, size * 0.04);
  }

  if (powered && p.daylight < 0.4) {
    ctx.strokeStyle = 'rgba(95,227,216,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-size / 2 - 2, -size / 2 - 2, size + 4, size + 4);
  }
});

registerFlatPainter('anomaly', (ctx, entity, p) => {
  const anomaly = entity.ref as Anomaly | undefined;
  const documented = Boolean(entity.data?.documented ?? anomaly?.documented);
  const r = Math.max(4, p.tile * 0.42);
  const pulse = documented ? 0 : 0.5 + 0.5 * Math.sin(p.time * 2.4);

  ctx.strokeStyle = documented ? '#7bd88f' : `rgba(255,209,102,${0.55 + pulse * 0.45})`;
  ctx.lineWidth = Math.max(1, r * 0.3);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
  ctx.stroke();
  if (!documented) {
    ctx.strokeStyle = `rgba(255,209,102,${0.25 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.6 + pulse), 0, Math.PI * 2);
    ctx.stroke();
  }
});

registerFlatPainter('marker', (ctx, entity, p) => {
  // Weather cell: a swirling ring so the hazard reads as an area, not a point.
  const intensity = Number(entity.data?.intensity ?? 0.5);
  const r = Math.max(12, p.tile * (1.6 + intensity));
  ctx.strokeStyle = `rgba(255,176,58,${0.3 + intensity * 0.3})`;
  ctx.lineWidth = Math.max(1, p.tile * 0.18);
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 3; a += 0.25) {
    const rad = (r * a) / (Math.PI * 3);
    const x = Math.cos(a + p.time * 2) * rad;
    const y = Math.sin(a + p.time * 2) * rad;
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
});

function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
