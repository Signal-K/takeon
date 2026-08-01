import {
  analyzeTerrain,
  MATERIALS,
  RESOURCE_NAMES,
  type Material,
  type ResourceKey,
  type VoxelWorld,
} from '@takeon/engine';
import { createSlot } from '@takeon/ui';
import { useMemo } from 'react';

export interface AnalysisPanelProps {
  world: VoxelWorld | null;
  /** Climb limit used for the drivability figure. */
  maxClimb: number;
  version: number;
}

/**
 * The numbers behind the map: relief, steepness, drivable fraction, surface
 * mix and total recoverable resources. This is what turns "looks about right"
 * into "this world is 92% drivable and holds 1.2k iron".
 */
function DefaultAnalysisPanel({ world, maxClimb, version }: AnalysisPanelProps) {
  const analysis = useMemo(
    () => (world ? analyzeTerrain(world, { maxClimb }) : null),
    // `version` changes whenever the world is regenerated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, maxClimb, version],
  );
  if (!analysis) return <div className="tke-empty">No world generated yet.</div>;

  const surface = Object.entries(analysis.surface)
    .map(([m, count]) => ({ material: Number(m) as Material, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const resources = Object.entries(analysis.resources)
    .map(([r, amount]) => ({ resource: r as ResourceKey, amount: amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  const peak = Math.max(1, ...analysis.heightHistogram);

  return (
    <div className="tke-analysis">
      <div className="tke-stats">
        <Stat label="Columns" value={`${analysis.solidColumns}`} sub={`${(analysis.voidFraction * 100).toFixed(0)}% void`} />
        <Stat label="Height" value={`${analysis.minHeight}–${analysis.maxHeight}`} sub={`mean ${analysis.meanHeight.toFixed(1)}`} />
        <Stat label="Relief" value={`${analysis.relief}`} sub="voxels" />
        <Stat
          label="Drivable"
          value={`${(analysis.traversable.reachableFraction * 100).toFixed(0)}%`}
          sub={`climb ≤ ${maxClimb}`}
          tone={analysis.traversable.reachableFraction < 0.6 ? 'bad' : analysis.traversable.reachableFraction < 0.85 ? 'warn' : 'good'}
        />
        <Stat
          label="Cliffs"
          value={`${(analysis.slope.steepFraction * 100).toFixed(0)}%`}
          sub={`max step ${analysis.slope.max}`}
          tone={analysis.slope.steepFraction > 0.35 ? 'warn' : undefined}
        />
        <Stat label="Landing" value={`${analysis.landingSite.x},${analysis.landingSite.y}`} sub="deterministic" />
      </div>

      <h4>Height distribution</h4>
      <div className="tke-histogram">
        {analysis.heightHistogram.map((count, z) => (
          <span
            key={z}
            className="tke-bar"
            style={{ height: `${(count / peak) * 100}%` }}
            title={`z${z}: ${count} columns`}
          />
        ))}
      </div>

      <h4>Surface mix</h4>
      <ul className="tke-bars">
        {surface.map(({ material, count }) => (
          <li key={material}>
            <span className="tke-swatch" style={{ background: MATERIALS[material].colors[0] }} />
            <span className="tke-bars-label">{MATERIALS[material].name}</span>
            <span className="tke-bars-track">
              <span
                className="tke-bars-fill"
                style={{ width: `${(count / Math.max(1, analysis.solidColumns)) * 100}%`, background: MATERIALS[material].colors[0] }}
              />
            </span>
            <span className="tke-bars-value">{((count / Math.max(1, analysis.solidColumns)) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>

      <h4>Recoverable resources</h4>
      <table className="tke-table">
        <tbody>
          {resources.map(({ resource, amount }) => (
            <tr key={resource}>
              <td>{RESOURCE_NAMES[resource]}</td>
              <td>{amount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tke-hint">Totals assume every voxel is mined — treat them as an upper bound on mission yield.</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={tone ? `tke-stat tke-${tone}` : 'tke-stat'}>
      <span className="tke-stat-label">{label}</span>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

export const AnalysisPanel = createSlot('EditorAnalysisPanel', DefaultAnalysisPanel);
