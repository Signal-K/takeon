'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BODIES, canReach, computeStats, type RoverSpec } from '@takeon/engine';
import { useSync } from '../../lib/sync-context';

function LaunchPageInner() {
  const { sync, ready } = useSync();
  const router = useRouter();
  const params = useSearchParams();
  const roverId = params.get('rover');
  const [rover, setRover] = useState<RoverSpec | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!ready || !roverId) return;
    void sync.listRovers().then((rovers) => {
      const r = rovers.find((x) => x.id === roverId) ?? null;
      setRover(r);
      setMissing(!r);
    });
  }, [sync, ready, roverId]);

  const stats = useMemo(() => (rover ? computeStats(rover) : null), [rover]);

  if (!roverId || missing) {
    return (
      <main className="shell">
        <h1>Pick a rover first</h1>
        <p className="lede">
          Launch needs a rover. <Link href="/customize">Build one</Link> or pick one from the{' '}
          <Link href="/">garage</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <h1>Select destination</h1>
      <p className="lede">
        {rover ? (
          <>
            Launching <b>{rover.name}</b> — fuel capacity {stats?.fuelCapacity}. Landing burns fuel
            equal to the target&apos;s delta-v; what&apos;s left stays in the tank for emergencies.
          </>
        ) : (
          'Loading rover…'
        )}
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        {BODIES.map((b) => {
          const reachable = stats ? canReach(stats, b.deltaV) : false;
          return (
            <div className="card" key={b.id}>
              <h3>
                {b.name} <span className="tag">{b.type}</span>
              </h3>
              <div className="sub">{b.description}</div>
              <div className="sub">
                gravity {b.gravity} m/s² · sunlight {Math.round(b.solarFlux * 100)}% ·{' '}
                {b.dayLength > 0 ? `day ${Math.round(b.dayLength / 60)} min` : 'no night'} · Δv{' '}
                {b.deltaV}
              </div>
              <div className="row">
                <button
                  className="primary"
                  disabled={!reachable}
                  onClick={() =>
                    router.push(
                      `/mission?rover=${encodeURIComponent(roverId)}&body=${encodeURIComponent(b.id)}`,
                    )
                  }
                >
                  {reachable ? 'Launch' : `Needs ${b.deltaV} fuel`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

export default function LaunchPage() {
  return (
    <Suspense fallback={<main className="shell">Loading…</main>}>
      <LaunchPageInner />
    </Suspense>
  );
}
