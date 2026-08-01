import { createSlot } from '@takeon/ui';
import type { ReactNode } from 'react';

export interface EditorCardProps {
  title: string;
  /** Short description shown next to the title. */
  hint?: string;
  /** Controls docked in the card header. */
  actions?: ReactNode;
  children: ReactNode;
  /** Extra class, e.g. the scene card's grid span. */
  className?: string;
  /** Body without padding (canvases fill their card). */
  flush?: boolean;
}

/**
 * Every panel in the editor is one of these: identical header height,
 * identical body, identical footprint in the grid. Consistency here is what
 * keeps the layout in line instead of ragged.
 */
function DefaultEditorCard({ title, hint, actions, children, className, flush }: EditorCardProps) {
  return (
    <section className={className ? `tke-card ${className}` : 'tke-card'}>
      <header className="tke-card-head">
        <h2>{title}</h2>
        {hint && <span className="tke-card-hint">{hint}</span>}
        {actions && <div className="tke-card-actions">{actions}</div>}
      </header>
      <div className={flush ? 'tke-card-body tke-card-body-flush' : 'tke-card-body'}>{children}</div>
    </section>
  );
}

export const EditorCard = createSlot('EditorCard', DefaultEditorCard);
