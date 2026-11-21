import type { ReactNode } from 'react';
import { createSlot, cx, useSlotClass } from '../registry.js';

/**
 * Field HUD kit (KES-543): light and flat over the terrain. Flat round
 * verbs, the primary bigger in the bottom-right thumb spot and the secondary
 * up and to its left, with a thin ring for charge or cooldown; a frosted gauge
 * strip top left with slim bars; a frosted round pause button top right. No
 * black plates, bevels or lips. Plain markup with `tk-ot-*` classes from
 * `styles.css`, so a host that is not React (or the field demo) can use the
 * same look.
 */

const svg = (body: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
);

/** Original line icons: white on a button face, tone-coloured beside a gauge. */
export const FIELD_ICONS: Record<string, ReactNode> = {
  laser: svg(<><path d="M4 20 14 10" /><path d="M14 10l2-6 4 4-6 2z" /><path d="M3 15l2 1M8 21l-1-2M2 19h2" /></>),
  fuel: svg(<><path d="M12 3c3 4 6 7.2 6 10.5A6 6 0 0 1 6 13.5C6 10.2 9 7 12 3z" /><path d="M10 15a2 2 0 0 0 2 2" /></>),
  hull: svg(<><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" /><path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" /></>),
  cargo: svg(<><path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16z" /><path d="M3.5 8 12 12.5 20.5 8M12 12.5v8" /></>),
  takeoff: svg(<><path d="M12 2.5c3 2.4 4.2 6 4.2 9.5l-1.7 4h-5L7.8 12c0-3.5 1.2-7.1 4.2-9.5z" /><path d="M9.5 16 8 20.5M14.5 16l1.5 4.5M12 7.5v2" /></>),
  site: svg(<><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>),
};

export interface FieldButtonProps {
  label: string;
  icon?: keyof typeof FIELD_ICONS | ReactNode;
  /** Held or engaged: the bar lights up. */
  on?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  /** Hold-to-fire: called with true on press and false on release. */
  onHold?: (down: boolean) => void;
  /** The big button in the thumb spot. FieldHud makes its last verb primary. */
  primary?: boolean;
  /** Face colour: 'laser', 'go', or a host's own tone in CSS. */
  tone?: string;
  /** 0..1 fills the ring round the face (charge, heat or cooldown). */
  charge?: number;
  className?: string;
}

function DefaultFieldButton({ label, icon, on, disabled, onPress, onHold, primary, tone, charge = 0, className }: FieldButtonProps) {
  const glyph = typeof icon === 'string' ? FIELD_ICONS[icon] : icon;
  return (
    <button
      type="button"
      className={cx('tk-ot-btn', useSlotClass('FieldButton'), className)}
      data-on={on ? '' : undefined}
      data-primary={primary ? '' : undefined}
      data-tone={tone ?? (typeof icon === 'string' ? icon : undefined)}
      style={{ ['--charge' as string]: Math.max(0, Math.min(1, charge)) }}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      onPointerDown={onHold ? e => { e.currentTarget.setPointerCapture?.(e.pointerId); onHold(true); } : undefined}
      onPointerUp={onHold ? () => onHold(false) : undefined}
      onPointerCancel={onHold ? () => onHold(false) : undefined}
    >
      <span className="tk-ot-btn-ring"><span className="tk-ot-btn-face">{glyph}</span></span>
      <span className="tk-ot-btn-label" aria-hidden="true">{label}</span>
    </button>
  );
}

export const FieldButton = createSlot('FieldButton', DefaultFieldButton);

export interface FieldGaugeProps {
  label: string;
  icon?: keyof typeof FIELD_ICONS | ReactNode;
  value: number;
  max?: number;
  /** Bar turns red below this fraction. */
  lowBelow?: number;
  /** Icon and bar colour: 'fuel', 'hull', 'cargo'; defaults to the icon key. */
  tone?: string;
  className?: string;
}

function DefaultFieldGauge({ label, icon, value, max = 100, lowBelow = 0.25, tone, className }: FieldGaugeProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const glyph = typeof icon === 'string' ? FIELD_ICONS[icon] : icon;
  return (
    <div className={cx('tk-ot-gauge', useSlotClass('FieldGauge'), className)} data-low={ratio < lowBelow ? '' : undefined} data-tone={tone ?? (typeof icon === 'string' ? icon : undefined)}>
      <span className="tk-ot-gauge-icon">{glyph}</span>
      <span className="tk-ot-gauge-body">
        <span className="tk-ot-gauge-label">{label}</span>
        <span className="tk-ot-gauge-bar">
          <span className="tk-ot-gauge-track"><span className="tk-ot-gauge-fill" style={{ width: `${ratio * 100}%` }} /></span>
          <span className="tk-ot-gauge-value">{Math.round(value)}</span>
        </span>
      </span>
    </div>
  );
}

export const FieldGauge = createSlot('FieldGauge', DefaultFieldGauge);

export interface FieldHudProps {
  gauges?: FieldGaugeProps[];
  /** At most two verbs; extra ones are dropped. */
  verbs?: FieldButtonProps[];
  onPause?: () => void;
  /** Bottom-left credit for real terrain, e.g. `FieldTerrain.credits[0]`. */
  credit?: string;
  className?: string;
}

function DefaultFieldHud({ gauges = [], verbs = [], onPause, credit, className }: FieldHudProps) {
  return (
    <div className={cx('tk-ot-hud', useSlotClass('FieldHud'), className)}>
      <div className="tk-ot-gauges">{gauges.map(g => <FieldGauge key={g.label} {...g} />)}</div>
      {onPause && (
        <button type="button" className="tk-ot-pause" aria-label="Pause" onClick={onPause}>
          <span /><span />
        </button>
      )}
      {credit && <div className="tk-ot-credit">Real terrain<br />{credit}</div>}
      <div className="tk-ot-verbs">{verbs.slice(0, 2).map((v, i, all) => <FieldButton key={v.label} primary={i === all.length - 1} {...v} />)}</div>
    </div>
  );
}

export const FieldHud = createSlot('FieldHud', DefaultFieldHud);
