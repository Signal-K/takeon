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
 * Top status strip: battery, durability, cargo, time of day and weather,
 * plus the view controls. Hosts usually keep this and inject their own chips
 * through the `hudBar.start` / `hudBar.end` slots.
 */
function DefaultHudBar({ show, className, style }: HudBarProps) {
  const { hud, actions, minimapVisible, setMinimapVisible, setPanel } = useMission();
  const rotateLabel = useLabel('hud.rotate', 'Rotate view (R)');
  const mapLabel = useLabel('hud.map', 'Toggle map');
  const endLabel = useLabel('hud.end', 'End');
  const batteryLabel = useLabel('hud.battery', 'Battery');
  const durabilityLabel = useLabel('hud.durability', 'Durability');
  const cargoLabel = useLabel('hud.cargo', 'Cargo');
  const rootClass = cx('tk-hudbar', useSlotClass('HudBar'), className);
  if (!hud) return null;

  const on = (key: keyof NonNullable<HudBarProps['show']>) => show?.[key] !== false;
  const sun = hud.daylight > 0.5 ? '☀️' : hud.daylight > 0 ? '🌆' : '🌙';

  return (
    <div className={rootClass} style={style}>
      <Slot name="hudBar.start" />
      {on('battery') && (
        <Meter icon="⚡" label={batteryLabel} value={hud.battery} max={hud.batteryMax} dangerBelow={0.2} />
      )}
      {on('durability') && (
        <Meter
          icon="🛡"
          label={durabilityLabel}
          value={hud.durability}
          max={hud.durabilityMax}
          color="var(--tk-good)"
          dangerBelow={0.25}
        />
      )}
      {on('cargo') && (
        <Meter icon="📦" label={cargoLabel} value={hud.cargoUsed} max={hud.cargoMax} color="var(--tk-accent-2)" />
      )}
      {on('daylight') && <Chip title={`daylight ${(hud.daylight * 100) | 0}%`}>{sun}</Chip>}
      {on('weather') && hud.weather && (
        <Chip title={hud.weather.name}>
          {hud.weather.icon} {hud.weather.name}
        </Chip>
      )}
      <span className="tk-spacer" />
      <Slot name="hudBar.end" />
      <button type="button" className="tk-btn" onClick={actions.rotateView} title={rotateLabel}>
        ⟳
      </button>
      <button
        type="button"
        className="tk-btn"
        onClick={() => setMinimapVisible(!minimapVisible)}
        title={mapLabel}
        aria-pressed={minimapVisible}
      >
        🗺
      </button>
      <button type="button" className="tk-btn" onClick={() => setPanel('end')}>
        {endLabel}
      </button>
    </div>
  );
}

export const HudBar = createSlot('HudBar', DefaultHudBar);
