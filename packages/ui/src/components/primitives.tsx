import type { CSSProperties, ReactNode } from 'react';
import { createSlot, cx, useSlotClass } from '../registry.js';

export interface MeterProps {
  icon?: ReactNode;
  label?: string;
  value: number;
  max: number;
  /** Bar colour; falls back to the accent variable. */
  color?: string;
  /** Colour used once `value/max` drops below `dangerBelow`. */
  dangerColor?: string;
  dangerBelow?: number;
  className?: string;
  style?: CSSProperties;
}

function DefaultMeter({
  icon,
  label,
  value,
  max,
  color = 'var(--tk-accent)',
  dangerColor = 'var(--tk-bad)',
  dangerBelow = 0,
  className,
  style,
}: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cx('tk-meter', useSlotClass('Meter'), className)} style={style} title={label}>
      <span className="tk-meter-head">
        {icon} {Math.round(value)}/{Math.round(max)}
      </span>
      <span className="tk-bar">
        <span
          className="tk-bar-fill"
          style={{ width: `${ratio * 100}%`, background: ratio < dangerBelow ? dangerColor : color }}
        />
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
        {title && <h3 className="tk-modal-title">{title}</h3>}
        {subtitle && <p className="tk-modal-sub">{subtitle}</p>}
        {children}
        {footer}
      </div>
    </div>
  );
}

export const Modal = createSlot('Modal', DefaultModal);

export interface ChipProps {
  children: ReactNode;
  title?: string;
  onClick?(): void;
  className?: string;
}

function DefaultChip({ children, title, onClick, className }: ChipProps) {
  const cls = cx('tk-chip', useSlotClass('Chip'), className);
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={cls} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

export const Chip = createSlot('Chip', DefaultChip);
