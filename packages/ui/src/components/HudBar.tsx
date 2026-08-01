import type { CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, Slot, useLabel, useSlotClass } from '../registry.js';
import { Chip, Meter } from './primitives.js';

export interface HudBarProps {
  /** Hide individual meters when the host wants a leaner bar. */
  show?: { battery?: boolean; durability?: boolean; cargo?: boolean; daylight?: boolean; weather?: boolean };
  className?: string;
  style?: CSSProperties;
}

/**
 * Status rack: the three survival gauges in one notched instrument panel,
 * with the environment read-out and view controls flanking it.
 */
function DefaultHudBar({ show, className, style }: HudBarProps) {
  const { hud, actions, minimapVisible, setMinimapVisible, setPanel } = useMission();
  const rotateLabel = useLabel('hud.rotate', 'Rotate view (R)');
  const mapLabel = useLabel('hud.map', 'Toggle map');
  const endLabel = useLabel('hud.end', 'End');
  const batteryLabel = useLabel('hud.battery', 'Power');
  const durabilityLabel = useLabel('hud.durability', 'Hull');
  const cargoLabel = useLabel('hud.cargo', 'Hold');
  const rootClass = cx('tk-hudbar', useSlotClass('HudBar'), className);
  if (!hud) return null;

  const on = (key: keyof NonNullable<HudBarProps['show']>) => show?.[key] !== false;
  const sun = hud.daylight > 0.5 ? '☀' : hud.daylight > 0 ? '◐' : '☾';
  const sunLabel = hud.daylight > 0.5 ? 'Day' : hud.daylight > 0 ? 'Dusk' : 'Night';

  return (
    <div className={rootClass} style={style}>
      <Slot name="hudBar.start" />
      <div className="tk-rack">
        {on('battery') && (
          <Meter icon="⚡" label={batteryLabel} value={hud.battery} max={hud.batteryMax} dangerBelow={0.2} />
        )}
        {on('durability') && (
          <Meter
            icon="🛡"
            label={durabilityLabel}
            value={hud.durability}
            max={hud.durabilityMax}
            tone="good"
            dangerBelow={0.25}
          />
        )}
        {on('cargo') && (
          <Meter icon="▣" label={cargoLabel} value={hud.cargoUsed} max={hud.cargoMax} tone="warn" />
        )}
      </div>

      <div className="tk-readout">
        {on('daylight') && (
          <Chip title={`Daylight ${Math.round(hud.daylight * 100)}%`}>
            <b>{sun}</b> {sunLabel}
          </Chip>
        )}
        {on('weather') && hud.weather && (
          <Chip tone="warn" title={hud.weather.name}>
            <b>{hud.weather.icon}</b> {hud.weather.name}
          </Chip>
        )}
      </div>

      <span className="tk-spacer" />
      <Slot name="hudBar.end" />
      <button type="button" className="tk-btn tk-btn-icon" onClick={actions.rotateView} title={rotateLabel}>
        ⟳
      </button>
      <button
        type="button"
        className="tk-btn tk-btn-icon"
        onClick={() => setMinimapVisible(!minimapVisible)}
        title={mapLabel}
        aria-pressed={minimapVisible}
      >
        ⬡
      </button>
      <button type="button" className="tk-btn" onClick={() => setPanel('end')}>
        {endLabel}
      </button>
    </div>
  );
}

export const HudBar = createSlot('HudBar', DefaultHudBar);
