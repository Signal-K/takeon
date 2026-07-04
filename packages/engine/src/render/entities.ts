import type { Anomaly, RoverState, Structure } from '../types.js';
import { shade } from './sprites.js';

/**
 * Procedural entity sprites, drawn as vector shapes at screen coords.
 * `s` is the camera zoom (1 tile = 32*s px wide). Keeping these procedural
 * means the customiser's part choices are visible on the rover with no
 * asset pipeline at all.
 */

export function drawRover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rover: RoverState,
  daylight: number,
): void {
  const { spec, stats } = rover;
  const flip = rover.facing === 1 || rover.facing === 2 ? -1 : 1;
  const hasSolar = stats.solarRate > 0;
  const hasRtg = stats.rtgRate > 0;
  const hasCam = stats.photoQuality > 0;
  const hasTool = stats.miningPower > 0;
  const tracks = stats.grip >= 0.8;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * flip, s);

  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(0, 3.5, 11, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wheels / tracks.
  ctx.fillStyle = '#26262b';
  if (tracks) {
    ctx.fillRect(-11, -2, 22, 6);
    ctx.fillStyle = '#3a3a41';
    for (let i = -9; i <= 9; i += 3) ctx.fillRect(i, -2, 1.4, 6);
  } else {
    for (const wx of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.arc(wx, 1.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a4a52';
      ctx.beginPath();
      ctx.arc(wx, 1.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26262b';
    }
  }

  // Body.
  const body = spec.color || '#c8d6e5';
  ctx.fillStyle = body;
  ctx.fillRect(-10, -9, 20, 8);
  ctx.fillStyle = shade(cssHex(body), 0.75);
  ctx.fillRect(-10, -3.5, 20, 2.5);
  ctx.fillStyle = shade(cssHex(body), 1.15);
  ctx.fillRect(-10, -9, 20, 1.6);

  // Solar wings.
  if (hasSolar) {
    ctx.fillStyle = '#1d3a5f';
    ctx.fillRect(-19, -8, 8, 5);
    ctx.fillRect(11, -8, 8, 5);
    ctx.strokeStyle = '#3f6ea8';
    ctx.lineWidth = 0.5;
    for (const ox of [-19, 11]) {
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(ox + i * 2, -8);
        ctx.lineTo(ox + i * 2, -3);
        ctx.stroke();
      }
    }
  }
  // RTG fin stack at the back.
  if (hasRtg) {
    ctx.fillStyle = '#555a60';
    ctx.fillRect(-14, -8, 3.4, 6);
    ctx.fillStyle = '#7c828a';
    for (let i = 0; i < 3; i++) ctx.fillRect(-14.8, -7.5 + i * 2, 5, 0.8);
  }

  // Camera mast.
  if (hasCam) {
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(4, -9);
    ctx.lineTo(4, -16);
    ctx.stroke();
    ctx.fillStyle = '#dfe6ee';
    ctx.fillRect(2, -19, 5, 3.4);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(5.6, -18.2, 1.2, 1.8);
  }

  // Tool arm.
  if (hasTool) {
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(9, -5);
    ctx.lineTo(14, -2);
    ctx.stroke();
    ctx.fillStyle = rover.mining ? '#ffb347' : '#6f767e';
    ctx.beginPath();
    ctx.moveTo(14, -3.5);
    ctx.lineTo(17.5, -0.5);
    ctx.lineTo(14, 1);
    ctx.closePath();
    ctx.fill();
  }

  // Headlight beam at night.
  if (daylight < 0.35) {
    ctx.fillStyle = 'rgba(255,244,200,0.16)';
    ctx.beginPath();
    ctx.moveTo(10, -6);
    ctx.lineTo(26, 0);
    ctx.lineTo(26, 8);
    ctx.lineTo(10, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,244,200,0.9)';
    ctx.fillRect(9.4, -6.4, 1.6, 1.6);
  }

  ctx.restore();
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
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  switch (st.type) {
    case 'solar-array': {
      ctx.fillStyle = '#8b929b';
      ctx.fillRect(-1, -6, 2, 9);
      ctx.save();
      ctx.transform(1, -0.3, 0, 1, 0, 0);
      ctx.fillStyle = '#1d3a5f';
      ctx.fillRect(-11, -12, 22, 8);
      ctx.strokeStyle = '#3f6ea8';
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
        ctx.fillStyle = `rgba(255,120,100,${0.10 + blink * 0.08})`;
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
    case 'habitat-frame': {
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
        ctx.moveTo(Math.cos(Math.PI + a * 0) * 0, 1); // center post base
        ctx.lineTo(Math.cos(Math.PI + a) * -11, 1 + Math.sin(Math.PI + a) * -11);
        ctx.stroke();
      }
      break;
    }
  }
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
        [-5, 9, '#b48fd9'],
        [0, 13, '#c9a6ea'],
        [5, 7, '#9a76c2'],
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
      ctx.fillStyle = '#cfe6ef';
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
