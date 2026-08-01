import { RESOURCE_NAMES, STRUCTURES, type ResourceKey, type StructureType } from '@takeon/engine';
import { useMission } from '../mission-context.js';
import { createSlot, useLabel } from '../registry.js';
import { Modal } from './primitives.js';

export interface BuildPanelProps {
  /** Restrict what this game lets the player build. */
  allow?: StructureType[];
}

function DefaultBuildPanel({ allow }: BuildPanelProps) {
  const { hud, actions, setPanel } = useMission();
  const title = useLabel('build.title', 'Construction');
  const close = useLabel('common.close', 'Close');
  const cargo = hud?.cargo ?? {};
  const options = Object.values(STRUCTURES)
    .filter((def) => def.buildable !== false)
    .filter((def) => !allow || allow.includes(def.type));

  return (
    <Modal
      title={title}
      subtitle={`Structures rise on the tile ahead of the rover, paid for out of the hold. Carrying: ${describeCargo(cargo)}`}
      onClose={() => setPanel(null)}
      footer={
        <button type="button" className="tk-btn" onClick={() => setPanel(null)}>
          {close}
        </button>
      }
    >
      {options.map((def) => {
        const affordable = Object.entries(def.cost).every(
          ([res, qty]) => (cargo[res as ResourceKey] ?? 0) >= (qty ?? 0),
        );
        return (
          <button
            key={def.type}
            type="button"
            className="tk-option"
            disabled={!affordable}
            onClick={() => {
              actions.build(def.type);
              setPanel(null);
            }}
          >
            <span className="tk-option-info">
              <b>{def.name}</b>
              <span className="tk-option-desc">{def.description}</span>
            </span>
            <span className="tk-tag">
              {Object.entries(def.cost)
                .map(([res, qty]) => `${qty} ${RESOURCE_NAMES[res as ResourceKey]}`)
                .join(' + ')}
            </span>
          </button>
        );
      })}
    </Modal>
  );
}

export function describeCargo(cargo: Partial<Record<ResourceKey, number>>): string {
  const parts = Object.entries(cargo)
    .filter(([, qty]) => (qty ?? 0) > 0)
    .map(([res, qty]) => `${qty} ${RESOURCE_NAMES[res as ResourceKey]}`);
  return parts.length > 0 ? parts.join(', ') : 'empty';
}

export const BuildPanel = createSlot('BuildPanel', DefaultBuildPanel);
