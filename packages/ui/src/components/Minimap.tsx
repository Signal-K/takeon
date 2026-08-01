import { useEffect, useRef, type CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useSlotClass } from '../registry.js';

export interface MinimapProps {
  size?: number;
  /** Redraw period in ms. */
  intervalMs?: number;
  className?: string;
  style?: CSSProperties;
}

function DefaultMinimap({ size = 132, intervalMs = 1200, className, style }: MinimapProps) {
  const { game, minimapVisible } = useMission();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!game || !minimapVisible) return;
    const draw = () => {
      if (ref.current) game.renderer.renderMinimap(ref.current);
    };
    draw();
    const timer = setInterval(draw, intervalMs);
    return () => clearInterval(timer);
  }, [game, minimapVisible, intervalMs]);

  return (
    <div
      className={cx('tk-minimap', useSlotClass('Minimap'), className)}
      style={{ display: minimapVisible ? 'block' : 'none', ...style }}
    >
      <canvas ref={ref} width={size} height={size} className="tk-minimap-canvas" />
      <span className="tk-minimap-label">Survey</span>
    </div>
  );
}

export const Minimap = createSlot('Minimap', DefaultMinimap);
