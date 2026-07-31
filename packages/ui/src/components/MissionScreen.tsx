import type { CSSProperties, ReactNode } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, Slot, useSlotClass } from '../registry.js';
import { ActionBar } from './ActionBar.js';
import { BuildPanel } from './BuildPanel.js';
import { CargoPanel } from './CargoPanel.js';
import { CraftPanel } from './CraftPanel.js';
import { DPad } from './DPad.js';
import { EndMissionDialog } from './EndMissionDialog.js';
import { HudBar } from './HudBar.js';
import { Minimap } from './Minimap.js';
import { MissionCanvas } from './MissionCanvas.js';
import { TileMenu } from './TileMenu.js';
import { ToastStack } from './ToastStack.js';

export type MissionScreenPart =
  | 'canvas'
  | 'hudBar'
  | 'minimap'
  | 'dpad'
  | 'actions'
  | 'tileMenu'
  | 'toasts'
  | 'panels';

export interface MissionScreenProps {
  /** Parts to leave out — a host replacing the HUD wholesale passes them here. */
  hide?: MissionScreenPart[];
  /** Called once the mission has been banked and closed out. */
  onEnded?(credits: number): void;
  /** Rendered on top of everything (host chrome, quest overlays…). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The stock mission layout: render surface plus the standard HUD. Every child
 * is registry-resolved, so a host can swap any one of them (or hide it and
 * render its own) without reimplementing the rest.
 */
function DefaultMissionScreen({ hide, onEnded, children, className, style }: MissionScreenProps) {
  const { panel, hud, status, error } = useMission();
  const rootClass = cx('tk-mission', useSlotClass('MissionScreen'), className);
  const on = (part: MissionScreenPart) => !hide?.includes(part);
  const showEnd = panel === 'end' || hud?.status === 'lost';

  return (
    <div className={rootClass} style={style}>
      {on('canvas') && <MissionCanvas />}
      {status === 'error' && <div className="tk-error">{error}</div>}
      {on('hudBar') && <HudBar />}
      {on('minimap') && <Minimap />}
      {on('dpad') && <DPad />}
      {on('actions') && <ActionBar />}
      {on('tileMenu') && <TileMenu />}
      {on('toasts') && <ToastStack />}
      {on('panels') && (
        <>
          {panel === 'build' && <BuildPanel />}
          {panel === 'craft' && <CraftPanel />}
          {panel === 'cargo' && <CargoPanel />}
          {showEnd && <EndMissionDialog onEnded={onEnded} />}
        </>
      )}
      <Slot name="mission.overlay" />
      {children}
    </div>
  );
}

export const MissionScreen = createSlot('MissionScreen', DefaultMissionScreen);
