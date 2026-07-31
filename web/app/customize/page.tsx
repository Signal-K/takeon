'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  listBodies,
  canReach,
  computeStats,
  defaultSpec,
  PARTS,
  type PartCategory,
  type PartDef,
  type RoverSpec,
} from '@takeon/engine';
import { useSync } from '../../lib/sync-context';

type RequiredCategory = 'chassis' | 'wheels' | 'power' | 'battery';

const REQUIRED: { category: RequiredCategory; label: string; hint: string }[] = [
  { category: 'chassis', label: 'Chassis', hint: 'Frame strength, module slots, built-in cargo bin' },
  { category: 'wheels', label: 'Drivetrain', hint: 'Speed vs climbing vs wear' },
  { category: 'power', label: 'Power source', hint: 'Solar needs daylight; RTG never stops' },
  { category: 'battery', label: 'Battery', hint: 'Everything you do drains it' },
];

const MODULE_CATS: { category: PartCategory; label: string; hint: string }[] = [
  { category: 'tool', label: 'Mining tool', hint: 'Required to mine. Higher power chews rock faster' },
  { category: 'camera', label: 'Camera', hint: 'Required for photos; documents anomalies' },
  { category: 'scanner', label: 'Scanner', hint: 'Reveals anomaly locations around you' },
  { category: 'cargo', label: 'Cargo', hint: 'Extra hold beyond the chassis bin' },
  { category: 'fuel', label: 'Fuel tank', hint: 'More delta-v: reach farther destinations' },
];

function CustomizePageInner() {
  const { sync, ready } = useSync();
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('rover');

  const [spec, setSpec] = useState<RoverSpec>(() => ({ ...defaultSpec(), id: '' }));
  const [baselineCost, setBaselineCost] = useState(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const p = await sync.getProfile();
      setCredits(p.credits);
      if (editId) {
        const rovers = await sync.listRovers();
        const existing = rovers.find((r) => r.id === editId);
        if (existing) {
          setSpec(existing);
          setBaselineCost(computeStats(existing).cost);
        }
      }
    })();
  }, [sync, ready, editId]);

  const stats = useMemo(() => computeStats(spec), [spec]);
  const chargedCost = Math.max(0, stats.cost - baselineCost);
  const affordable = credits === null || chargedCost <= credits;

  const setRequired = (category: RequiredCategory, id: string) =>
    setSpec((s) => ({ ...s, [category]: id }));

  const toggleModule = (part: PartDef) =>
    setSpec((s) => {
      const existingSameCat = s.modules.find(
        (m) => PARTS.find((p) => p.id === m)?.category === part.category,
      );
      let modules = s.modules.filter((m) => m !== existingSameCat);
      if (existingSameCat !== part.id) modules = [...modules, part.id];
      return { ...s, modules };
    });

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (chargedCost > 0) {
        const ok = await sync.spendCredits(chargedCost);
        if (!ok) {
          setError(`Not enough credits (need ${chargedCost}).`);
          return;
        }
      }
      const saved = await sync.saveRover(spec);
      router.push(`/launch?rover=${encodeURIComponent(saved.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const slots = PARTS.find((p) => p.id === spec.chassis)?.stats.slots ?? 0;

  return (
    <main className="shell">
      <h1>{editId ? 'Refit rover' : 'Build a rover'}</h1>
      <p className="lede">
        Every part changes the maths: mass slows you down and raises drive cost, solar dies at
        night, tracks climb where wheels stall. Build for the destination.
      </p>

      <div className="customizer" style={{ marginTop: 16 }}>
        <div>
          <div className="part-section">
            <h2>Identity</h2>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={spec.name}
                maxLength={24}
                onChange={(e) => setSpec((s) => ({ ...s, name: e.target.value }))}
                aria-label="Rover name"
              />
              <input
                type="color"
                value={spec.color}
                onChange={(e) => setSpec((s) => ({ ...s, color: e.target.value }))}
                aria-label="Hull colour"
              />
            </div>
          </div>

          {REQUIRED.map(({ category, label, hint }) => (
            <div className="part-section" key={category}>
              <h2>
                {label} <span style={{ textTransform: 'none', opacity: 0.7 }}>— {hint}</span>
              </h2>
              <div className="part-options">
                {PARTS.filter((p) => p.category === category).map((p) => (
                  <button
                    key={p.id}
                    className={`part-option ${spec[category] === p.id ? 'selected' : ''}`}
                    onClick={() => setRequired(category, p.id)}
                  >
                    <span className="name">
                      {p.name}
                      <span className={`tag t${p.tier}`}>{p.cost}cr</span>
                    </span>
                    <span className="desc">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {MODULE_CATS.map(({ category, label, hint }) => (
            <div className="part-section" key={category}>
              <h2>
                {label}{' '}
                <span style={{ textTransform: 'none', opacity: 0.7 }}>
                  — {hint} (module, {slots} slots total)
                </span>
              </h2>
              <div className="part-options">
                {PARTS.filter((p) => p.category === category).map((p) => (
                  <button
                    key={p.id}
                    className={`part-option ${spec.modules.includes(p.id) ? 'selected' : ''}`}
                    onClick={() => toggleModule(p)}
                  >
                    <span className="name">
                      {p.name}
                      <span className={`tag t${p.tier}`}>{p.cost}cr</span>
                    </span>
                    <span className="desc">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <aside className="card statsheet">
          <h3>{spec.name || 'Unnamed rover'}</h3>
          <div className="stat"><span>Mass</span><b>{Math.round(stats.mass)} kg</b></div>
          <div className="stat"><span>Battery</span><b>{stats.batteryCapacity}</b></div>
          <div className="stat">
            <span>Charging</span>
            <b>
              {stats.solarRate > 0 ? `${stats.solarRate}/s solar` : ''}
              {stats.solarRate > 0 && stats.rtgRate > 0 ? ' + ' : ''}
              {stats.rtgRate > 0 ? `${stats.rtgRate}/s RTG` : ''}
            </b>
          </div>
          <div className="stat"><span>Speed</span><b>{stats.speed} tiles/s</b></div>
          <div className="stat"><span>Climb</span><b>{stats.maxClimb} voxels</b></div>
          <div className="stat"><span>Drive cost</span><b>{stats.moveEnergy}/tile</b></div>
          <div className="stat"><span>Mining</span><b>{stats.miningPower > 0 ? `power ${stats.miningPower}` : '—'}</b></div>
          <div className="stat"><span>Camera</span><b>{stats.photoQuality > 0 ? `quality ${stats.photoQuality}` : '—'}</b></div>
          <div className="stat"><span>Scanner</span><b>{stats.scanRadius > 0 ? `${stats.scanRadius} tiles` : '—'}</b></div>
          <div className="stat"><span>Cargo</span><b>{stats.cargoCapacity}</b></div>
          <div className="stat"><span>Fuel</span><b>{stats.fuelCapacity}</b></div>
          <div className="stat"><span>Durability</span><b>{stats.durabilityMax}</b></div>

          <div className="stat" style={{ borderBottom: 'none' }}>
            <span>In range</span>
            <b>
              {listBodies().filter((b) => canReach(stats, b.deltaV))
                .map((b) => b.name)
                .join(', ') || 'nowhere — add fuel'}
            </b>
          </div>

          {!stats.valid && <div className="problems">{stats.problems.join(' · ')}</div>}
          {error && <div className="problems">{error}</div>}

          <div className="stat" style={{ borderBottom: 'none', fontSize: 15 }}>
            <span>{editId ? 'Refit cost' : 'Total cost'}</span>
            <b style={{ color: affordable ? 'var(--accent-2)' : 'var(--bad)' }}>
              {chargedCost} cr {credits !== null ? `(you have ${Math.round(credits)})` : ''}
            </b>
          </div>

          <button
            className="primary"
            disabled={!stats.valid || !affordable || saving || !spec.name.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : editId ? 'Save refit & pick target' : 'Buy rover & pick target'}
          </button>
          <Link href="/">
            <button style={{ width: '100%' }}>Back to garage</button>
          </Link>
        </aside>
      </div>
    </main>
  );
}

export default function CustomizePage() {
  return (
    <Suspense fallback={<main className="shell">Loading…</main>}>
      <CustomizePageInner />
    </Suspense>
  );
}
