import { FieldTerrain, type FieldDeposit, type FieldOptions } from './terrain.js';
import { FieldVehicle, type FieldInput } from './vehicle.js';
import { FieldRenderer, type FieldRenderOptions } from './render.js';

/**
 * Mount a drivable field on a canvas (KES-541).
 *
 * Touch: put a thumb down anywhere and drag; the rover drives the way you
 * drag. Keys: arrows or WASD. The host draws its own HUD over the canvas and
 * calls `scan()` from its own button; this owns only the world.
 */

export interface FieldSceneOptions extends FieldOptions, FieldRenderOptions {
  /** Draw and drive a rover. Off gives a still site picture. */
  rover?: boolean;
  /** Stick radius in CSS px: a drag this far is full throttle. */
  stickRadius?: number;
}

export interface FieldSceneHandle {
  terrain: FieldTerrain;
  vehicle: FieldVehicle | null;
  renderer: FieldRenderer;
  /** Pulse a scan from the rover (or the camera centre) and reveal deposits in range. */
  scan(radius?: number): FieldDeposit[];
  /** The revealed deposit under the rover, if any. */
  depositUnderRover(): FieldDeposit | null;
  /** Drive from code (tests, demos, a host's own stick). */
  setInput(input: FieldInput): void;
  /** Called after every frame. */
  onFrame: ((dt: number) => void) | null;
  destroy(): void;
}

export function mountFieldScene(canvas: HTMLCanvasElement, opts: FieldSceneOptions = {}): FieldSceneHandle {
  const terrain = new FieldTerrain(opts);
  const vehicle = opts.rover === false ? null : new FieldVehicle(terrain);
  const renderer = new FieldRenderer(canvas, terrain, vehicle, opts);
  const stickR = opts.stickRadius ?? 52;
  const keys = new Set<string>();
  let codeInput: FieldInput | null = null;
  let pointer: { id: number; ox: number; oy: number; x: number; y: number } | null = null;

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    renderer.resize(r.width || canvas.clientWidth || 390, r.height || canvas.clientHeight || 844, window.devicePixelRatio || 1);
  };
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(canvas);

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent) => {
    if (pointer || !vehicle) return;
    const p = local(e);
    pointer = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = local(e);
    pointer.x = p.x;
    pointer.y = p.y;
  };
  const up = (e: PointerEvent) => {
    if (pointer && e.pointerId === pointer.id) pointer = null;
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
    if (pointer) {
      const dx = pointer.x - pointer.ox, dy = pointer.y - pointer.oy;
      const d = Math.hypot(dx, dy);
      if (d < 6) return { x: 0, y: 0 };
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

  let raf = 0;
  let last = performance.now();
  const handle: FieldSceneHandle = {
    terrain,
    vehicle,
    renderer,
    onFrame: null,
    scan(radius = 18) {
      const at = vehicle ?? { x: renderer.cx, y: renderer.cy };
      return renderer.scan(at.x, at.y, radius);
    },
    depositUnderRover() {
      if (!vehicle) return null;
      const d = terrain.depositAt(vehicle.x, vehicle.y);
      return d && renderer.revealed.has(d.id) ? d : null;
    },
    setInput(input) {
      codeInput = input.x || input.y ? input : null;
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    },
  };

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (vehicle) {
      vehicle.setInput(readInput());
      vehicle.update(dt);
    }
    renderer.stick = pointer ? { ox: pointer.ox, oy: pointer.oy, x: pointer.x, y: pointer.y } : null;
    renderer.draw(dt);
    handle.onFrame?.(dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return handle;
}
