import type { CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useSlotClass } from '../registry.js';

export interface ToastStackProps {
  className?: string;
  style?: CSSProperties;
}

function DefaultToastStack({ className, style }: ToastStackProps) {
  const { toasts, dismissToast } = useMission();
  return (
    <div className={cx('tk-toasts', useSlotClass('ToastStack'), className)} style={style} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('tk-toast', `tk-toast-${t.kind}`)} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export const ToastStack = createSlot('ToastStack', DefaultToastStack);
