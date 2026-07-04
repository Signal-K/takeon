import type { Camera } from '../render/camera.js';

export interface ControlCallbacks {
  /** Direction is screen-relative; the game maps it through view rotation. */
  onMove: (dir: 0 | 1 | 2 | 3) => void;
  onAction: (action: 'mine' | 'photo' | 'scan' | 'rotate' | 'place') => void;
  onTileTap: (canvasX: number, canvasY: number) => void;
}

/**
 * Keyboard + pointer/touch bindings for the mission canvas.
 * - Arrows/WASD: drive (screen-relative; view rotation is handled upstream)
 * - E/Space: mine · P: photo · X: scan · R: rotate view · B: place block
 * - Drag: pan · Wheel / pinch: zoom · Tap: tap-to-drive target
 */
export class Controls {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private cb: ControlCallbacks;
  private detach: (() => void)[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragged = false;
  private held = new Set<string>();
  private repeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, cb: ControlCallbacks) {
    this.canvas = canvas;
    this.camera = camera;
    this.cb = cb;
    this.attach();
  }

  private attach(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.tabIndex = 0;

    const kd = (e: KeyboardEvent) => this.onKey(e, true);
    const ku = (e: KeyboardEvent) => this.onKey(e, false);
    c.addEventListener('keydown', kd);
    c.addEventListener('keyup', ku);
    this.detach.push(() => c.removeEventListener('keydown', kd));
    this.detach.push(() => c.removeEventListener('keyup', ku));

    const pd = (e: PointerEvent) => this.onPointerDown(e);
    const pm = (e: PointerEvent) => this.onPointerMove(e);
    const pu = (e: PointerEvent) => this.onPointerUp(e);
    c.addEventListener('pointerdown', pd);
    c.addEventListener('pointermove', pm);
    c.addEventListener('pointerup', pu);
    c.addEventListener('pointercancel', pu);
    this.detach.push(() => {
      c.removeEventListener('pointerdown', pd);
      c.removeEventListener('pointermove', pm);
      c.removeEventListener('pointerup', pu);
      c.removeEventListener('pointercancel', pu);
    });

    const wh = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.camera.setZoom(this.camera.zoom * f, e.clientX - rect.left, e.clientY - rect.top);
    };
    c.addEventListener('wheel', wh, { passive: false });
    this.detach.push(() => c.removeEventListener('wheel', wh));

    // Held-key repeat for continuous driving.
    this.repeatTimer = setInterval(() => {
      for (const k of this.held) {
        const dir = keyDir(k);
        if (dir !== null) this.cb.onMove(dir);
      }
    }, 90);
    this.detach.push(() => {
      if (this.repeatTimer) clearInterval(this.repeatTimer);
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    const dir = keyDir(k);
    if (dir !== null) {
      e.preventDefault();
      if (down && !this.held.has(k)) this.cb.onMove(dir);
      if (down) this.held.add(k);
      else this.held.delete(k);
      return;
    }
    if (!down) return;
    if (k === 'e' || k === ' ') {
      e.preventDefault();
      this.cb.onAction('mine');
    } else if (k === 'p') {
      this.cb.onAction('photo');
    } else if (k === 'x') {
      this.cb.onAction('scan');
    } else if (k === 'r') {
      this.cb.onAction('rotate');
    } else if (k === 'b') {
      this.cb.onAction('place');
    }
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragged = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (this.pointers.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragged = true;
      if (this.dragged) this.camera.panBy(dx, dy);
    } else if (this.pointers.size === 2) {
      this.pointers.set(e.pointerId, cur);
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - rect.left;
        const my = (a.y + b.y) / 2 - rect.top;
        this.camera.setZoom((this.camera.zoom * d) / this.pinchDist, mx, my);
      }
      this.pinchDist = d;
      this.dragged = true;
      return;
    }
    this.pointers.set(e.pointerId, cur);
  }

  private onPointerUp(e: PointerEvent): void {
    const wasTap = !this.dragged && this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
    if (wasTap) {
      const rect = this.canvas.getBoundingClientRect();
      this.cb.onTileTap(e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  dispose(): void {
    for (const d of this.detach) d();
    this.detach = [];
  }
}

function keyDir(k: string): 0 | 1 | 2 | 3 | null {
  switch (k) {
    case 'arrowright':
    case 'd':
      return 0; // +x (screen down-right)
    case 'arrowdown':
    case 's':
      return 1; // +y (screen down-left)
    case 'arrowleft':
    case 'a':
      return 2; // -x
    case 'arrowup':
    case 'w':
      return 3; // -y
    default:
      return null;
  }
}
