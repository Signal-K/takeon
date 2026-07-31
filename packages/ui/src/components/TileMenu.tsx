import { MATERIALS, RESOURCE_NAMES } from '@takeon/engine';
import type { CSSProperties } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, cx, Slot, useLabels, useSlotClass } from '../registry.js';

export interface TileMenuProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Context menu for a tapped tile: what it is, and what the rover can be
 * ordered to do about it.
 */
function DefaultTileMenu({ className, style }: TileMenuProps) {
  const { game, tileMenu, setTileMenu, actions, hud, pushToast, canvas } = useMission();
  const labels = useLabels();
  const rootClass = cx('tk-tilemenu', useSlotClass('TileMenu'), className);
  if (!game || !tileMenu) return null;

  const { tile } = tileMenu;
  const world = game.sim.world;
  const material = MATERIALS[world.surfaceMaterial(tile.x, tile.y)];
  const height = world.height(tile.x, tile.y);
  const canMine = height > 0 && (hud?.can.mine ?? false);
  const yieldName = material.yields ? RESOURCE_NAMES[material.yields.resource] : null;
  const structure = game.sim.structures.find((s) => s.pos.x === tile.x && s.pos.y === tile.y);

  return (
    <div
      className={rootClass}
      style={{
        left: Math.min(tileMenu.x, (canvas?.clientWidth ?? 400) - 180),
        top: Math.min(tileMenu.y, (canvas?.clientHeight ?? 400) - 190),
        ...style,
      }}
    >
      <span className="tk-tilemenu-head">
        {material.name} · [{tile.x},{tile.y}] · z{height}
      </span>
      <button
        type="button"
        onClick={() => {
          actions.walkTo(tile.x, tile.y);
          setTileMenu(null);
        }}
      >
        🛞 {labels['tile.drive'] ?? 'Drive here'}
      </button>
      {canMine && (
        <button
          type="button"
          onClick={() => {
            actions.orderMine(tile.x, tile.y);
            setTileMenu(null);
            pushToast(`Mining order: ${material.name}`);
          }}
        >
          ⛏ {labels['tile.mine'] ?? `Mine ${yieldName ?? material.name}`}
        </button>
      )}
      {structure && (
        <>
          <button
            type="button"
            onClick={() => {
              actions.rotateStructure(structure.id);
              setTileMenu(null);
            }}
          >
            ⟳ {labels['tile.rotate'] ?? 'Rotate structure'}
          </button>
          <button
            type="button"
            onClick={() => {
              actions.demolish(structure.id);
              setTileMenu(null);
            }}
          >
            🧨 {labels['tile.demolish'] ?? 'Demolish'}
          </button>
        </>
      )}
      <Slot name="tileMenu.end" />
      <button type="button" onClick={() => setTileMenu(null)}>
        ✕ {labels['tile.cancel'] ?? 'Cancel'}
      </button>
    </div>
  );
}

export const TileMenu = createSlot('TileMenu', DefaultTileMenu);
