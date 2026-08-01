import { createSlot } from '@takeon/ui';
import type { EditorEntry } from '../state.js';

export interface BodyBrowserProps {
  entries: EditorEntry[];
  selectedId: string;
  onSelect(id: string): void;
  onCreate(): void;
  onDuplicate(): void;
  onRemove(): void;
  canRemove: boolean;
}

/** Project tree: shipped destinations plus this project's drafts. */
function DefaultBodyBrowser({
  entries,
  selectedId,
  onSelect,
  onCreate,
  onDuplicate,
  onRemove,
  canRemove,
}: BodyBrowserProps) {
  return (
    <div className="tke-browser">
      <div className="tke-browser-actions">
        <button type="button" onClick={onCreate} title="New destination">
          + New
        </button>
        <button type="button" onClick={onDuplicate} title="Duplicate the selection">
          ⧉ Copy
        </button>
        <button type="button" onClick={onRemove} disabled={!canRemove} title="Discard this draft">
          ⌫ Discard
        </button>
      </div>
      <ul className="tke-list">
        {entries.map((entry) => (
          <li key={entry.body.id}>
            <button
              type="button"
              className={entry.body.id === selectedId ? 'tke-list-item tke-selected' : 'tke-list-item'}
              onClick={() => onSelect(entry.body.id)}
            >
              <span className="tke-dot" style={{ background: entry.body.palette.sky }} />
              <span className="tke-list-text">
                <b>{entry.body.name}</b>
                <em>
                  {entry.body.type} · {entry.body.size}² · seed {entry.body.seed}
                </em>
              </span>
              {entry.draft && <span className="tke-badge">{entry.builtin ? 'edited' : 'custom'}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const BodyBrowser = createSlot('EditorBodyBrowser', DefaultBodyBrowser);
