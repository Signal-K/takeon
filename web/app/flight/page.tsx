'use client';

import { getBody } from '@takeon/engine';
import { TakeOnFlight } from '@takeon/ui';

/**
 * Local preview of the space flight scene. `?to=<body id>` picks the
 * destination and `?phase=orbit` opens it as an in-orbit scene.
 */
export default function FlightPage() {
  const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const body = getBody(query.get('to') ?? 'mars') ?? getBody('mars')!;
  const orbit = query.get('phase') === 'orbit';
  return (
    <div className="mission-fullscreen">
      <TakeOnFlight
        destination={body}
        config={{
          seed: body.seed,
          duration: 60,
          debris: 0.4,
          pickups: 0.4,
          boostCharges: 1,
          startPhase: orbit ? 'orbit' : 'departure',
          sites: [
            { id: 'north', label: 'North basin', angle: 1.2 },
            { id: 'ridge', label: 'Ridge', angle: 3.1 },
            { id: 'south', label: 'South plain', angle: 5 },
          ],
        }}
      />
    </div>
  );
}
