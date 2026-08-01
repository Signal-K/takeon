import { RESOURCE_NAMES, RESOURCE_VALUE, type ResourceKey } from '@takeon/engine';
import { useMission } from '../mission-context.js';
import { createSlot, useLabel } from '../registry.js';
import { Modal } from './primitives.js';

/**
 * What the rover is carrying versus what has already been banked, with the
 * credit value of each — the "am I done here yet?" panel.
 */
function DefaultCargoPanel() {
  const { hud, setPanel } = useMission();
  const title = useLabel('cargo.title', 'Manifest');
  const close = useLabel('common.close', 'Close');
  const rows = mergeRows(hud?.cargo ?? {}, hud?.banked ?? {});
  const total = rows.reduce((sum, r) => sum + (RESOURCE_VALUE[r.resource] ?? 0) * (r.held + r.banked), 0);

  return (
    <Modal
      title={title}
      subtitle={`Anomalies documented ${hud?.anomalies.documented ?? 0}/${hud?.anomalies.total ?? 0} · structures ${hud?.structures ?? 0}`}
      onClose={() => setPanel(null)}
      footer={
        <button type="button" className="tk-btn" onClick={() => setPanel(null)}>
          {close}
        </button>
      }
    >
      <table className="tk-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Hold</th>
            <th>Banked</th>
            <th>Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>Nothing collected yet.</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.resource}>
              <td>{RESOURCE_NAMES[r.resource]}</td>
              <td>{r.held || '—'}</td>
              <td>{r.banked || '—'}</td>
              <td>{(RESOURCE_VALUE[r.resource] ?? 0) * (r.held + r.banked)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tk-modal-sub">Estimated payout from resources: {total} credits (photos and discoveries add more).</p>
    </Modal>
  );
}

function mergeRows(
  cargo: Partial<Record<ResourceKey, number>>,
  banked: Partial<Record<ResourceKey, number>>,
): { resource: ResourceKey; held: number; banked: number }[] {
  const keys = new Set<ResourceKey>([
    ...(Object.keys(cargo) as ResourceKey[]),
    ...(Object.keys(banked) as ResourceKey[]),
  ]);
  return [...keys]
    .map((resource) => ({ resource, held: cargo[resource] ?? 0, banked: banked[resource] ?? 0 }))
    .filter((r) => r.held > 0 || r.banked > 0)
    .sort((a, b) => b.held + b.banked - (a.held + a.banked));
}

export const CargoPanel = createSlot('CargoPanel', DefaultCargoPanel);
