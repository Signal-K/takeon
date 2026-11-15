'use client';

import { TakeOnSurvey } from '@takeon/ui';

/**
 * Full-bleed host for the survey scene. Landnam embeds `<TakeOnSurvey>`
 * the same way; this page is the local preview.
 */
export default function SurveyPage() {
  return (
    <div className="mission-fullscreen">
      <TakeOnSurvey audio={false} />
    </div>
  );
}
