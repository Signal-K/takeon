'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  computeStats,
  getBody,
  LocalSync,
  type MissionSummary,
  type PhotoMeta,
  type RoverSpec,
  type TakeonProfile,
} from '@takeon/engine';
import { useSync } from '../lib/sync-context';

type GalleryPhoto = PhotoMeta & { missionId: string; dataUrl?: string | null };

export default function GaragePage() {
  const { sync, ready } = useSync();
  const [profile, setProfile] = useState<TakeonProfile | null>(null);
  const [rovers, setRovers] = useState<RoverSpec[]>([]);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);

  const refresh = useCallback(async () => {
    if (!ready) return;
    try {
      const [p, r, m] = await Promise.all([sync.getProfile(), sync.listRovers(), sync.listMissions()]);
      setProfile(p);
      setRovers(r);
      setMissions(m);
      if (sync instanceof LocalSync) {
        setPhotos(sync.listPhotos().filter((ph) => ph.dataUrl).slice(-12).reverse());
      }
    } catch (err) {
      console.warn('garage refresh failed', err);
    }
  }, [sync, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteRover = async (id: string) => {
    await sync.deleteRover(id);
    void refresh();
  };

  const active = missions.filter((m) => m.status === 'active');
  const finished = missions.filter((m) => m.status !== 'active');

  return (
    <main className="shell">
      <h1>Mission Control</h1>
      <p className="lede">
        Assemble a rover, launch it at a planet, moon or asteroid, then drive it: mine, photograph,
        scan for anomalies and build ground infrastructure.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <span className="chip">
          credits <b>{profile ? Math.round(profile.credits) : '—'}</b>
        </span>
        <span className="chip">
          discoveries <b>{profile?.discoveries ?? '—'}</b>
        </span>
        <span className="chip">storage: {sync.mode === 'remote' ? 'PocketBase' : 'this device'}</span>
      </div>

      {active.length > 0 && (
        <>
          <h2>Active missions</h2>
          <div className="grid">
            {active.map((m) => {
              const body = getBody(m.bodyId);
              return (
                <div className="card" key={m.id}>
                  <h3>
                    {m.roverName} · {body?.name ?? m.bodyId}
                  </h3>
                  <div className="sub">{body?.description}</div>
                  <div className="row">
                    <Link href={`/mission?id=${encodeURIComponent(m.id)}`}>
                      <button className="primary">Resume mission</button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2>Rover garage</h2>
      {rovers.length === 0 ? (
        <div className="empty">
          No rovers yet. <Link href="/customize">Build your first rover</Link> — the Scout Frame
          starter kit fits your budget.
        </div>
      ) : (
        <div className="grid">
          {rovers.map((r) => {
            const stats = computeStats(r);
            return (
              <div className="card" key={r.id}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: r.color,
                      display: 'inline-block',
                    }}
                  />
                  {r.name}
                </h3>
                <div className="sub">
                  {Math.round(stats.mass)} kg · battery {stats.batteryCapacity} · speed {stats.speed}{' '}
                  · fuel {stats.fuelCapacity}
                </div>
                <div className="row">
                  <Link href={`/launch?rover=${encodeURIComponent(r.id)}`}>
                    <button className="primary">Launch</button>
                  </Link>
                  <Link href={`/customize?rover=${encodeURIComponent(r.id)}`}>
                    <button>Edit</button>
                  </Link>
                  <button className="danger" onClick={() => void deleteRover(r.id)}>
                    Scrap
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {finished.length > 0 && (
        <>
          <h2>Mission log</h2>
          <div className="grid">
            {finished.map((m) => {
              const body = getBody(m.bodyId);
              return (
                <div className="card" key={m.id}>
                  <h3>
                    {m.roverName} · {body?.name ?? m.bodyId}
                  </h3>
                  <div className="sub">
                    status: {m.status === 'complete' ? 'returned safely' : 'lost on the surface'}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {photos.length > 0 && (
        <>
          <h2>Latest photos</h2>
          <div className="photo-grid">
            {photos.map((p) => (
              <figure key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl!} alt={p.caption} />
                <figcaption className="cap">{p.caption}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
