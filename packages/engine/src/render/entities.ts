import type { Anomaly, Structure } from '../types.js';
import { shade } from './sprites.js';
import { roundRect } from './rover.js';

/**
 * Procedural entity art for structures, launches and anomalies, drawn as
 * vector shapes at screen coords. `s` is the camera zoom (1 tile = 32*s px
 * wide). Vector drawing means everything stays crisp at any zoom with no
 * asset pipeline.
 *
 * The rover lives in `rover.ts`, where it is assembled from registered parts.
 */

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
