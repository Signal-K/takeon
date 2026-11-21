import { FieldTerrain, type FieldDeposit, type FieldOptions } from './terrain.js';
import { FieldVehicle, type FieldInput } from './vehicle.js';
import { FieldRenderer, type FieldCamera, type FieldRenderOptions } from './render.js';
import { FieldMiner, FieldOrbiter, ORBIT_LASER, ROVER_LASER } from './miner.js';
import { oreColour } from './meshes.js';
import { FieldPlanner } from './path.js';

/**
 * Mount a playable field on a canvas (KES-541, KES-543).
 *
 * `mode: 'surface'` drives a rover by command: tap the ground and it plans a
 * route round rocks and steep ground and drives there; tap scanned ore and it
 * drives into laser range and mines it until it is empty. Arrows/WASD still
 * steer by hand and cancel the order. `mode: 'orbit'` flies the mining ship on
 * a low pass: drag to steer (up is north), and a quick tap on scanned ore aims
 * the laser there. The host draws its own HUD and calls `scan()` and `laser()`
 * from its own buttons; pass `overlay` (a transparent canvas over this one) to
 * get the route, the order marker, the drag ring and pointers to off-screen ore.
 */

/** What the rover has been told to do. */
export interface FieldOrder {
  kind: 'move' | 'mine';
  x: number;
  y: number;
  deposit?: FieldDeposit;
  /** Set once the rover is at the ore and the laser is cutting. */
  mining?: boolean;
}

export interface FieldSceneOptions extends FieldOptions, FieldRenderOptions {
  mode?: FieldCamera;
  /**
   * The rover in surface mode: a Landnam/TakeOn `RoverSpec` (built part for
   * part like the iso rover), a fit-out, or true for the stock rover. `false`
   * gives a still site picture.
   */
  rover?: FieldRenderOptions['rover'];
  /** Stick radius in CSS px: a drag this far is full throttle. */
  stickRadius?: number;
  /** A transparent 2D canvas laid over the field for the stick ring and ore pointers. */
  overlay?: HTMLCanvasElement;
  /** Hold size in units. The laser stops when it is full and the cargo bed fills toward it. */
  capacity?: number;
}

export interface FieldSceneHandle {
  mode: FieldCamera;
  terrain: FieldTerrain;
  vehicle: FieldVehicle | null;
  orbiter: FieldOrbiter | null;
  miner: FieldMiner;
  renderer: FieldRenderer;
  /** Pulse a scan from the rover or ship and reveal deposits in range. */
  scan(radius?: number): FieldDeposit[];
  /** Hold the laser on (true) or off. It locks onto the nearest scanned ore in range. */
  laser(on: boolean): void;
  /** The scanned deposit the rover is at or the laser is on, if any. */
  depositUnderRover(): FieldDeposit | null;
  /** Drive from code (tests, demos, a host's own stick). */
  setInput(input: FieldInput): void;
  /** Order the rover to a ground point, or to mine the scanned ore there. Returns false if no route. */
  command(x: number, y: number): boolean;
  /** The rover's current order, if any. */
  readonly order: FieldOrder | null;
  /** Called when an order starts, finishes (null) or fails ('blocked'). */
  onOrder: ((order: FieldOrder | null, why?: 'done' | 'blocked') => void) | null;
  /** Called after every frame. */
  onFrame: ((dt: number) => void) | null;
  destroy(): void;
}

export function mountFieldScene(canvas: HTMLCanvasElement, opts: FieldSceneOptions = {}): FieldSceneHandle {
  const mode = opts.mode ?? 'surface';
  const terrain = new FieldTerrain(opts);
  const vehicle = mode === 'surface' && opts.rover !== false ? new FieldVehicle(terrain) : null;
  const orbiter = mode === 'orbit' ? new FieldOrbiter(terrain) : null;
  const renderer = new FieldRenderer(canvas, terrain, vehicle, { ...opts, camera: mode });
  if (orbiter) renderer.attachOrbiter(orbiter);
  const miner = new FieldMiner(terrain, renderer.revealed, mode === 'orbit' ? ORBIT_LASER : ROVER_LASER);
  const full = new Map(terrain.deposits.map(d => [d.id, miner.left.get(d.id) ?? 1]));
  renderer.oreLeft = id => (miner.left.get(id) ?? 0) / (full.get(id) || 1);
  const stickR = opts.stickRadius ?? 52;
  const keys = new Set<string>();
  let codeInput: FieldInput | null = null;
  let laserOn = false;
  let aim: { x: number; y: number } | null = null;
  let aimUntil = 0;
  let pointer: { id: number; ox: number; oy: number; x: number; y: number; t: number; moved: number } | null = null;
  let order: FieldOrder | null = null;
  let refusal: { x: number; y: number; until: number } | null = null;
  let planner: FieldPlanner | null = null;
  const plannerFor = () => planner ??= new FieldPlanner(terrain, { maxGrade: vehicle!.spec.maxGrade, clearance: vehicle!.spec.width * 0.55 });
  /** Route the rover to the current order; false if there is nowhere closer to go. */
  const route = (): boolean => {
    if (!vehicle || !order) return false;
    const p = plannerFor();
    const within = order.kind === 'mine' && order.deposit ? Math.max(1, ROVER_LASER.range * 0.7) : 0.6;
    const opts = p.opts;
    (opts as { within?: number }).within = within;
    const path = p.plan(vehicle, order);
    const already = Math.hypot(order.x - vehicle.x, order.y - vehicle.y) <= within;
    if (!path.length && !already) return false;
    vehicle.follow(path);
    return true;
  };
  const finish = (why: 'done' | 'blocked') => {
    order = null;
    handle.onOrder?.(null, why);
  };
  const command = (x: number, y: number): boolean => {
    if (!vehicle) return false;
    const dep = terrain.deposits.find(d => renderer.revealed.has(d.id) && (miner.left.get(d.id) ?? 0) > 0 && Math.hypot(d.x - x, d.y - y) <= d.r + 2);
    order = dep ? { kind: 'mine', x: dep.x, y: dep.y, deposit: dep } : { kind: 'move', x, y };
    if (!route()) {
      refusal = { x, y, until: performance.now() + 900 };
      finish('blocked');
      return false;
    }
    handle.onOrder?.(order);
    return true;
  };
  if (vehicle) {
    let retried = false;
    vehicle.onArrive = () => {
      retried = false;
      if (!order) return;
      if (order.kind === 'mine') order.mining = true; else finish('done');
    };
    vehicle.onStuck = () => {
      if (!order) return;
      if (!retried && route()) { retried = true; return; }
      retried = false;
      finish('blocked');
    };
  }
  const overlay = opts.overlay ?? null;
  const octx = overlay?.getContext('2d') ?? null;
  let cssW = 390, cssH = 844, dpr = 1;

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    cssW = r.width || canvas.clientWidth || 390;
    cssH = r.height || canvas.clientHeight || 844;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.resize(cssW, cssH, dpr);
    if (overlay) {
      overlay.width = Math.round(cssW * dpr);
      overlay.height = Math.round(cssH * dpr);
    }
  };
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(canvas);

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent) => {
    if (pointer) return;
    const p = local(e);
    pointer = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, t: performance.now(), moved: 0 };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = local(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.moved = Math.max(pointer.moved, Math.hypot(p.x - pointer.ox, p.y - pointer.oy));
  };
  const up = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const tap = pointer.moved < 14 && performance.now() - pointer.t < 450;
    // On the surface a tap is an order: drive there, or mine the ore there.
    if (tap && vehicle) {
      const g = renderer.pick(pointer.x, pointer.y);
      if (g) command(g.x, g.y);
    }
    // A quick tap in orbit aims the laser at the ore under the finger.
    if (mode === 'orbit' && tap) {
      const g = renderer.pick(pointer.x, pointer.y);
      if (g) {
        aim = g;
        aimUntil = performance.now() + 2500;
      }
    }
    pointer = null;
  };
  const keyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
  const keyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  const readInput = (): FieldInput => {
    if (codeInput) return codeInput;
    if (pointer && !vehicle) {
      const dx = pointer.x - pointer.ox, dy = pointer.y - pointer.oy;
      const d = Math.hypot(dx, dy);
      if (d < 8) return { x: 0, y: 0 };
      const k = Math.min(1, d / stickR) / d;
      return { x: dx * k, y: dy * k };
    }
    let x = 0, y = 0;
    if (keys.has('arrowleft') || keys.has('a')) x -= 1;
    if (keys.has('arrowright') || keys.has('d')) x += 1;
    if (keys.has('arrowup') || keys.has('w')) y -= 1;
    if (keys.has('arrowdown') || keys.has('s')) y += 1;
    return { x, y };
  };

  /** The emitter's ground point: the rover, or the ship's footprint. */
  const emitter = () => vehicle ?? orbiter ?? terrain.landing;

  const drawOverlay = () => {
    if (!octx || !overlay) return;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cssW, cssH);
    // Pointers to scanned ore off screen, Out There green.
    const at = emitter();
    for (const d of terrain.deposits) {
      if (!renderer.revealed.has(d.id) || (miner.left.get(d.id) ?? 0) <= 0) continue;
      const p = renderer.project(d.x, d.y);
      // Keep pointers clear of the host's gauge panel (top) and thumb buttons (bottom).
      const pad = 34, top = Math.min(160, cssH * 0.2), bottom = Math.min(210, cssH * 0.26);
      if (p.front && p.x > pad && p.x < cssW - pad && p.y > top && p.y < cssH - bottom) continue;
      const cx = cssW / 2, cy = (top + cssH - bottom) / 2;
      let dx = p.x - cx, dy = p.y - cy;
      if (!p.front) { dx = -dx; dy = -dy; }
      const s = Math.min((cssW / 2 - pad) / Math.abs(dx || 1e-3), (dy < 0 ? cy - top : cssH - bottom - cy) / Math.abs(dy || 1e-3));
      const x = cx + dx * s, y = cy + dy * s;
      const a = Math.atan2(dy, dx);
      const [r, g, b] = oreColour(d.resource).map(c => Math.round(c * 255));
      octx.save();
      octx.translate(x, y);
      octx.rotate(a);
      octx.fillStyle = `rgb(${r},${g},${b})`;
      octx.strokeStyle = '#000';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(14, 0); octx.lineTo(-6, -10); octx.lineTo(-2, 0); octx.lineTo(-6, 10); octx.closePath();
      octx.stroke(); octx.fill();
      octx.restore();
      const dist = Math.round(Math.hypot(d.x - at.x, d.y - at.y));
      octx.font = 'italic 700 14px "Exo 2", system-ui, sans-serif';
      octx.textAlign = 'center';
      octx.lineWidth = 3;
      octx.strokeStyle = 'rgba(0,0,0,0.8)';
      const tx = x - Math.cos(a) * 26, ty = y - Math.sin(a) * 22 + 5;
      octx.strokeText(`${dist} m`, tx, ty);
      octx.fillStyle = '#fff';
      octx.fillText(`${dist} m`, tx, ty);
    }
    // The order: a dotted route from the rover and a marker at the goal.
    const now = performance.now();
    if (vehicle && order) {
      const [r, g, b] = order.deposit ? oreColour(order.deposit.resource).map(c => Math.round(c * 255)) : [255, 255, 255];
      const pts = [{ x: vehicle.x, y: vehicle.y }, ...(vehicle.route ?? [])];
      octx.save();
      octx.setLineDash([2, 9]);
      octx.lineCap = 'round';
      octx.lineWidth = 6;
      octx.strokeStyle = 'rgba(0,0,0,0.55)';
      const path = () => {
        octx.beginPath();
        pts.forEach((p, i) => { const s = renderer.project(p.x, p.y, terrain.height(p.x, p.y) + 0.15); if (i) octx.lineTo(s.x, s.y); else octx.moveTo(s.x, s.y); });
      };
      if (pts.length > 1) { path(); octx.stroke(); octx.lineWidth = 3; octx.strokeStyle = `rgb(${r},${g},${b})`; path(); octx.stroke(); }
      octx.restore();
      const m = renderer.project(order.x, order.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      const rad = order.deposit ? 26 + pulse * 4 : 14 + pulse * 3;
      octx.save();
      octx.translate(m.x, m.y);
      octx.scale(1, 0.62);
      octx.lineWidth = 5; octx.strokeStyle = 'rgba(0,0,0,0.6)';
      octx.beginPath(); octx.arc(0, 0, rad, 0, Math.PI * 2); octx.stroke();
      octx.lineWidth = 3; octx.strokeStyle = `rgb(${r},${g},${b})`;
      octx.beginPath(); octx.arc(0, 0, rad, 0, Math.PI * 2); octx.stroke();
      if (!order.deposit) { octx.fillStyle = `rgb(${r},${g},${b})`; octx.beginPath(); octx.arc(0, 0, 4, 0, Math.PI * 2); octx.fill(); }
      octx.restore();
    }
    // A refused tap: a red cross where there is no way through.
    if (refusal && now < refusal.until) {
      const m = renderer.project(refusal.x, refusal.y);
      const a = (refusal.until - now) / 900;
      octx.save();
      octx.translate(m.x, m.y);
      octx.globalAlpha = Math.min(1, a * 2);
      octx.lineCap = 'round';
      for (const [w, c] of [[8, 'rgba(0,0,0,0.7)'], [4, '#ff4d4d']] as const) {
        octx.lineWidth = w; octx.strokeStyle = c;
        octx.beginPath(); octx.moveTo(-10, -10); octx.lineTo(10, 10); octx.moveTo(10, -10); octx.lineTo(-10, 10); octx.stroke();
      }
      octx.restore();
    }
    // Drag ring and knob (orbit only; the rover takes orders).
    if (pointer && pointer.moved >= 8 && !vehicle) {
      octx.lineWidth = 2;
      octx.strokeStyle = 'rgba(255,255,255,0.55)';
      octx.beginPath();
      octx.arc(pointer.ox, pointer.oy, stickR, 0, Math.PI * 2);
      octx.stroke();
      const dx = pointer.x - pointer.ox, dy = pointer.y - pointer.oy, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, stickR / d);
      octx.fillStyle = 'rgba(255,255,255,0.9)';
      octx.beginPath();
      octx.arc(pointer.ox + dx * k, pointer.oy + dy * k, 18, 0, Math.PI * 2);
      octx.fill();
    }
  };

  let raf = 0;
  let last = performance.now();
  const handle: FieldSceneHandle = {
    mode,
    terrain,
    vehicle,
    orbiter,
    miner,
    renderer,
    onFrame: null,
    scan(radius) {
      const at = emitter();
      return renderer.scan(at.x, at.y, radius ?? (mode === 'orbit' ? 90 : 18));
    },
    laser(on) {
      laserOn = on;
    },
    depositUnderRover() {
      if (miner.target) return miner.target;
      if (!vehicle) return null;
      const d = terrain.depositAt(vehicle.x, vehicle.y);
      return d && renderer.revealed.has(d.id) ? d : null;
    },
    setInput(input) {
      codeInput = input.x || input.y ? input : null;
    },
    command,
    get order() { return order; },
    onOrder: null,
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      renderer.destroy();
    },
  };

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const input = readInput();
    if (vehicle && order && (input.x || input.y)) finish('done');
    vehicle?.setInput(input);
    vehicle?.update(dt);
    orbiter?.setInput(input);
    orbiter?.update(dt);
    let aimed = aim && now < aimUntil ? aim : null;
    // A mine order holds the laser on its deposit until it is empty.
    const mining = order?.kind === 'mine' && order.mining && order.deposit ? order.deposit : null;
    if (mining) aimed = { x: mining.x, y: mining.y };
    const at = emitter();
    const cap = opts.capacity ?? Infinity;
    const holdFull = miner.total >= cap - 1e-6;
    const cut = miner.update(dt, !holdFull && (laserOn || !!aimed), at.x, at.y, aimed ?? undefined);
    if (cut && miner.total > cap) {
      // Trim the last step so the hold never reads over its size.
      const over = miner.total - cap;
      miner.hold.set(cut.resource, (miner.hold.get(cut.resource) ?? 0) - over);
      miner.left.set(miner.target!.id, (miner.left.get(miner.target!.id) ?? 0) + over);
    }
    renderer.cargoFill = Number.isFinite(cap) && cap > 0 ? miner.total / cap : 0;
    if (mining && ((miner.left.get(mining.id) ?? 0) <= 0 || !miner.firing)) finish(holdFull || miner.firing || (miner.left.get(mining.id) ?? 0) <= 0 ? 'done' : 'blocked');
    const t = miner.firing ? miner.target : null;
    renderer.beam = t
      ? { from: renderer.beam?.from ?? [at.x, terrain.height(at.x, at.y), at.y], to: [t.x, terrain.height(t.x, t.y) + 0.3, t.y], colour: oreColour(t.resource) }
      : null;
    renderer.stick = pointer && !vehicle ? { ox: pointer.ox, oy: pointer.oy, x: pointer.x, y: pointer.y } : null;
    renderer.draw(dt);
    drawOverlay();
    handle.onFrame?.(dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return handle;
}
