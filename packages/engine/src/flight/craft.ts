/**
 * A craft is a stack of sections along one axis, drawn as a lathe: each
 * section is a run of lit rings, so the same data reads correctly from
 * behind (in flight) and from the side (in orbit). Hosts describe their own
 * vehicle as sections; nothing here knows what a "rocket" is.
 *
 * This file is data only. The Go core (`go/flight_draw.go`) lays the craft out
 * into shapes, so web, iOS and Android draw the same craft from one look.
 */

export interface CraftSection {
  id: string;
  /** Length along the axis, in craft units. */
  length: number;
  /** Radius at the tail end and at the nose end. */
  r0: number;
  r1: number;
  color: string;
  /** A painted ring around the middle of the section. */
  band?: string;
}

export interface FlightCraftLook {
  /** Tail first, nose last. */
  sections: CraftSection[];
  fins?: { count: number; span: number; length: number; color: string };
  /** Strap-on boosters around the tail. */
  boosters?: { count: number; radius: number; length: number; color: string };
  /** Exhaust colour. */
  plume?: string;
  /** Overall size multiplier. */
  scale?: number;
}

export function defaultCraftLook(): FlightCraftLook {
  return {
    sections: [
      { id: 'engine', length: 0.28, r0: 0.2, r1: 0.26, color: '#3c4658' },
      { id: 'tank', length: 0.9, r0: 0.26, r1: 0.26, color: '#eef2f6', band: '#2f6fd0' },
      { id: 'payload', length: 0.5, r0: 0.26, r1: 0.22, color: '#dfe6ee' },
      { id: 'nose', length: 0.45, r0: 0.22, r1: 0.02, color: '#2f6fd0' },
    ],
    fins: { count: 4, span: 0.24, length: 0.42, color: '#2f6fd0' },
    plume: '#7fd4ff',
    scale: 1.25,
  };
}

export type Vec3 = [number, number, number];

/** Pinhole camera looking along +z. Screen y grows downward. */
export interface FlightCamera {
  cx: number;
  cy: number;
  /** Focal length in pixels. */
  f: number;
}

export function project(cam: FlightCamera, p: Vec3): { x: number; y: number; s: number } {
  const z = Math.max(0.05, p[2]);
  const s = cam.f / z;
  return { x: cam.cx + p[0] * s, y: cam.cy - p[1] * s, s };
}
