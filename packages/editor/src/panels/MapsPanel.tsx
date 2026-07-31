import { fbm2, MATERIALS, skinBiome, type BodyDef, type VoxelWorld } from '@takeon/engine';
import { createSlot } from '@takeon/ui';
import { useEffect, useRef, useState } from 'react';
import { MAP_KINDS, mapPointToTile, paintCrossSection, paintField, paintMap, type MapKind } from '../maps.js';

export interface MapsPanelProps {
  body: BodyDef;
  world: VoxelWorld | null;
  version: number;
  maxClimb: number;
  from: { x: number; y: number } | null;
  /** Notifies the host when the user picks a tile on a map. */
  onPickTile?(tile: { x: number; y: number }): void;
}

type View = MapKind | 'noise';

/**
 * Top-down instrumentation: the elevation/slope/material/ore/drivability maps,
 * the raw noise field at the generator's own frequency, and a cross-section
 * through whichever row you click.
 */
function DefaultMapsPanel({ body, world, version, maxClimb, from, onPickTile }: MapsPanelProps) {
  const [view, setView] = useState<View>('elevation');
  const [row, setRow] = useState(0);
  const [tile, setTile] = useState<{ x: number; y: number } | null>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const sliceRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (world) setRow((r) => Math.min(r || world.size >> 1, world.size - 1));
  }, [world]);

  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas) return;
    if (view === 'noise') {
      // Same frequency the terrain generator uses, so the preview is the
      // field that actually shapes this world.
      const freq = 0.035 + body.terrain.roughness * 0.03;
      const size = body.size;
      paintField(canvas, size, (x, y) => {
        const n = fbm2(x * freq, y * freq, body.seed, 4);
        return n * 0.65 + fbm2(x * freq * 0.25, y * freq * 0.25, body.seed + 55, 2) * 0.35;
      });
      return;
    }
    if (!world) return;
    paintMap(canvas, world, view, {
      maxClimb,
      from: from ?? undefined,
      marker: { axis: 'y', index: row },
      pin: from,
    });
  }, [view, world, version, maxClimb, from, row, body]);

  useEffect(() => {
    if (!world || !sliceRef.current) return;
    paintCrossSection(sliceRef.current, world, 'y', Math.min(row, world.size - 1));
  }, [world, version, row]);

  const surfaceAt = tile && world ? MATERIALS[world.surfaceMaterial(tile.x, tile.y)] : null;
  const biomeAt = tile ? MATERIALS[skinBiome(tile.x, tile.y, body.seed)] : null;

  return (
    <div className="tke-maps">
      <div className="tke-tabs">
        {MAP_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={view === k.id ? 'tke-tab tke-selected' : 'tke-tab'}
            onClick={() => setView(k.id)}
            title={k.help}
          >
            {k.label}
          </button>
        ))}
        <button
          type="button"
          className={view === 'noise' ? 'tke-tab tke-selected' : 'tke-tab'}
          onClick={() => setView('noise')}
          title="Raw fBm field at the generator's frequency, before craters and clamping."
        >
          Noise
        </button>
      </div>

      <canvas
        ref={mapRef}
        className="tke-map"
        onClick={(e) => {
          if (!world) return;
          const picked = mapPointToTile(e.currentTarget, world, e.clientX, e.clientY);
          if (!picked) return;
          setTile(picked);
          setRow(picked.y);
          onPickTile?.(picked);
        }}
      />

      <div className="tke-map-readout">
        {tile && world ? (
          <>
            <code>
              [{tile.x},{tile.y}]
            </code>{' '}
            z{world.height(tile.x, tile.y)} · {surfaceAt?.name ?? '—'} · skin {biomeAt?.name ?? '—'}
          </>
        ) : (
          <span className="tke-hint">Click the map to inspect a column and move the cross-section.</span>
        )}
      </div>

      <label className="tke-field tke-field-inline">
        <span className="tke-field-label">Cross-section row {row}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, (world?.size ?? 1) - 1)}
          value={row}
          onChange={(e) => setRow(Number(e.target.value))}
        />
      </label>
      <canvas ref={sliceRef} className="tke-slice" />
    </div>
  );
}

export const MapsPanel = createSlot('EditorMapsPanel', DefaultMapsPanel);
