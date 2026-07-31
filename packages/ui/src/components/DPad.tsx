import type { CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useLabel, useSlotClass } from '../registry.js';

export interface DPadProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Touch drive pad. Directions are screen-relative — the engine maps them onto
 * world axes for the current view rotation, so "up" is always up.
 */
function DefaultDPad({ className, style }: DPadProps) {
  const { actions } = useMission();
  const label = useLabel('dpad.aria', 'Drive controls');
  const centre = useLabel('dpad.centre', 'Centre camera');
  return (
    <div className={cx('tk-dpad', useSlotClass('DPad'), className)} style={style} aria-label={label}>
      <span className="tk-blank" />
      <button type="button" onPointerDown={() => actions.move(3)} aria-label={useLabel('dpad.ne', 'Drive north-east')}>
        ▲
      </button>
      <span className="tk-blank" />
      <button type="button" onPointerDown={() => actions.move(2)} aria-label={useLabel('dpad.nw', 'Drive north-west')}>
        ◀
      </button>
      <button type="button" onPointerDown={actions.centreCamera} aria-label={centre}>
        ◎
      </button>
      <button type="button" onPointerDown={() => actions.move(0)} aria-label={useLabel('dpad.se', 'Drive south-east')}>
        ▶
      </button>
      <span className="tk-blank" />
      <button type="button" onPointerDown={() => actions.move(1)} aria-label={useLabel('dpad.sw', 'Drive south-west')}>
        ▼
      </button>
      <span className="tk-blank" />
    </div>
  );
}

export const DPad = createSlot('DPad', DefaultDPad);
