import type { ResourceKey, RoverState } from '../types.js';
import { shade } from './sprites.js';

/**
 * The rover, assembled from **parts** rather than drawn as one blob.
 *
 * Each part declares when it applies (`when`), where it sits in the painter
 * order (`order`) and whether it rides the suspension (`sprung`). That makes
 * the rover's look a function of its build and its live state — fit a scanner
 * and the whip antenna appears; fill the hold and crates stack on the deck;
 * take damage and scorch marks show — and it lets a host game add its own
 * hardware with `registerRoverPart` instead of forking the painter.
 */

export interface RoverPaintContext {
  rover: RoverState;
  /** Hull colour, guaranteed #rrggbb. */
  body: string;
  /** Screen-space facing after view rotation. */
  facing: 0 | 1 | 2 | 3;
  /** -1 when the sprite is mirrored (facing left). */
  flip: 1 | -1;
  /** Smooth render clock in seconds. */
  time: number;
  /** 0 = night, 1 = noon. */
  daylight: number;
  moving: boolean;
  mining: boolean;
  /** Wheel rotation angle. */
  spin: number;
  /** In-field mobility kit level, 0..3. */
  mobility: number;
  tracks: boolean;
  /** Battery / durability / hold as 0..1 fractions. */
  charge: number;
  integrity: number;
  load: number;
  /** Heaviest resource in the hold, for crate colour. */
  cargoTop: ResourceKey | null;
  has: { solar: boolean; rtg: boolean; camera: boolean; scanner: boolean; tool: boolean };
}

export interface RoverPart {
  id: string;
  /** Painter order; lower draws first. Defaults to 50. */
  order?: number;
  /** Sprung parts ride the suspension bob/tilt; the wheels and shadow do not. */
  sprung?: boolean;
  when?(p: RoverPaintContext): boolean;
  draw(ctx: CanvasRenderingContext2D, p: RoverPaintContext): void;
}

/** Rover render scale relative to a tile — oversized for a chunky,
 * readable diorama look. */
export const ROVER_SCALE = 1.7;

const parts: RoverPart[] = [];

/** Add or replace a rover part (same id replaces). */
export function registerRoverPart(part: RoverPart): void {
  const i = parts.findIndex((p) => p.id === part.id);
  if (i >= 0) parts[i] = part;
  else parts.push(part);
}

export function unregisterRoverPart(id: string): boolean {
  const i = parts.findIndex((p) => p.id === id);
  if (i < 0) return false;
  parts.splice(i, 1);
  return true;
}

/** Current parts in painter order. */
export function listRoverParts(): RoverPart[] {
  return [...parts].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

/** Compose the paint context from live rover state. */
export function roverPaintContext(
  rover: RoverState,
  daylight: number,
  screenFacing: 0 | 1 | 2 | 3 | undefined,
  time: number,
): RoverPaintContext {
  const { spec, stats } = rover;
  const facing = screenFacing ?? rover.facing;
  const tracks = stats.grip >= 0.8;
  const moving = rover.moveFrom != null;
  let cargoTop: ResourceKey | null = null;
  let most = 0;
  for (const [res, qty] of Object.entries(rover.cargo) as [ResourceKey, number][]) {
    if ((qty ?? 0) > most) {
      most = qty ?? 0;
      cargoTop = res;
    }
  }
  return {
    rover,
    body: cssHex(spec.color || '#c8d6e5'),
    facing,
    flip: facing === 1 || facing === 2 ? -1 : 1,
    time,
    daylight,
    moving,
    mining: !!rover.mining,
    spin: time * (tracks ? 5 : 7),
    mobility: rover.upgrades?.mobility ?? 0,
    tracks,
    charge: stats.batteryCapacity > 0 ? rover.battery / stats.batteryCapacity : 0,
    integrity: stats.durabilityMax > 0 ? rover.durability / stats.durabilityMax : 1,
    load: stats.cargoCapacity > 0 ? rover.cargoUsed / stats.cargoCapacity : 0,
    cargoTop,
    has: {
      solar: stats.solarRate > 0,
      rtg: stats.rtgRate > 0,
      camera: stats.photoQuality > 0,
      scanner: stats.scanRadius > 0,
      tool: stats.miningPower > 0,
    },
  };
}

/**
 * Draw the rover at screen position (x, y) with camera zoom `s`.
 * Vector drawing means it stays crisp at any zoom with no asset pipeline.
 */
export function drawRover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rover: RoverState,
  daylight: number,
  screenFacing?: 0 | 1 | 2 | 3,
  time = 0,
  /** Small presentation-only lean while the vehicle turns between directions. */
  turnLean = 0,
): void {
  const p = roverPaintContext(rover, daylight, screenFacing, time);
  const ordered = listRoverParts();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turnLean);
  ctx.scale(s * ROVER_SCALE * p.flip, s * ROVER_SCALE);
  ctx.lineJoin = 'round';

  // Unsprung parts (shadow, drivetrain) sit on the ground.
  for (const part of ordered) {
    if (part.sprung) continue;
    if (part.when && !part.when(p)) continue;
    ctx.save();
    part.draw(ctx, p);
    ctx.restore();
  }

  // Everything above the wheels bobs and leans with the chassis.
  const bob = p.moving ? Math.sin(p.time * 16) * 0.55 : Math.sin(p.time * 1.8) * 0.14;
  const tilt = p.moving ? Math.sin(p.time * 16) * 0.02 : 0;
  ctx.translate(0, bob);
  ctx.transform(1, 0, tilt, 1, 0, 0);

  for (const part of ordered) {
    if (!part.sprung) continue;
    if (part.when && !part.when(p)) continue;
    ctx.save();
    part.draw(ctx, p);
    ctx.restore();
  }

  ctx.restore();
}

// ── Built-in parts ──────────────────────────────────────────────────────

registerRoverPart({
  id: 'shadow',
  order: 0,
  draw(ctx) {
    const sh = ctx.createRadialGradient(0, 3.5, 2, 0, 3.5, 13);
    sh.addColorStop(0, 'rgba(10,6,20,0.42)');
    sh.addColorStop(1, 'rgba(10,6,20,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(0, 3.5, 13, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();
  },
});

registerRoverPart({
  id: 'tracks',
  order: 10,
  when: (p) => p.tracks,
  draw(ctx, p) {
    // Tread loop with scrolling cleats + spinning road wheels. A mobility
    // kit fits a taller, grippier track.
    const th = 8 + p.mobility * 1.3;
    const rw = 2.1 + p.mobility * 0.35;
    ctx.fillStyle = '#23222b';
    roundRect(ctx, -12, -3.5, 24, th, 3.5);
    ctx.fill();
    ctx.fillStyle = '#3a3844';
    const scroll = (((p.spin * 2) % 2.5) + 2.5) % 2.5;
    for (let i = -10 + scroll; i <= 10; i += 2.5) ctx.fillRect(i, -3.5, 1.1, th);
    for (const wx of [-8, -2.5, 3, 8.5]) {
      ctx.save();
      ctx.translate(wx, 0.5 + (th - 8) * 0.5);
      ctx.rotate(p.spin);
      ctx.fillStyle = '#4d4b59';
      ctx.beginPath();
      ctx.arc(0, 0, rw, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6c6a78';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-rw + 0.5, 0);
      ctx.lineTo(rw - 0.5, 0);
      ctx.moveTo(0, -rw + 0.5);
      ctx.lineTo(0, rw - 0.5);
      ctx.stroke();
      ctx.restore();
    }
  },
});

registerRoverPart({
  id: 'wheels',
  order: 10,
  when: (p) => !p.tracks,
  draw(ctx, p) {
    // Rocker-bogie: suspension arms first, then spinning spoked wheels.
    ctx.strokeStyle = '#8a8f98';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-8, 1);
    ctx.lineTo(-3, -5);
    ctx.lineTo(1, -5);
    ctx.moveTo(1, -5);
    ctx.lineTo(4, -1);
    ctx.lineTo(8, 1);
    ctx.moveTo(0, 1);
    ctx.lineTo(-3, -5);
    ctx.stroke();
    // A mobility kit swaps in larger, knobblier wheels.
    const wr = 3.6 + p.mobility * 0.7;
    for (const wx of [-8, 0, 8]) {
      const wg = ctx.createRadialGradient(wx - 1, 0.5, 0.5, wx, 1.5, wr + 0.4);
      wg.addColorStop(0, '#4a4954');
      wg.addColorStop(1, '#1d1c24');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(wx, 1.5, wr, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(wx, 1.5);
      ctx.rotate(p.spin);
      ctx.strokeStyle = '#15141b';
      ctx.lineWidth = 0.7 + p.mobility * 0.12;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (wr - 0.7), Math.sin(a) * (wr - 0.7));
        ctx.lineTo(Math.cos(a) * wr, Math.sin(a) * wr);
        ctx.stroke();
      }
      ctx.strokeStyle = '#6c6a78';
      ctx.lineWidth = 0.6;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (wr - 1), Math.sin(a) * (wr - 1));
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#9aa0ab';
      ctx.beginPath();
      ctx.arc(wx, 1.5, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});

registerRoverPart({
  id: 'wheel-dust',
  order: 12,
  when: (p) => p.moving,
  draw(ctx, p) {
    // Puffs kicked up at the contact patch while driving.
    for (let i = 0; i < 3; i++) {
      const phase = (p.time * 6 + i * 0.7) % 1;
      const r = 0.8 + phase * 2.6;
      ctx.fillStyle = `rgba(214,186,150,${0.22 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(-9 - phase * 5, 3.2 - phase * 1.6, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});

registerRoverPart({
  id: 'chassis',
  order: 20,
  sprung: true,
  draw(ctx, p) {
    const bg = ctx.createLinearGradient(0, -11, 0, -2);
    bg.addColorStop(0, shade(p.body, 1.22));
    bg.addColorStop(0.55, p.body);
    bg.addColorStop(1, shade(p.body, 0.66));
    ctx.fillStyle = bg;
    roundRect(ctx, -11, -11, 22, 9.5, 1.8);
    ctx.fill();
    // Panel seams.
    ctx.strokeStyle = 'rgba(20,16,40,0.28)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-4, -11);
    ctx.lineTo(-4, -1.5);
    ctx.moveTo(3.5, -11);
    ctx.lineTo(3.5, -1.5);
    ctx.moveTo(-11, -5);
    ctx.lineTo(11, -5);
    ctx.stroke();
    // White top deck.
    ctx.fillStyle = shade(p.body, 1.35);
    roundRect(ctx, -10, -12.2, 20, 2.4, 1);
    ctx.fill();
    // Mobility-kit pips: one amber stud per upgrade level on the deck.
    for (let i = 0; i < p.mobility; i++) {
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(-8.5 + i * 2.2, -11, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});

registerRoverPart({
  id: 'insulation',
  order: 25,
  sprung: true,
  draw(ctx) {
    // Gold multilayer-insulation block at the rear.
    const foil = ctx.createLinearGradient(-11, -9, -6, -3);
    foil.addColorStop(0, '#e8b64c');
    foil.addColorStop(0.5, '#c28d2e');
    foil.addColorStop(1, '#a3721f');
    ctx.fillStyle = foil;
    roundRect(ctx, -10.6, -9.5, 4.6, 6.5, 0.8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,10,0.35)';
    ctx.lineWidth = 0.4;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-10.6, -9.5 + i * 1.6);
      ctx.lineTo(-6, -9.5 + i * 1.6);
      ctx.stroke();
    }
  },
});

registerRoverPart({
  id: 'charge-strip',
  order: 27,
  sprung: true,
  draw(ctx, p) {
    // Five-LED charge strip on the flank: readable state at a glance, and it
    // blinks red once the battery is nearly flat.
    const lit = Math.round(p.charge * 5);
    const alarm = p.charge < 0.2 && Math.sin(p.time * 8) > 0;
    for (let i = 0; i < 5; i++) {
      const on = i < lit;
      ctx.fillStyle = on ? (p.charge < 0.25 ? '#ff6b6b' : '#6fdc8c') : 'rgba(20,24,34,0.6)';
      if (!on && alarm && i === 0) ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(-2.6 + i * 1.4, -4.4, 1, 1.7);
    }
  },
});

registerRoverPart({
  id: 'cargo',
  order: 30,
  sprung: true,
  when: (p) => p.load > 0.02,
  draw(ctx, p) {
    // Crates stack on the rear deck as the hold fills.
    const crates = Math.min(3, Math.ceil(p.load * 3));
    const colour = CARGO_COLOURS[p.cargoTop ?? 'regolith'] ?? '#b08968';
    for (let i = 0; i < crates; i++) {
      const w = 4.2 - i * 0.5;
      const h = 2.4;
      const cx = -6.5 + (i % 2) * 4.4;
      const cy = -12.4 - Math.floor(i / 2) * 2.6;
      ctx.fillStyle = shade(colour, 1.08);
      roundRect(ctx, cx, cy - h, w, h, 0.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,12,28,0.45)';
      ctx.lineWidth = 0.35;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(cx + 0.4, cy - h + 0.6);
      ctx.lineTo(cx + w - 0.4, cy - h + 0.6);
      ctx.stroke();
    }
  },
});

const CARGO_COLOURS: Partial<Record<ResourceKey, string>> = {
  regolith: '#d99a55',
  stone: '#b08968',
  ice: '#a8e8f0',
  iron: '#c96f4a',
  silica: '#f2dfa7',
  copper: '#4fbf9f',
  titanium: '#b9c7d6',
  crystal: '#c77dff',
  sulfur: '#f6d743',
  'iron-plate': '#d98f6a',
  glass: '#cfeaf2',
  water: '#7fc7e8',
  alloy: '#dbe4ef',
};

registerRoverPart({
  id: 'solar',
  order: 40,
  sprung: true,
  when: (p) => p.has.solar,
  draw(ctx, p) {
    for (const [ox, w] of [
      [-22, 10],
      [12, 10],
    ] as [number, number][]) {
      const pg = ctx.createLinearGradient(ox, -10, ox + w, -4);
      pg.addColorStop(0, '#1d3a6f');
      pg.addColorStop(0.5, '#2c569c');
      pg.addColorStop(1, '#1a3260');
      ctx.fillStyle = pg;
      roundRect(ctx, ox, -10, w, 6, 0.8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,190,255,0.35)';
      ctx.lineWidth = 0.4;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(ox + (i * w) / 5, -10);
        ctx.lineTo(ox + (i * w) / 5, -4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(ox, -7);
      ctx.lineTo(ox + w, -7);
      ctx.stroke();
      // Static sheen, plus a glint that tracks across the panel in daylight.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(ox + 1, -10);
      ctx.lineTo(ox + 4, -10);
      ctx.lineTo(ox + 2, -4);
      ctx.lineTo(ox, -4);
      ctx.closePath();
      ctx.fill();
      if (p.daylight > 0.35) {
        const t = (p.time * 0.25) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.16 * p.daylight})`;
        ctx.beginPath();
        ctx.moveTo(ox + t * w, -10);
        ctx.lineTo(ox + t * w + 1.6, -10);
        ctx.lineTo(ox + t * w - 0.4, -4);
        ctx.lineTo(ox + t * w - 2, -4);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Wing struts.
    ctx.strokeStyle = '#8a8f98';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-11, -7);
    ctx.lineTo(-12.5, -7);
    ctx.moveTo(11, -7);
    ctx.lineTo(12.5, -7);
    ctx.stroke();
  },
});

registerRoverPart({
  id: 'rtg',
  order: 40,
  sprung: true,
  when: (p) => p.has.rtg,
  draw(ctx, p) {
    // Waste heat: the fin stack glows at night, when the RTG is the only
    // thing keeping the battery alive.
    if (p.daylight < 0.5) {
      const glow = ctx.createRadialGradient(-14, -5, 0.5, -14, -5, 7);
      glow.addColorStop(0, `rgba(255,140,70,${0.28 * (1 - p.daylight)})`);
      glow.addColorStop(1, 'rgba(255,140,70,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(-14, -5, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    const rg = ctx.createLinearGradient(-16, -9, -12, -2);
    rg.addColorStop(0, '#767c86');
    rg.addColorStop(1, '#3f434c');
    ctx.fillStyle = rg;
    roundRect(ctx, -16, -8.5, 4, 7, 1.6);
    ctx.fill();
    ctx.strokeStyle = '#9aa0ab';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-17, -7.8 + i * 1.8);
      ctx.lineTo(-11.2, -7.8 + i * 1.8);
      ctx.stroke();
    }
  },
});

registerRoverPart({
  id: 'camera-mast',
  order: 50,
  sprung: true,
  when: (p) => p.has.camera,
  draw(ctx) {
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(4.5, -11);
    ctx.lineTo(4.5, -19.5);
    ctx.stroke();
    const hg = ctx.createLinearGradient(1.5, -23, 8, -19);
    hg.addColorStop(0, '#f2f4f8');
    hg.addColorStop(1, '#b9c0cb');
    ctx.fillStyle = hg;
    roundRect(ctx, 1.5, -23, 6.5, 3.8, 1);
    ctx.fill();
    // Stereo eyes + laser dot.
    ctx.fillStyle = '#1a1e28';
    ctx.beginPath();
    ctx.arc(6.7, -21.2, 0.95, 0, Math.PI * 2);
    ctx.arc(4.3, -21.2, 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fd0ff';
    ctx.beginPath();
    ctx.arc(6.7, -21.2, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e05555';
    ctx.beginPath();
    ctx.arc(2.6, -21.9, 0.35, 0, Math.PI * 2);
    ctx.fill();
  },
});

registerRoverPart({
  id: 'dish',
  order: 50,
  sprung: true,
  draw(ctx, p) {
    // High-gain dish (every rover phones home). It sweeps slowly, so a parked
    // rover still has something alive about it.
    ctx.save();
    ctx.translate(-2.5, -13.6);
    ctx.rotate(-0.5 + Math.sin(p.time * 0.4) * 0.22);
    const dg = ctx.createLinearGradient(-2.4, -1, 2.4, 1);
    dg.addColorStop(0, '#e8ecf2');
    dg.addColorStop(1, '#aab2bf');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7c8490';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 2.4);
    ctx.stroke();
    ctx.restore();
  },
});

registerRoverPart({
  id: 'scanner',
  order: 50,
  sprung: true,
  when: (p) => p.has.scanner,
  draw(ctx, p) {
    // Whip antenna with a tip light that pulses as the sounder listens.
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-7.5, -11);
    ctx.lineTo(-8.5, -18.5);
    ctx.stroke();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(p.time * 2.2));
    ctx.fillStyle = `rgba(255,209,102,${pulse})`;
    ctx.beginPath();
    ctx.arc(-8.5, -19, 0.7 + pulse * 0.25, 0, Math.PI * 2);
    ctx.fill();
  },
});

registerRoverPart({
  id: 'tool-arm',
  order: 60,
  sprung: true,
  when: (p) => p.has.tool,
  draw(ctx, p) {
    const swing = p.mining ? Math.sin(p.time * 18) * 1.2 : 0;
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, -6.5);
    ctx.lineTo(14.5, -4);
    ctx.lineTo(17, 0.5 + swing);
    ctx.stroke();
    // Elbow joint.
    ctx.fillStyle = '#5f656e';
    ctx.beginPath();
    ctx.arc(14.5, -4, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Drill head.
    ctx.fillStyle = p.mining ? '#ffb347' : '#767d87';
    ctx.beginPath();
    ctx.moveTo(15.6, -0.4 + swing);
    ctx.lineTo(19.5, 2.4 + swing);
    ctx.lineTo(16, 3.4 + swing);
    ctx.closePath();
    ctx.fill();
    // Chips fly while the drill is biting.
    if (p.mining) {
      for (let i = 0; i < 4; i++) {
        const t = (p.time * 5 + i * 0.25) % 1;
        ctx.fillStyle = `rgba(255,214,150,${0.7 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(18 + t * 4, 2.4 + swing - t * 3.5 + i, 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});

registerRoverPart({
  id: 'damage',
  order: 70,
  sprung: true,
  when: (p) => p.integrity < 0.7,
  draw(ctx, p) {
    // Scorch marks appear as the hull wears; below a third it sparks.
    const wear = 1 - p.integrity;
    ctx.fillStyle = `rgba(30,22,26,${0.28 + wear * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(-5.5, -8, 2.6 * wear + 0.8, 1.5 * wear + 0.5, 0.3, 0, Math.PI * 2);
    ctx.ellipse(6, -6.4, 2.1 * wear + 0.6, 1.2 * wear + 0.4, -0.4, 0, Math.PI * 2);
    ctx.fill();
    if (p.integrity < 0.35) {
      ctx.strokeStyle = 'rgba(60,48,52,0.75)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-2, -10.5);
      ctx.lineTo(0.5, -7.5);
      ctx.lineTo(-1, -5.5);
      ctx.stroke();
      const spark = (p.time * 3) % 1;
      if (spark < 0.22) {
        ctx.fillStyle = `rgba(255,220,140,${1 - spark / 0.22})`;
        ctx.beginPath();
        ctx.arc(0.5 + spark * 3, -7.5 + spark * 4, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});

registerRoverPart({
  id: 'beacon',
  order: 78,
  sprung: true,
  draw(ctx, p) {
    // Status strobe on the deck: steady amber, urgent red when the hull or
    // battery is in trouble.
    const urgent = p.integrity < 0.35 || p.charge < 0.15;
    const period = urgent ? 0.45 : 1.4;
    const on = (p.time % period) / period < 0.28;
    if (!on) return;
    const colour = urgent ? '255,90,90' : '255,190,90';
    const glow = ctx.createRadialGradient(-0.5, -13, 0.2, -0.5, -13, 3.4);
    glow.addColorStop(0, `rgba(${colour},0.85)`);
    glow.addColorStop(1, `rgba(${colour},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(-0.5, -13, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${colour})`;
    ctx.beginPath();
    ctx.arc(-0.5, -13, 0.75, 0, Math.PI * 2);
    ctx.fill();
  },
});

registerRoverPart({
  id: 'headlights',
  order: 80,
  sprung: true,
  when: (p) => p.daylight < 0.35,
  draw(ctx, p) {
    const strength = 1 - p.daylight / 0.35;
    ctx.fillStyle = `rgba(255,244,200,${0.14 * strength})`;
    ctx.beginPath();
    ctx.moveTo(11, -8);
    ctx.lineTo(30, -1);
    ctx.lineTo(30, 9);
    ctx.lineTo(11, -3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,247,214,${0.95 * strength})`;
    ctx.beginPath();
    ctx.arc(10.8, -7, 0.9, 0, Math.PI * 2);
    ctx.arc(10.8, -4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  },
});

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cssHex(c: string): string {
  return c.startsWith('#') && c.length === 7 ? c : '#c8d6e5';
}
