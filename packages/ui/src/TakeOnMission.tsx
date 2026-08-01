import type { ReactNode } from 'react';
import { MissionProvider, type MissionProviderProps } from './mission-context.js';
import { MissionScreen, type MissionScreenProps } from './components/MissionScreen.js';
import { TakeOnUIProvider, type TakeOnUIConfig } from './registry.js';

export interface TakeOnMissionProps extends Omit<MissionProviderProps, 'children'> {
  /** Component/label/theme overrides for this mission. */
  ui?: TakeOnUIConfig;
  /** Passed through to the stock screen. */
  screen?: MissionScreenProps;
  /** Rendered inside the mission root, above the HUD. */
  children?: ReactNode;
}

/**
 * One-component embed: provider + UI config + the stock screen.
 *
 * ```tsx
 * <TakeOnMission
 *   body={getBody('mars')!}
 *   spec={playerRover}
 *   sync={myAdapter}
 *   ui={{ components: { ActionBar: MyActionBar }, theme: { accent: '#ff8a3d' } }}
 *   onEnd={({ credits }) => router.push(`/results?c=${credits}`)}
 * />
 * ```
 */
export function TakeOnMission({ ui, screen, children, ...mission }: TakeOnMissionProps) {
  return (
    <TakeOnUIProvider {...ui}>
      <MissionProvider {...mission}>
        <MissionScreen {...screen}>{children}</MissionScreen>
      </MissionProvider>
    </TakeOnUIProvider>
  );
}
