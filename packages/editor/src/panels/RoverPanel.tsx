import {
  canReach,
  computeStats,
  PARTS,
  type BodyDef,
  type PartCategory,
  type RoverSpec,
} from '@takeon/engine';
import { createSlot } from '@takeon/ui';

export interface RoverPanelProps {
  spec: RoverSpec;
  body: BodyDef;
  onChange(spec: RoverSpec): void;
}

const REQUIRED: PartCategory[] = ['chassis', 'wheels', 'power', 'battery'];
const MODULES: PartCategory[] = ['tool', 'camera', 'scanner', 'cargo', 'fuel'];

/**
 * The rover play mode uses. Mechanics work is mostly "does this drivetrain
 * cope with this terrain", so the climb/speed/energy numbers sit right next
 * to the terrain controls rather than in a separate customiser.
 */
function DefaultRoverPanel({ spec, body, onChange }: RoverPanelProps) {
  const stats = computeStats(spec);
  const slots = PARTS.find((p) => p.id === spec.chassis)?.stats.slots ?? 0;

  const setModule = (category: PartCategory, id: string) => {
    const others = spec.modules.filter((m) => PARTS.find((p) => p.id === m)?.category !== category);
    onChange({ ...spec, modules: id ? [...others, id] : others });
  };

  return (
    <div className="tke-rover">
      {REQUIRED.map((category) => (
        <label key={category} className="tke-field">
          <span className="tke-field-label">{category}</span>
          <select
            value={spec[category as 'chassis' | 'wheels' | 'power' | 'battery']}
            onChange={(e) => onChange({ ...spec, [category]: e.target.value })}
          >
            {PARTS.filter((p) => p.category === category).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (T{p.tier})
              </option>
            ))}
          </select>
        </label>
      ))}

      <div className="tke-hint">Modules: {spec.modules.length}/{slots} slots used</div>
      {MODULES.map((category) => {
        const current = spec.modules.find((m) => PARTS.find((p) => p.id === m)?.category === category) ?? '';
        return (
          <label key={category} className="tke-field">
            <span className="tke-field-label">{category}</span>
            <select value={current} onChange={(e) => setModule(category, e.target.value)}>
              <option value="">— none —</option>
              {PARTS.filter((p) => p.category === category).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (T{p.tier})
                </option>
              ))}
            </select>
          </label>
        );
      })}

      <dl className="tke-statlist">
        <div>
          <dt>climb</dt>
          <dd>{stats.maxClimb} voxels</dd>
        </div>
        <div>
          <dt>speed</dt>
          <dd>{stats.speed} tiles/s</dd>
        </div>
        <div>
          <dt>battery</dt>
          <dd>{stats.batteryCapacity}</dd>
        </div>
        <div>
          <dt>move cost</dt>
          <dd>{stats.moveEnergy}/tile</dd>
        </div>
        <div>
          <dt>cargo</dt>
          <dd>{stats.cargoCapacity}</dd>
        </div>
        <div>
          <dt>fuel</dt>
          <dd>
            {stats.fuelCapacity} / Δv {body.deltaV}
          </dd>
        </div>
      </dl>

      {!canReach(stats, body.deltaV) && (
        <div className="tke-warning">⚠ Not enough fuel to reach {body.name} in a real launch.</div>
      )}
      {stats.problems.map((p) => (
        <div key={p} className="tke-error">
          ✕ {p}
        </div>
      ))}
    </div>
  );
}

export const RoverPanel = createSlot('EditorRoverPanel', DefaultRoverPanel);
