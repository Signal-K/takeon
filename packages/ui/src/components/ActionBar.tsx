import type { CSSProperties, ReactNode } from 'react';
import { useMission, type MissionContextValue } from '../mission-context.js';
import { createSlot, cx, Slot, useLabels, useSlotClass } from '../registry.js';

export interface ActionItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect(ctx: MissionContextValue): void;
  /** Hidden when this returns false (e.g. no mining tool fitted). */
  visible?(ctx: MissionContextValue): boolean;
  title?: string;
}

export interface ActionBarProps {
  /** Replace the action set outright. */
  items?: ActionItem[];
  /** Append to the default action set. */
  extraItems?: ActionItem[];
  /** Drop default actions by id. */
  omit?: string[];
  className?: string;
  style?: CSSProperties;
}

/**
 * The default action set. Exported so a host can start from it —
 * `items={[...DEFAULT_ACTIONS.filter(a => a.id !== 'craft'), myAction]}`.
 */
export const DEFAULT_ACTIONS: ActionItem[] = [
  {
    id: 'mine',
    icon: '⛏',
    label: 'Mine',
    onSelect: (ctx) => ctx.actions.mine(),
    visible: (ctx) => ctx.hud?.can.mine ?? false,
  },
  {
    id: 'photo',
    icon: '📷',
    label: 'Photo',
    onSelect: (ctx) => ctx.actions.photo(),
    visible: (ctx) => ctx.hud?.can.photo ?? false,
  },
  {
    id: 'scan',
    icon: '📡',
    label: 'Scan',
    onSelect: (ctx) => ctx.actions.scan(),
    visible: (ctx) => ctx.hud?.can.scan ?? false,
  },
  { id: 'build', icon: '🏗', label: 'Build', onSelect: (ctx) => ctx.setPanel('build') },
  { id: 'craft', icon: '⚗️', label: 'Craft', onSelect: (ctx) => ctx.setPanel('craft') },
  { id: 'place', icon: '🧱', label: 'Place', onSelect: (ctx) => ctx.actions.placeBlock() },
  { id: 'repair', icon: '🔧', label: 'Repair', onSelect: (ctx) => ctx.actions.repair() },
  { id: 'deposit', icon: '📥', label: 'Deposit', onSelect: (ctx) => ctx.actions.deposit() },
  { id: 'cargo', icon: '🎒', label: 'Hold', onSelect: (ctx) => ctx.setPanel('cargo') },
];

function DefaultActionBar({ items, extraItems, omit, className, style }: ActionBarProps) {
  const ctx = useMission();
  const labels = useLabels();
  const rootClass = cx('tk-actions', useSlotClass('ActionBar'), className);
  const base = items ?? DEFAULT_ACTIONS.filter((a) => !omit?.includes(a.id));
  const all = extraItems ? [...base, ...extraItems] : base;

  return (
    <div className={rootClass} style={style}>
      <Slot name="actionBar.start" />
      {all
        .filter((a) => a.visible?.(ctx) ?? true)
        .map((a) => (
          <button
            key={a.id}
            type="button"
            className="tk-action"
            title={a.title ?? a.label}
            onClick={() => a.onSelect(ctx)}
          >
            <span className="tk-action-icon">{a.icon}</span>
            {labels[`action.${a.id}`] ?? a.label}
          </button>
        ))}
      <Slot name="actionBar.end" />
    </div>
  );
}

export const ActionBar = createSlot('ActionBar', DefaultActionBar);
