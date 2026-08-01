import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMission, type MissionContextValue } from '../mission-context.js';
import { createSlot, cx, Slot, useLabel, useLabels, useSlotClass } from '../registry.js';

export interface ActionItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect(ctx: MissionContextValue): void;
  /** Hidden when this returns false (e.g. no mining tool fitted). */
  visible?(ctx: MissionContextValue): boolean;
  title?: string;
  /**
   * Put this behind the "More" tray instead of showing it on the hotbar
   * directly. Occasional actions (build, craft, repair…) belong here so the
   * hotbar itself never grows past a handful of buttons.
   */
  menu?: boolean;
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
 *
 * Only `mine` / `photo` / `scan` sit on the hotbar directly — they're the
 * "do it now" verbs tied to what's in front of the rover. Everything else is
 * `menu: true` and lives behind the single "More" hex, so the bar reads as a
 * handful of buttons rather than a control panel.
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
  { id: 'build', icon: '🏗', label: 'Build', onSelect: (ctx) => ctx.setPanel('build'), menu: true },
  { id: 'craft', icon: '⚗️', label: 'Craft', onSelect: (ctx) => ctx.setPanel('craft'), menu: true },
  { id: 'place', icon: '🧱', label: 'Place', onSelect: (ctx) => ctx.actions.placeBlock(), menu: true },
  { id: 'repair', icon: '🔧', label: 'Repair', onSelect: (ctx) => ctx.actions.repair(), menu: true },
  { id: 'deposit', icon: '📥', label: 'Deposit', onSelect: (ctx) => ctx.actions.deposit(), menu: true },
  { id: 'cargo', icon: '🎒', label: 'Hold', onSelect: (ctx) => ctx.setPanel('cargo'), menu: true },
];

function DefaultActionBar({ items, extraItems, omit, className, style }: ActionBarProps) {
  const ctx = useMission();
  const labels = useLabels();
  const moreLabel = useLabel('action.more', 'More');
  const rootClass = cx('tk-actions', useSlotClass('ActionBar'), className);
  const base = items ?? DEFAULT_ACTIONS.filter((a) => !omit?.includes(a.id));
  const all = (extraItems ? [...base, ...extraItems] : base).filter((a) => a.visible?.(ctx) ?? true);
  const hotbar = all.filter((a) => !a.menu);
  const tray = all.filter((a) => a.menu);

  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape and on outside click, so the tray never gets stuck open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const run = (item: ActionItem) => {
    item.onSelect(ctx);
    setMenuOpen(false);
  };

  return (
    <div className={rootClass} style={style} ref={containerRef}>
      <Slot name="actionBar.start" />
      {hotbar.map((a) => (
        <button
          key={a.id}
          type="button"
          className="tk-action"
          title={a.title ?? a.label}
          onClick={() => run(a)}
        >
          <span className="tk-action-icon">{a.icon}</span>
          <span className="tk-action-label">{labels[`action.${a.id}`] ?? a.label}</span>
        </button>
      ))}
      {tray.length > 0 && (
        <button
          type="button"
          className="tk-action tk-action-more"
          title={moreLabel}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="tk-action-icon">⚙</span>
          <span className="tk-action-label">{moreLabel}</span>
        </button>
      )}
      <Slot name="actionBar.end" />

      {menuOpen && tray.length > 0 && (
        <>
          <div className="tk-tray-backdrop" onClick={() => setMenuOpen(false)} role="presentation" />
          <div className="tk-tray" role="menu" aria-label={moreLabel}>
            <span className="tk-tray-head">{moreLabel}</span>
            {tray.map((a) => (
              <button key={a.id} type="button" role="menuitem" title={a.title} onClick={() => run(a)}>
                <span className="tk-tray-icon">{a.icon}</span>
                {labels[`action.${a.id}`] ?? a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const ActionBar = createSlot('ActionBar', DefaultActionBar);
