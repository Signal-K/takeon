import type { CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useLabel, useSlotClass } from '../registry.js';

export interface MissionCanvasProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * The render surface. Mounting it is what boots the engine — the provider
 * waits for a canvas before creating the game, so a host can delay or replace
 * this component and nothing else breaks.
 */
function DefaultMissionCanvas({ className, style }: MissionCanvasProps) {
  const { attachCanvas } = useMission();
  const label = useLabel('canvas.aria', 'Rover mission view');
  return (
    <canvas
      ref={attachCanvas}
      className={cx('tk-canvas', useSlotClass('MissionCanvas'), className)}
      style={style}
      aria-label={label}
    />
  );
}

export const MissionCanvas = createSlot('MissionCanvas', DefaultMissionCanvas);
