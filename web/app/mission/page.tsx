'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { getBody, type BodyDef, type MissionState, type RoverSpec } from '@takeon/engine';
import { MissionProvider, MissionScreen, TakeOnUIProvider } from '@takeon/ui';
import { useSync } from '../../lib/sync-context';

/**
 * The standalone mission screen is a thin host: it resolves which world and
 * rover to run from the URL and the sync adapter, then hands them to
 * @takeon/ui. Every HUD component comes from the registry, so this page (and
 * any game embedding TakeOn) can swap parts of the interface via
 * `TakeOnUIProvider` without touching the engine.
 */
function MissionPageInner() {
  const { sync, ready } = useSync();
  const router = useRouter();
  const params = useSearchParams();
  const [boot, setBoot] = useState<{ body: BodyDef; spec: RoverSpec; resume?: MissionState } | null>(null);
  const [fatal, setFatal] = useState('');

  const missionId = params.get('id');
  const roverId = params.get('rover');
  const bodyId = params.get('body');

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const load = async () => {
      if (missionId) {
        const state = await sync.loadMission(missionId);
        if (cancelled) return;
        if (!state) return setFatal('Mission not found.');
        const body = getBody(state.bodyId);
        if (!body) return setFatal(`Unknown destination "${state.bodyId}".`);
        setBoot({ body, spec: state.rover.spec, resume: state });
        return;
      }
      const body = bodyId ? getBody(bodyId) : undefined;
      if (!roverId || !body) return setFatal('Missing rover or destination.');
      const rovers = await sync.listRovers();
      if (cancelled) return;
      const spec = rovers.find((r) => r.id === roverId);
      if (!spec) return setFatal('Rover not found.');
      setBoot({ body, spec });
    };

    void load().catch((err) => {
      console.warn('[takeon] mission load failed', err);
      if (!cancelled) setFatal('Could not load this mission.');
    });
    return () => {
      cancelled = true;
    };
  }, [ready, sync, missionId, roverId, bodyId]);

  if (fatal) {
    return (
      <main className="shell">
        <h1>Cannot start mission</h1>
        <p className="lede">{fatal}</p>
        <button onClick={() => router.push('/')}>Back to garage</button>
      </main>
    );
  }

  if (!boot) return <main className="shell">Loading mission…</main>;

  return (
    <div className="mission-fullscreen">
      <TakeOnUIProvider>
        <MissionProvider
          body={boot.body}
          spec={boot.spec}
          resume={boot.resume}
          sync={sync}
          onEnd={() => router.push('/')}
        >
          <MissionScreen onEnded={() => router.push('/')} />
        </MissionProvider>
      </TakeOnUIProvider>
    </div>
  );
}

export default function MissionPage() {
  return (
    <Suspense fallback={<main className="shell">Loading mission…</main>}>
      <MissionPageInner />
    </Suspense>
  );
}
