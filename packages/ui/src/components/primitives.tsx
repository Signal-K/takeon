import type { CSSProperties, ReactNode } from 'react';
import { createSlot, cx, useSlotClass } from '../registry.js';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'neutral';

export interface MeterProps {
  icon?: ReactNode;
  label?: string;
  value: number;
  max: number;
  /** Colour family for the bar. */
  tone?: Tone;
  /** Switches to the danger tone once `value/max` drops below this. */
  dangerBelow?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * A segmented resource gauge: icon, label, notched bar, readout. Segmented
 * rather than smooth so a glance reads as "eleven of twenty" — pulp
 * instrumentation, not a progress bar.
 */
function DefaultMeter({
  icon,
  label,
  value,
  max,
  tone = 'accent',
  dangerBelow = 0,
  className,
  style,
}: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const effective: Tone = ratio < dangerBelow ? 'bad' : tone;
  return (
    <div
      className={cx('tk-meter', useSlotClass('Meter'), className)}
      style={style}
      data-tone={effective}
      title={label}
    >
      {icon && <span className="tk-meter-icon">{icon}</span>}
      <span className="tk-meter-body">
        <span className="tk-meter-head">
          <span className="tk-meter-label">{label}</span>
          <span className="tk-meter-value">
            {Math.round(value)}
            <em>/{Math.round(max)}</em>
          </span>
        </span>
        <span className="tk-bar">
          <span className="tk-bar-fill" style={{ width: `${ratio * 100}%` }} />
        </span>
      </span>
    </div>
  );
}

export const Meter = createSlot('Meter', DefaultMeter);

export interface ModalProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function DefaultModal({ title, subtitle, onClose, children, footer, className }: ModalProps) {
  return (
    <div className={cx('tk-backdrop', useSlotClass('Modal'), className)} onClick={onClose} role="presentation">
      <div className="tk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && (
          <div className="tk-modal-bar">
            <h3 className="tk-modal-title">{title}</h3>
            <button type="button" className="tk-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="tk-modal-body">
          {subtitle && <p className="tk-modal-sub">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="tk-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Modal = createSlot('Modal', DefaultModal);

export interface ChipProps {
  children: ReactNode;
  title?: string;
  tone?: Tone;
  onClick?(): void;
  className?: string;
}

function DefaultChip({ children, title, tone, onClick, className }: ChipProps) {
  const cls = cx('tk-chip', useSlotClass('Chip'), className);
  if (!onClick) {
    return (
      <span className={cls} title={title} data-tone={tone}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={cls} title={title} data-tone={tone} onClick={onClick}>
      {children}
    </button>
  );
}

export const Chip = createSlot('Chip', DefaultChip);
