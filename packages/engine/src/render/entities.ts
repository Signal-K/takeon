import type { Anomaly, RoverState, Structure } from '../types.js';
import { shade } from './sprites.js';

/**
 * Procedural entity art, drawn as vector shapes at screen coords.
 * `s` is the camera zoom (1 tile = 32*s px wide). Vector drawing means the
 * rover stays crisp at any zoom with no asset pipeline.
 */

/** Rover render scale relative to a tile — oversized for a chunky,
 * readable diorama look. */
const ROVER_SCALE = 1.7;

export function drawRover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rover: RoverState,
  daylight: number,
  screenFacing?: 0 | 1 | 2 | 3,
  time = 0,
): void {
  const { spec, stats } = rover;
  const facing = screenFacing ?? rover.facing;
  const flip = facing === 1 || facing === 2 ? -1 : 1;
  const hasSolar = stats.solarRate > 0;
  const hasRtg = stats.rtgRate > 0;
  const hasCam = stats.photoQuality > 0;
  const hasScanner = stats.scanRadius > 0;
  const hasTool = stats.miningPower > 0;
  const tracks = stats.grip >= 0.8;
  const mob = rover.upgrades?.mobility ?? 0; // in-field mobility kit level
  const body = cssHex(spec.color || '#c8d6e5');

  // Animation state: wheels spin and the chassis bounces while driving; a
  // slow idle sway keeps it feeling alive when parked.
  const moving = rover.moveFrom != null;
  const spin = time * (tracks ? 5 : 7);
  const bob = moving ? Math.sin(time * 16) * 0.55 : Math.sin(time * 1.8) * 0.14;
  const tiltDir = moving ? Math.sin(time * 16) * 0.02 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * ROVER_SCALE * flip, s * ROVER_SCALE);
  ctx.lineJoin = 'round';

  // Ground shadow (does not bob — it's on the ground).
  const sh = ctx.createRadialGradient(0, 3.5, 2, 0, 3.5, 13);
  sh.addColorStop(0, 'rgba(10,6,20,0.42)');
  sh.addColorStop(1, 'rgba(10,6,20,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(0, 3.5, 13, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Drivetrain ────────────────────────────────────────────────────────
  if (tracks) {
    // Tread loop with scrolling cleats + spinning road wheels. A mobility
    // kit fits a taller, grippier track.
    const th = 8 + mob * 1.3;
    const rw = 2.1 + mob * 0.35;
    ctx.fillStyle = '#23222b';
    roundRect(ctx, -12, -3.5, 24, th, 3.5);
    ctx.fill();
    ctx.fillStyle = '#3a3844';
    const scroll = ((spin * 2) % 2.5 + 2.5) % 2.5;
    for (let i = -10 + scroll; i <= 10; i += 2.5) ctx.fillRect(i, -3.5, 1.1, th);
    for (const wx of [-8, -2.5, 3, 8.5]) {
      ctx.save();
      ctx.translate(wx, 0.5 + (th - 8) * 0.5);
      ctx.rotate(spin);
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
  } else {
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
    const wr = 3.6 + mob * 0.7;
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
      ctx.rotate(spin);
      // Treads.
      ctx.strokeStyle = '#15141b';
      ctx.lineWidth = 0.7 + mob * 0.12;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (wr - 0.7), Math.sin(a) * (wr - 0.7));
        ctx.lineTo(Math.cos(a) * wr, Math.sin(a) * wr);
        ctx.stroke();
      }
      // Hub + spokes.
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
  }

  // Everything above the wheels bobs and leans with the chassis.
  ctx.translate(0, bob);
  ctx.transform(1, 0, tiltDir, 1, 0, 0);

  // ── Body ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, -11, 0, -2);
  bg.addColorStop(0, shade(body, 1.22));
  bg.addColorStop(0.55, body);
  bg.addColorStop(1, shade(body, 0.66));
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
  ctx.fillStyle = shade(body, 1.35);
  roundRect(ctx, -10, -12.2, 20, 2.4, 1);
  ctx.fill();
  // Mobility-kit pips: one amber stud per upgrade level on the deck.
  for (let i = 0; i < mob; i++) {
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(-8.5 + i * 2.2, -11, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
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

  // ── Power ─────────────────────────────────────────────────────────────
  if (hasSolar) {
    for (const [ox, w] of [[-22, 10], [12, 10]] as [number, number][]) {
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
      // Sheen.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(ox + 1, -10);
      ctx.lineTo(ox + 4, -10);
      ctx.lineTo(ox + 2, -4);
      ctx.lineTo(ox, -4);
      ctx.closePath();
      ctx.fill();
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
  }
  if (hasRtg) {
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
  }

  // ── Mast, dish, scanner ───────────────────────────────────────────────
  if (hasCam) {
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
  }
  // High-gain dish (always — every rover phones home).
  ctx.save();
  ctx.translate(-2.5, -13.6);
  ctx.rotate(-0.5);
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
  if (hasScanner) {
    // Whip antenna with tip light.
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-7.5, -11);
    ctx.lineTo(-8.5, -18.5);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(-8.5, -19, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Tool arm ──────────────────────────────────────────────────────────
  if (hasTool) {
    const digging = !!rover.mining;
    const bob = digging ? Math.sin(time * 18) * 1.2 : 0;
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, -6.5);
    ctx.lineTo(14.5, -4);
    ctx.lineTo(17, 0.5 + bob);
    ctx.stroke();
    // Elbow joint.
    ctx.fillStyle = '#5f656e';
    ctx.beginPath();
    ctx.arc(14.5, -4, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Drill head.
    ctx.fillStyle = digging ? '#ffb347' : '#767d87';
    ctx.beginPath();
    ctx.moveTo(15.6, -0.4 + bob);
    ctx.lineTo(19.5, 2.4 + bob);
    ctx.lineTo(16, 3.4 + bob);
    ctx.closePath();
    ctx.fill();
  }

  // Headlights at night.
  if (daylight < 0.35) {
    ctx.fillStyle = 'rgba(255,244,200,0.14)';
    ctx.beginPath();
    ctx.moveTo(11, -8);
    ctx.lineTo(30, -1);
    ctx.lineTo(30, 9);
    ctx.lineTo(11, -3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,247,214,0.95)';
    ctx.beginPath();
    ctx.arc(10.8, -7, 0.9, 0, Math.PI * 2);
    ctx.arc(10.8, -4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

export function drawStructure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: Structure,
  time: number,
  daylight: number,
  powered = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(10,6,20,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Energised aura for anything on the power grid.
  if (powered && st.type !== 'generator' && st.type !== 'solar-array') {
    const pulse = 0.5 + Math.sin(time * 4 + st.pos.x) * 0.5;
    ctx.fillStyle = `rgba(120,230,255,${0.1 + pulse * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(0, 3, 9, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  switch (st.type) {
    case 'solar-array': {
      ctx.fillStyle = '#8b929b';
      ctx.fillRect(-1, -6, 2, 9);
      ctx.save();
      ctx.transform(1, -0.3, 0, 1, 0, 0);
      const pg = ctx.createLinearGradient(-11, -12, 11, -4);
      pg.addColorStop(0, '#1d3a6f');
      pg.addColorStop(0.5, '#2c569c');
      pg.addColorStop(1, '#1a3260');
      ctx.fillStyle = pg;
      ctx.fillRect(-11, -12, 22, 8);
      ctx.strokeStyle = 'rgba(150,190,255,0.35)';
      ctx.lineWidth = 0.6;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(-11 + i * 4.4, -12);
        ctx.lineTo(-11 + i * 4.4, -4);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'beacon': {
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(-1, -16, 2, 19);
      ctx.fillStyle = '#6f767e';
      ctx.beginPath();
      ctx.moveTo(-4, 3);
      ctx.lineTo(4, 3);
      ctx.lineTo(0, -2);
      ctx.closePath();
      ctx.fill();
      const blink = (Math.sin(time * 4) + 1) / 2;
      ctx.fillStyle = `rgba(255,80,80,${0.35 + blink * 0.65})`;
      ctx.beginPath();
      ctx.arc(0, -17, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (daylight < 0.4) {
        ctx.fillStyle = `rgba(255,120,100,${0.1 + blink * 0.08})`;
        ctx.beginPath();
        ctx.arc(0, -17, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'drill-rig': {
      ctx.strokeStyle = '#8a9099';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-8, 2);
      ctx.lineTo(0, -14);
      ctx.lineTo(8, 2);
      ctx.stroke();
      const bob = Math.sin(time * 6) * 1.5;
      ctx.fillStyle = '#c9a44a';
      ctx.fillRect(-1.6, -12 + bob, 3.2, 10);
      ctx.fillStyle = '#5b6068';
      ctx.fillRect(-5, -15, 10, 3);
      break;
    }
    case 'cache': {
      ctx.fillStyle = '#7a6f5a';
      ctx.fillRect(-7, -8, 14, 10);
      ctx.fillStyle = '#968a70';
      ctx.fillRect(-7, -8, 14, 2.4);
      ctx.strokeStyle = '#4e463a';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-7, -8, 14, 10);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 2);
      ctx.stroke();
      break;
    }
    case 'refinery': {
      ctx.fillStyle = '#5a4a52';
      ctx.fillRect(-8, -9, 16, 12);
      ctx.fillStyle = '#6e5a63';
      ctx.fillRect(-8, -9, 16, 2.6);
      const glow = 0.55 + Math.sin(time * 5) * 0.25;
      ctx.fillStyle = `rgba(255,140,60,${glow})`;
      ctx.fillRect(-4, -3, 8, 4.6);
      ctx.strokeStyle = '#3a2f36';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-8, -9, 16, 12);
      ctx.fillStyle = '#8a929b';
      ctx.fillRect(4, -16, 3, 8);
      ctx.fillStyle = `rgba(255,180,120,${glow * 0.5})`;
      ctx.beginPath();
      ctx.arc(5.5, -17.5, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'habitat-frame': {
      const prog = Math.max(0, Math.min(1, st.progress ?? 0));
      // Panels fill the dome from the base up as construction proceeds.
      if (prog > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-11, 1 - 11 * prog, 22, 11 * prog);
        ctx.clip();
        ctx.fillStyle = 'rgba(150,200,235,0.35)';
        ctx.beginPath();
        ctx.arc(0, 1, 11, Math.PI, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = '#b8c0c9';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 1, 11, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 1, 7, Math.PI, 0);
      ctx.stroke();
      for (const a of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75]) {
        ctx.beginPath();
        ctx.moveTo(0, 1);
        ctx.lineTo(Math.cos(Math.PI + a) * -11, 1 + Math.sin(Math.PI + a) * -11);
        ctx.stroke();
      }
      break;
    }
    case 'habitat': {
      // Finished pressurised dome with a lit airlock and roof beacon.
      const dg = ctx.createLinearGradient(0, -11, 0, 2);
      dg.addColorStop(0, '#e9eef4');
      dg.addColorStop(1, '#a7b2c0');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(0, 2, 11, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#79828f';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 2, 11, Math.PI, 0);
      ctx.moveTo(-11, 2);
      ctx.lineTo(11, 2);
      ctx.stroke();
      // Warm windows.
      ctx.fillStyle = `rgba(255,220,150,${0.6 + Math.sin(time * 2) * 0.12})`;
      ctx.beginPath();
      ctx.arc(-4.5, -1, 1.6, 0, Math.PI * 2);
      ctx.arc(4.5, -1, 1.6, 0, Math.PI * 2);
      ctx.fill();
      // Airlock.
      ctx.fillStyle = '#5f6773';
      roundRect(ctx, -2.2, -3.5, 4.4, 5.5, 1);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      roundRect(ctx, -1.4, -2.6, 2.8, 3.4, 0.8);
      ctx.fill();
      // Roof beacon.
      const blink = 0.5 + Math.sin(time * 3) * 0.5;
      ctx.fillStyle = `rgba(120,255,180,${0.4 + blink * 0.6})`;
      ctx.beginPath();
      ctx.arc(0, -11.5, 1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'generator': {
      // Reactor block with cooling fins and a pulsing core.
      ctx.fillStyle = '#4c525b';
      roundRect(ctx, -8, -10, 16, 12, 1.4);
      ctx.fill();
      ctx.fillStyle = '#3a3f47';
      for (let i = -7; i < 7; i += 2.4) ctx.fillRect(i, -10, 1.1, 12);
      ctx.strokeStyle = '#2b2f36';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-8, -10, 16, 12);
      const core = 0.5 + Math.sin(time * 4) * 0.5;
      const cg = ctx.createRadialGradient(0, -4, 0.5, 0, -4, 5);
      cg.addColorStop(0, `rgba(140,255,210,${0.7 + core * 0.3})`);
      cg.addColorStop(1, 'rgba(60,200,150,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, -4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(180,255,225,${0.8})`;
      ctx.beginPath();
      ctx.arc(0, -4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Vent stacks.
      ctx.fillStyle = '#6b727c';
      ctx.fillRect(-6.5, -14, 2.4, 4.4);
      ctx.fillRect(4.1, -14, 2.4, 4.4);
      break;
    }
    case 'pylon': {
      // Lattice mast that relays the grid, with an arc at the tip.
      ctx.strokeStyle = '#98a0aa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3.5, 2);
      ctx.lineTo(-1, -14);
      ctx.moveTo(3.5, 2);
      ctx.lineTo(1, -14);
      for (let yy = -12; yy <= 0; yy += 3) {
        const f = (yy + 13) / 15;
        ctx.moveTo(-3.5 * f, yy);
        ctx.lineTo(3.5 * f, yy - 1.4);
        ctx.moveTo(3.5 * f, yy);
        ctx.lineTo(-3.5 * f, yy - 1.4);
      }
      ctx.stroke();
      // Cross-arms.
      ctx.beginPath();
      ctx.moveTo(-4.5, -12);
      ctx.lineTo(4.5, -12);
      ctx.stroke();
      const arc = 0.4 + Math.abs(Math.sin(time * 6)) * 0.6;
      ctx.fillStyle = `rgba(140,230,255,${arc})`;
      ctx.beginPath();
      ctx.arc(0, -14.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'launch-pad': {
      const ready = st.cooldownUntil == null || time >= st.cooldownUntil;
      // Concrete deck with hazard trim.
      ctx.fillStyle = '#5b5f66';
      roundRect(ctx, -10, -3, 20, 6, 1.2);
      ctx.fill();
      ctx.fillStyle = '#3f434a';
      roundRect(ctx, -10, -3, 20, 2, 1.2);
      ctx.fill();
      ctx.fillStyle = '#e8b84a';
      for (let i = -9; i < 9; i += 3) ctx.fillRect(i, 1.4, 1.5, 1.4);
      // Gantry truss + swing arm.
      ctx.strokeStyle = '#8a929b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-7, 2);
      ctx.lineTo(-7, -18);
      ctx.moveTo(-4, 2);
      ctx.lineTo(-4, -18);
      for (let yy = -16; yy <= 0; yy += 3) {
        ctx.moveTo(-7, yy);
        ctx.lineTo(-4, yy - 1.5);
      }
      ctx.moveTo(-4, -12);
      ctx.lineTo(0, -12);
      ctx.stroke();
      if (ready) {
        // Rocket stood up on the cradle, cleared to launch.
        const bodyGrad = ctx.createLinearGradient(-2.4, 0, 2.4, 0);
        bodyGrad.addColorStop(0, '#c9d2dc');
        bodyGrad.addColorStop(0.5, '#ffffff');
        bodyGrad.addColorStop(1, '#aab3bf');
        ctx.fillStyle = bodyGrad;
        roundRect(ctx, -2.4, -16, 4.8, 15, 1.6);
        ctx.fill();
        ctx.fillStyle = '#c1442e';
        ctx.beginPath();
        ctx.moveTo(-2.4, -15);
        ctx.lineTo(0, -21);
        ctx.lineTo(2.4, -15);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-2.4, -3);
        ctx.lineTo(-4.2, 0);
        ctx.lineTo(-2.4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(2.4, -3);
        ctx.lineTo(4.2, 0);
        ctx.lineTo(2.4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7fd4ff';
        ctx.beginPath();
        ctx.arc(0, -10, 1.1, 0, Math.PI * 2);
        ctx.fill();
        const blink = 0.5 + Math.sin(time * 5) * 0.5;
        ctx.fillStyle = `rgba(90,240,140,${0.4 + blink * 0.6})`;
        ctx.beginPath();
        ctx.arc(6, -14, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Refuelling: empty cradle venting vapour, amber hold light.
        ctx.strokeStyle = '#6f767e';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-2.5, -1);
        ctx.lineTo(-2.5, -10);
        ctx.moveTo(2.5, -1);
        ctx.lineTo(2.5, -10);
        ctx.stroke();
        const puff = (time * 3) % 6;
        ctx.fillStyle = `rgba(220,235,245,${Math.max(0, 0.5 - puff * 0.08)})`;
        ctx.beginPath();
        ctx.arc(0, -8 - puff, 1.6 + puff * 0.3, 0, Math.PI * 2);
        ctx.fill();
        const blink = 0.5 + Math.sin(time * 4) * 0.5;
        ctx.fillStyle = `rgba(240,180,70,${0.35 + blink * 0.5})`;
        ctx.beginPath();
        ctx.arc(6, -14, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * A cargo rocket climbing away from a launch pad. `age` is seconds since the
 * launch fired (fades out by ~3s). Drawn by the renderer as a scene overlay.
 */
export function drawLaunch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  age: number,
): void {
  const alpha = age < 2.4 ? 1 : Math.max(0, 1 - (age - 2.4) / 0.6);
  if (alpha <= 0) return;
  const rise = Math.pow(Math.min(1, age / 2.2), 0.85) * 92;
  const thrusting = age < 2.1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  // Ground smoke billow at the pad.
  const smoke = Math.min(1, age / 1.8);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + age;
    const sr = 3 + smoke * 8;
    ctx.fillStyle = `rgba(214,208,216,${0.38 * (1 - smoke)})`;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * smoke * 9, 3 + Math.sin(a) * smoke * 2.5, sr, sr * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(0, -rise);
  if (thrusting) {
    const fl = 8 + Math.sin(age * 40) * 2.5;
    const fg = ctx.createLinearGradient(0, 2, 0, 2 + fl);
    fg.addColorStop(0, 'rgba(255,240,180,0.95)');
    fg.addColorStop(0.4, 'rgba(255,150,60,0.8)');
    fg.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-2.4, 2);
    ctx.lineTo(2.4, 2);
    ctx.lineTo(0, 2 + fl);
    ctx.closePath();
    ctx.fill();
  }
  // Fins.
  ctx.fillStyle = '#c1442e';
  ctx.beginPath();
  ctx.moveTo(-2.2, 0);
  ctx.lineTo(-4.4, 3);
  ctx.lineTo(-2.2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2.2, 0);
  ctx.lineTo(4.4, 3);
  ctx.lineTo(2.2, 3);
  ctx.closePath();
  ctx.fill();
  // Body + nose + window.
  const bg = ctx.createLinearGradient(-2.4, 0, 2.4, 0);
  bg.addColorStop(0, '#c9d2dc');
  bg.addColorStop(0.5, '#ffffff');
  bg.addColorStop(1, '#aab3bf');
  ctx.fillStyle = bg;
  roundRect(ctx, -2.4, -9, 4.8, 12, 1.8);
  ctx.fill();
  ctx.fillStyle = '#c1442e';
  ctx.beginPath();
  ctx.moveTo(-2.4, -8);
  ctx.lineTo(0, -13.5);
  ctx.lineTo(2.4, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7fd4ff';
  ctx.beginPath();
  ctx.arc(0, -4.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  a: Anomaly,
  time: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  switch (a.type) {
    case 'wreckage':
      ctx.fillStyle = '#6b6f76';
      ctx.beginPath();
      ctx.moveTo(-8, 2);
      ctx.lineTo(-2, -6);
      ctx.lineTo(3, -3);
      ctx.lineTo(8, 1);
      ctx.lineTo(2, 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3c3f45';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(0, 2);
      ctx.stroke();
      break;
    case 'crystal-formation':
      for (const [ox, h, tint] of [
        [-5, 9, '#c77dff'],
        [0, 13, '#dba4ff'],
        [5, 7, '#9d4edd'],
      ] as [number, number, string][]) {
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(ox - 2.5, 2);
        ctx.lineTo(ox, 2 - h);
        ctx.lineTo(ox + 2.5, 2);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'magnetic-anomaly': {
      const pulse = (Math.sin(time * 3) + 1) / 2;
      ctx.strokeStyle = `rgba(120,180,255,${0.25 + pulse * 0.4})`;
      ctx.lineWidth = 1.2;
      for (let r = 3; r <= 9; r += 3) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r + pulse * 2, (r + pulse * 2) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#4a4e55';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fossil-traces':
      ctx.strokeStyle = '#8f7f68';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 3.5; t += 0.3) {
        const r = 1 + t * 1.1;
        const px = Math.cos(t) * r;
        const py = (Math.sin(t) * r) / 2;
        if (t === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    case 'ice-vent': {
      ctx.fillStyle = '#a8e8f0';
      ctx.beginPath();
      ctx.ellipse(0, 1, 5, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      const puff = (time * 8) % 12;
      ctx.fillStyle = `rgba(230,245,252,${Math.max(0, 0.7 - puff * 0.06)})`;
      ctx.beginPath();
      ctx.arc(1, -2 - puff, 2 + puff * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'monolith':
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(-2.5, -16, 5, 18);
      ctx.fillStyle = 'rgba(140,160,255,0.25)';
      ctx.fillRect(-2.5, -16, 1, 18);
      break;
  }

  // Marker for scanned-but-undocumented anomalies.
  if (a.scanned && !a.documented) {
    const bob = Math.sin(time * 3) * 2;
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', 0, -20 + bob);
  }
  ctx.restore();
}
