import type { ReactNode } from 'react';
import { applySurveyFraming, defaultSurveyBody, surveySpec } from '@takeon/engine';
import { MissionProvider, type MissionProviderProps } from './mission-context.js';
import { TakeOnUIProvider, type TakeOnUIConfig } from './registry.js';
import { SurveyScreen, type SurveyScreenProps } from './components/SurveyScreen.js';

export interface TakeOnSurveyProps extends Omit<MissionProviderProps, 'children' | 'body' | 'spec' | 'view'> {
  /** Defaults to Europa. */
  body?: MissionProviderProps['body'];
  /** Defaults to the survey field-lab rover. */
  spec?: MissionProviderProps['spec'];
  ui?: TakeOnUIConfig;
  screen?: Omit<SurveyScreenProps, 'onHub'>;
  /** Native and web hosts handle HUB themselves (route to the settlement). */
  onHub?: () => void;
  children?: ReactNode;
}

/**
 * Drop-in survey scene for a React host (Landnam web).
 * The canvas, 60° camera and cream controls travel together.
 *
 * ```tsx
 * <TakeOnSurvey onHub={() => router.push('/hub')} />
 * ```
 */
export function TakeOnSurvey({ ui, screen, onHub, children, onReady, ...mission }: TakeOnSurveyProps) {
  const body = mission.body ?? defaultSurveyBody();
  const spec = mission.spec ?? surveySpec();
  return (
    <TakeOnUIProvider {...ui}>
      <MissionProvider
        {...mission}
        body={body}
        spec={spec}
        view="iso"
        onReady={(game) => {
          applySurveyFraming(game, { moveToFormation: !mission.resume });
          onReady?.(game);
        }}
      >
        <SurveyScreen {...screen} onHub={onHub} />
        {children}
      </MissionProvider>
    </TakeOnUIProvider>
  );
}
