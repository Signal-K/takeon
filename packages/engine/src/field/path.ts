import type { Vec2 } from '../types.js';
import type { FieldTerrain } from './terrain.js';

/**
 * Route planning for tap-to-drive (KES-543). Pure and DOM-free.
 *
 * A* over a 1 m grid of the field. A cell is closed if the ground there is
 * steeper than the rover can climb or a boulder (grown by the rover's half
 * width) sits on it; open cells cost more the steeper they are, so the rover
 * prefers to go round a dune rather than over it. The raw grid path is then
 * pulled tight (a waypoint is dropped whenever the straight line past it stays
 * on open ground), so the rover drives in a few clean legs, not a staircase.
 */

export interface PlanOptions {
  /** Steepest rise per metre the rover may cross. */
  maxGrade: number;
  /** Rover half width, metres: how far to keep clear of boulders. */
  clearance: number;
  /** Stop once within this distance of the goal (e.g. laser range), metres. */
  within?: number;
  /** Give up after expanding this many cells. */
  budget?: number;
}

export class FieldPlanner {
  readonly n: number;
  /** 0 = open, 1 = closed; slope cost per cell. */
  private readonly closed: Uint8Array;
  private readonly cost: Float32Array;

  constructor(readonly terrain: FieldTerrain, readonly opts: PlanOptions) {
    const n = (this.n = Math.floor(terrain.size));
    this.closed = new Uint8Array(n * n);
    this.cost = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const s = terrain.slope(i + 0.5, j + 0.5);
        const k = j * n + i;
        this.cost[k] = 1 + s * 4;
        if (s > opts.maxGrade * 0.9 || i < 2 || j < 2 || i >= n - 2 || j >= n - 2) this.closed[k] = 1;
      }
    for (const b of terrain.boulders) {
      const r = b.r + opts.clearance;
      for (let j = Math.floor(b.y - r); j <= Math.ceil(b.y + r); j++)
        for (let i = Math.floor(b.x - r); i <= Math.ceil(b.x + r); i++) {
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          if (Math.hypot(i + 0.5 - b.x, j + 0.5 - b.y) < r) this.closed[j * n + i] = 1;
        }
    }
  }

  /** Is the ground at (x, y) open to the rover? */
  open(x: number, y: number): boolean {
    const i = Math.floor(x), j = Math.floor(y);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.closed[j * this.n + i];
  }

  /**
   * Waypoints from `from` toward `to`, ending on open ground no farther than
   * `within` from the goal (or at the nearest reachable cell). Empty if the
   * rover cannot get anywhere closer.
   */
  plan(from: Vec2, to: Vec2): Vec2[] {
    const n = this.n, within = this.opts.within ?? 0.6;
    const start = this.cellOf(from), goal = { x: to.x, y: to.y };
    const total = n * n;
    const g = new Float32Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const heap = new MinHeap();
    const si = start.j * n + start.i;
    g[si] = 0;
    heap.push(si, this.h(start.i, start.j, goal));
    let best = si, bestD = Infinity, expanded = 0;
    const budget = this.opts.budget ?? 40000;
    const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.size && expanded++ < budget) {
      const cur = heap.pop();
      const ci = cur % n, cj = (cur / n) | 0;
      const d = Math.hypot(ci + 0.5 - goal.x, cj + 0.5 - goal.y);
      if (d < bestD) { bestD = d; best = cur; }
      if (d <= within) { best = cur; break; }
      for (const [di, dj, step] of D8) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const k = nj * n + ni;
        if (this.closed[k]) continue;
        // No corner cutting past a closed cell.
        if (di && dj && (this.closed[cj * n + ni] || this.closed[nj * n + ci])) continue;
        const ng = g[cur] + step * this.cost[k];
        if (ng < g[k]) {
          g[k] = ng;
          came[k] = cur;
          heap.push(k, ng + this.h(ni, nj, goal));
        }
      }
    }
    if (best === si) return [];
    const cells: Vec2[] = [];
    for (let c = best; c !== -1; c = came[c]) cells.push({ x: (c % n) + 0.5, y: ((c / n) | 0) + 0.5 });
    cells.reverse();
    // End on the exact goal point when it is open and in reach, not a cell centre.
    const end = cells[cells.length - 1];
    if (Math.hypot(goal.x - end.x, goal.y - end.y) < 1.5 && within <= 1 && this.open(goal.x, goal.y) && this.clear(end, goal)) cells[cells.length - 1] = goal;
    return this.smooth([{ x: from.x, y: from.y }, ...cells.slice(1)]).slice(1);
  }

  /** Is the straight segment a→b on open ground all the way? */
  clear(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / 0.4);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.open(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  private smooth(pts: Vec2[]): Vec2[] {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  private cellOf(p: Vec2): { i: number; j: number } {
    return { i: Math.max(0, Math.min(this.n - 1, Math.floor(p.x))), j: Math.max(0, Math.min(this.n - 1, Math.floor(p.y))) };
  }

  private h(i: number, j: number, goal: Vec2): number {
    return Math.hypot(i + 0.5 - goal.x, j + 0.5 - goal.y);
  }
}

/** Binary min-heap of (id, priority). */
class MinHeap {
  private ids: number[] = [];
  private pr: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, p: number): void {
    const { ids, pr } = this;
    let i = ids.length;
    ids.push(id); pr.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pr[up] <= p) break;
      ids[i] = ids[up]; pr[i] = pr[up];
      i = up;
    }
    ids[i] = id; pr[i] = p;
  }
  pop(): number {
    const { ids, pr } = this;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pr.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && pr[c + 1] < pr[c]) c++;
        if (pr[c] >= lastP) break;
        ids[i] = ids[c]; pr[i] = pr[c];
        i = c;
      }
      ids[i] = lastId; pr[i] = lastP;
    }
    return top;
  }
}
