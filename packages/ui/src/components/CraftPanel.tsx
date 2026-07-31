import { RECIPES, RESOURCE_NAMES, type ResourceKey } from '@takeon/engine';
import { useMission } from '../mission-context.js';
import { createSlot, useLabel } from '../registry.js';
import { describeCargo } from './BuildPanel.js';
import { Modal } from './primitives.js';

export interface CraftPanelProps {
  /** Restrict the recipe list (by recipe id). */
  allow?: string[];
}

function DefaultCraftPanel({ allow }: CraftPanelProps) {
  const { hud, actions, setPanel } = useMission();
  const title = useLabel('craft.title', 'Refining — from cargo, on the rover');
  const close = useLabel('common.close', 'Close');
  const cargo = hud?.cargo ?? {};
  const recipes = allow ? RECIPES.filter((r) => allow.includes(r.id)) : RECIPES;

  return (
    <Modal
      title={title}
      subtitle={`Cargo: ${describeCargo(cargo)}`}
      onClose={() => setPanel(null)}
      footer={
        <button type="button" className="tk-btn" onClick={() => setPanel(null)}>
          {close}
        </button>
      }
    >
      {recipes.map((rec) => {
        const affordable = Object.entries(rec.input).every(
          ([res, qty]) => (cargo[res as ResourceKey] ?? 0) >= (qty ?? 0),
        );
        return (
          <button
            key={rec.id}
            type="button"
            className="tk-option"
            disabled={!affordable}
            onClick={() => actions.craft(rec.id)}
          >
            <span className="tk-option-info">
              <b>
                {rec.name}
                {rec.near ? ' (needs refinery)' : ''}
              </b>
              <span className="tk-option-desc">{rec.description}</span>
            </span>
            <span className="tk-tag">
              {Object.entries(rec.input)
                .map(([res, qty]) => `${qty} ${RESOURCE_NAMES[res as ResourceKey]}`)
                .join(' + ')}{' '}
              → {rec.output.amount} {RESOURCE_NAMES[rec.output.resource]}
            </span>
          </button>
        );
      })}
    </Modal>
  );
}

export const CraftPanel = createSlot('CraftPanel', DefaultCraftPanel);
