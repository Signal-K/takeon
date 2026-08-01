import { renderCrossSection } from '@takeon/engine';
import { useEffect, useRef, type CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useLabel, useSlotClass } from '../registry.js';

export interface CrossSectionViewProps {
  /** Slice orientation. Default `'y'` (an east-west wall, looking north). */
  axis?: 'x' | 'y';
  /** Fixed row/column to slice; omit to follow the rover along that axis. */
  index?: number;
  /** Redraw period in ms. Default 400 — depth changes are driven by mining/driving, not every frame. */
  intervalMs?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The "underground" view: a live vertical slice through the actual generated
 * world at the rover's position (or a fixed row/column), painted with the
 * real material colours — including any depth-stratified ore a body's
 * `terrain.bands` authored. Unlike a decorative strata illustration, what you
 * mine is what's drawn here.
 *
 * Sized by its container (not a fixed canvas), so it works equally as a small
 * HUD inset or a full-screen panel — mount it inside `slots={{ 'mission.overlay': <CrossSectionView/> }}`,
 * a custom panel, or a standalone screen; it is not part of the default
 * `MissionScreen` layout since not every game wants an underground view.
 */
function DefaultCrossSectionView({ axis = 'y', index, intervalMs = 400, className, style }: CrossSectionViewProps) {
  const { game } = useMission();
  const ref = useRef<HTMLCanvasElement>(null);
  const label = useLabel('crossSection.label', 'Subsurface');

  useEffect(() => {
    if (!game) return;
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const world = game.sim.world;
      const rover = game.sim.rover;
      const at = index ?? Math.round(axis === 'y' ? rover.pos.y : rover.pos.x);
      renderCrossSection(canvas, world, axis, Math.max(0, Math.min(world.size - 1, at)));
    };
    draw();
    const timer = setInterval(draw, intervalMs);
    window.addEventListener('resize', draw);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', draw);
    };
  }, [game, axis, index, intervalMs]);

  return (
    <div className={cx('tk-cross-section', useSlotClass('CrossSectionView'), className)} style={style}>
      <canvas ref={ref} className="tk-cross-section-canvas" />
      <span className="tk-cross-section-label">{label}</span>
    </div>
  );
}

export const CrossSectionView = createSlot('CrossSectionView', DefaultCrossSectionView);
