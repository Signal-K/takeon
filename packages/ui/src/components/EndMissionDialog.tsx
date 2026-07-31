import { useState } from 'react';
import { useMission } from '../mission-context.js';
import { createSlot, useLabel } from '../registry.js';
import { Modal } from './primitives.js';

export interface EndMissionDialogProps {
  /** Called after the yield has been banked (host usually routes away). */
  onEnded?(credits: number): void;
}

function DefaultEndMissionDialog({ onEnded }: EndMissionDialogProps) {
  const { hud, actions, setPanel } = useMission();
  const [busy, setBusy] = useState(false);
  const lost = hud?.status === 'lost';
  const keep = useLabel('end.keep', 'Keep driving');
  const title = useLabel(lost ? 'end.lostTitle' : 'end.title', lost ? 'Rover lost' : 'End mission and recover yield?');
  const confirm = useLabel(
    lost ? 'end.lostConfirm' : 'end.confirm',
    lost ? 'Write off rover & collect science' : 'Recover & end mission',
  );
  const subtitle = lost
    ? 'The mission is over, but documented discoveries and photos still count. Banked cache deposits are credited; cargo on the rover is not recovered.'
    : 'Cargo, cache deposits, photos and documented discoveries convert to credits.';

  return (
    <Modal title={title} subtitle={subtitle} onClose={() => (lost ? undefined : setPanel(null))}>
      <button
        type="button"
        className="tk-btn tk-btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const credits = await actions.endMission();
          setPanel(null);
          onEnded?.(credits);
        }}
      >
        {confirm}
      </button>
      {!lost && (
        <button type="button" className="tk-btn" onClick={() => setPanel(null)}>
          {keep}
        </button>
      )}
    </Modal>
  );
}

export const EndMissionDialog = createSlot('EndMissionDialog', DefaultEndMissionDialog);
