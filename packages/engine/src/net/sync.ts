import type {
  Anomaly,
  BodyDef,
  MissionState,
  PartDef,
  PhotoMeta,
  ResourceKey,
  RoverSpec,
} from '../types.js';
import { BODIES } from '../world/bodies.js';
import { PARTS } from '../parts/catalog.js';
import { makeId } from '../util/rng.js';

export interface TakeonProfile {
  userId: string;
  credits: number;
  inventory: Partial<Record<ResourceKey, number>>;
  discoveries: number;
}

export interface MissionSummary {
  id: string;
  bodyId: string;
  roverName: string;
  status: MissionState['status'];
  updated: number;
}

/**
 * Persistence boundary. The engine and UI only talk to this interface, so
 * a host game (e.g. Landnam) can supply its own implementation backed by
 * its own database.
 */
export interface SyncAdapter {
  readonly mode: 'remote' | 'local';
  getCatalog(): Promise<{ parts: PartDef[]; bodies: BodyDef[] }>;
  getProfile(): Promise<TakeonProfile>;
  listRovers(): Promise<RoverSpec[]>;
  saveRover(spec: RoverSpec): Promise<RoverSpec>;
  deleteRover(id: string): Promise<void>;
  listMissions(): Promise<MissionSummary[]>;
  loadMission(id: string): Promise<MissionState | null>;
  saveMission(state: MissionState, roverName: string): Promise<void>;
  /** Bank mission yield into the profile; returns credits earned. */
  completeMission(state: MissionState, banked: Partial<Record<ResourceKey, number>>): Promise<number>;
  uploadPhoto(meta: PhotoMeta, dataUrl: string | null, missionId: string): Promise<void>;
  recordDiscovery(anomaly: Anomaly, bodyId: string, missionId: string): Promise<void>;
  /** Spend credits (customiser purchase). Resolves false if unaffordable. */
  spendCredits(amount: number): Promise<boolean>;
}

/** Credit value of each banked resource unit. */
export const RESOURCE_VALUE: Record<ResourceKey, number> = {
  regolith: 1,
  stone: 2,
  ice: 4,
  iron: 5,
  silica: 4,
  copper: 6,
  titanium: 10,
  crystal: 25,
  sulfur: 5,
  // Refined goods are worth more than their inputs — refining pays.
  'iron-plate': 14,
  glass: 11,
  water: 10,
  alloy: 32,
};

/**
 * Price a custom resource key for mission payouts (`missionCredits`, and the
 * PocketBase spoke's mirrored calculation — update both, same as any other
 * `RESOURCE_VALUE` change). Pair with `registerResource` (`world/materials.js`)
 * to also give the key a display name.
 */
export function registerResourceValue(key: ResourceKey, credits: number): void {
  RESOURCE_VALUE[key] = credits;
}

export const DISCOVERY_CREDITS = 120;
export const PHOTO_CREDITS_PER_QUALITY = 2;
/** Enough for a full tier-1/2 science build (tool + camera + scanner). */
export const STARTING_CREDITS = 1600;

/** Deterministic mission payout — mirrored by the backend. */
export function missionCredits(state: MissionState, banked: Partial<Record<ResourceKey, number>>): number {
  let total = 0;
  const cargo = state.rover.cargo;
  for (const [res, qty] of Object.entries({ ...banked }) as [ResourceKey, number][]) {
    total += (RESOURCE_VALUE[res] ?? 0) * (qty ?? 0);
  }
  for (const [res, qty] of Object.entries(cargo) as [ResourceKey, number][]) {
    total += (RESOURCE_VALUE[res] ?? 0) * (qty ?? 0);
  }
  for (const a of state.anomalies) {
    if (a.documented) total += DISCOVERY_CREDITS;
  }
  for (const p of state.photos) {
    total += Math.round(p.quality * PHOTO_CREDITS_PER_QUALITY);
  }
  return total;
}

// ── Local (offline / standalone) adapter ─────────────────────────────────

const LS_KEY = 'takeon.v1';

interface LocalStore {
  profile: TakeonProfile;
  rovers: RoverSpec[];
  missions: Record<string, MissionState & { roverName?: string; updated?: number }>;
  photos: (PhotoMeta & { missionId: string; dataUrl?: string | null })[];
}

/**
 * localStorage-backed adapter so the game is fully playable with no
 * backend at all. Also the fallback when the PocketBase spoke is down.
 */
export class LocalSync implements SyncAdapter {
  readonly mode = 'local' as const;
  private storage: Storage | null;

  constructor(storage?: Storage) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  private load(): LocalStore {
    const empty: LocalStore = {
      profile: { userId: 'local', credits: STARTING_CREDITS, inventory: {}, discoveries: 0 },
      rovers: [],
      missions: {},
      photos: [],
    };
    if (!this.storage) return empty;
    try {
      const raw = this.storage.getItem(LS_KEY);
      if (!raw) return empty;
      return { ...empty, ...JSON.parse(raw) };
    } catch {
      return empty;
    }
  }

  private persist(s: LocalStore): void {
    try {
      this.storage?.setItem(LS_KEY, JSON.stringify(s));
    } catch (err) {
      console.warn('[takeon] local save failed', err);
    }
  }

  async getCatalog() {
    return { parts: PARTS, bodies: BODIES };
  }

  async getProfile() {
    return this.load().profile;
  }

  async listRovers() {
    return this.load().rovers;
  }

  async saveRover(spec: RoverSpec) {
    const s = this.load();
    if (!spec.id) spec = { ...spec, id: makeId('rov') };
    const i = s.rovers.findIndex((r) => r.id === spec.id);
    if (i >= 0) s.rovers[i] = spec;
    else s.rovers.push(spec);
    this.persist(s);
    return spec;
  }

  async deleteRover(id: string) {
    const s = this.load();
    s.rovers = s.rovers.filter((r) => r.id !== id);
    this.persist(s);
  }

  async listMissions() {
    const s = this.load();
    return Object.values(s.missions).map((m) => ({
      id: m.id,
      bodyId: m.bodyId,
      roverName: m.roverName ?? m.rover.spec.name,
      status: m.status,
      updated: m.updated ?? 0,
    }));
  }

  async loadMission(id: string) {
    return this.load().missions[id] ?? null;
  }

  async saveMission(state: MissionState, roverName: string) {
    const s = this.load();
    s.missions[state.id] = { ...state, roverName, updated: Date.now() };
    this.persist(s);
  }

  async completeMission(state: MissionState, banked: Partial<Record<ResourceKey, number>>) {
    const s = this.load();
    const credits = missionCredits(state, banked);
    s.profile.credits += credits;
    s.profile.discoveries += state.anomalies.filter((a) => a.documented).length;
    for (const src of [banked, state.rover.cargo]) {
      for (const [res, qty] of Object.entries(src) as [ResourceKey, number][]) {
        if (!qty) continue;
        s.profile.inventory[res] = (s.profile.inventory[res] ?? 0) + qty;
      }
    }
    const m = s.missions[state.id];
    if (m) m.status = 'complete';
    this.persist(s);
    return credits;
  }

  async uploadPhoto(meta: PhotoMeta, dataUrl: string | null, missionId: string) {
    const s = this.load();
    s.photos.push({ ...meta, missionId, dataUrl });
    // Keep local storage bounded: newest 40 photos with pixels.
    const withData = s.photos.filter((p) => p.dataUrl);
    if (withData.length > 40) {
      for (const p of withData.slice(0, withData.length - 40)) p.dataUrl = null;
    }
    this.persist(s);
  }

  async recordDiscovery() {
    // Counted in completeMission for local play.
  }

  async spendCredits(amount: number) {
    const s = this.load();
    if (s.profile.credits < amount) return false;
    s.profile.credits -= amount;
    this.persist(s);
    return true;
  }

  /** Local extra: fetch stored photo gallery. */
  listPhotos(): (PhotoMeta & { missionId: string; dataUrl?: string | null })[] {
    return this.load().photos;
  }
}

// ── PocketBase spoke adapter ─────────────────────────────────────────────

export interface PocketBaseSyncOptions {
  /** TakeOn spoke backend, e.g. http://127.0.0.1:8094 */
  baseUrl: string;
  /**
   * JWT from the *shared* Star Sailors backend (hub owns identity).
   * Provide a getter so token refresh is the host app's concern.
   */
  getToken: () => string | null;
}

/**
 * Talks to the TakeOn PocketBase spoke's custom /api/takeon/* routes.
 * The spoke verifies the shared-backend JWT server-side (hub-and-spoke
 * pattern, same as Landnam/Saily).
 */
export class PocketBaseSync implements SyncAdapter {
  readonly mode = 'remote' as const;
  private base: string;
  private getToken: () => string | null;

  constructor(opts: PocketBaseSyncOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.getToken = opts.getToken;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`takeon backend ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  getCatalog() {
    return this.req<{ parts: PartDef[]; bodies: BodyDef[] }>('/api/takeon/catalog');
  }

  getProfile() {
    return this.req<TakeonProfile>('/api/takeon/profile');
  }

  listRovers() {
    return this.req<RoverSpec[]>('/api/takeon/rovers');
  }

  saveRover(spec: RoverSpec) {
    return this.req<RoverSpec>('/api/takeon/rovers', {
      method: 'POST',
      body: JSON.stringify(spec),
    });
  }

  async deleteRover(id: string) {
    await this.req(`/api/takeon/rovers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listMissions() {
    return this.req<MissionSummary[]>('/api/takeon/missions');
  }

  async loadMission(id: string) {
    try {
      return await this.req<MissionState>(`/api/takeon/missions/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }

  async saveMission(state: MissionState, roverName: string) {
    await this.req('/api/takeon/missions', {
      method: 'POST',
      body: JSON.stringify({ state, roverName }),
    });
  }

  async completeMission(state: MissionState, banked: Partial<Record<ResourceKey, number>>) {
    const r = await this.req<{ credits: number }>('/api/takeon/missions/complete', {
      method: 'POST',
      body: JSON.stringify({ state, banked }),
    });
    return r.credits;
  }

  async uploadPhoto(meta: PhotoMeta, dataUrl: string | null, missionId: string) {
    await this.req('/api/takeon/photos', {
      method: 'POST',
      body: JSON.stringify({ meta, dataUrl, missionId }),
    });
  }

  async recordDiscovery(anomaly: Anomaly, bodyId: string, missionId: string) {
    await this.req('/api/takeon/discoveries', {
      method: 'POST',
      body: JSON.stringify({
        anomalyId: anomaly.id,
        type: anomaly.type,
        name: anomaly.name,
        bodyId,
        missionId,
        pos: anomaly.pos,
      }),
    });
  }

  async spendCredits(amount: number) {
    try {
      await this.req('/api/takeon/credits/spend', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      return true;
    } catch {
      return false;
    }
  }
}
