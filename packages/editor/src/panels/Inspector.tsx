import {
  BODY_FIELD_GROUPS,
  BODY_FIELDS,
  getBodyField,
  type BodyDef,
  type BodyField,
  type BodyValidation,
} from '@takeon/engine';
import { createSlot } from '@takeon/ui';
import { useState } from 'react';

export interface InspectorProps {
  body: BodyDef;
  validation: BodyValidation;
  onPatch(path: string, value: unknown): void;
  /** Extra fields contributed by the host game (same schema shape). */
  extraFields?: BodyField[];
}

/**
 * Property editor for the selected destination, generated from the engine's
 * field schema — so a new BodyDef property becomes editable by describing it
 * in `world/authoring.ts`, not by touching the editor.
 */
function DefaultInspector({ body, validation, onPatch, extraFields }: InspectorProps) {
  const fields = extraFields ? [...BODY_FIELDS, ...extraFields] : BODY_FIELDS;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="tke-inspector">
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="tke-validation">
          {validation.errors.map((e) => (
            <div key={e} className="tke-error">
              ✕ {e}
            </div>
          ))}
          {validation.warnings.map((w) => (
            <div key={w} className="tke-warning">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {BODY_FIELD_GROUPS.map((group) => {
        const groupFields = fields.filter((f) => f.group === group.id);
        if (groupFields.length === 0) return null;
        const open = !collapsed[group.id];
        return (
          <section key={group.id} className="tke-group">
            <button
              type="button"
              className="tke-group-head"
              onClick={() => setCollapsed((c) => ({ ...c, [group.id]: open }))}
              title={group.help}
            >
              <span className="tke-caret">{open ? '▾' : '▸'}</span>
              {group.label}
            </button>
            {open && (
              <div className="tke-group-body">
                {groupFields.map((field) => (
                  <Field key={field.path} field={field} body={body} onPatch={onPatch} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Field({ field, body, onPatch }: { field: BodyField; body: BodyDef; onPatch: InspectorProps['onPatch'] }) {
  const raw = getBodyField(body, field.path);

  if (field.kind === 'boolean') {
    return (
      <label className="tke-field tke-field-inline" title={field.help}>
        <input type="checkbox" checked={Boolean(raw)} onChange={(e) => onPatch(field.path, e.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.kind === 'select') {
    return (
      <label className="tke-field" title={field.help}>
        <span className="tke-field-label">{field.label}</span>
        <select value={String(raw ?? '')} onChange={(e) => onPatch(field.path, e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.kind === 'color') {
    const value = typeof raw === 'string' && raw ? raw : '#000000';
    return (
      <label className="tke-field" title={field.help}>
        <span className="tke-field-label">{field.label}</span>
        <span className="tke-colour-row">
          <input type="color" value={value} onChange={(e) => onPatch(field.path, e.target.value)} />
          <input type="text" value={value} onChange={(e) => onPatch(field.path, e.target.value)} />
        </span>
      </label>
    );
  }

  if (field.kind === 'longtext') {
    return (
      <label className="tke-field" title={field.help}>
        <span className="tke-field-label">{field.label}</span>
        <textarea rows={3} value={String(raw ?? '')} onChange={(e) => onPatch(field.path, e.target.value)} />
      </label>
    );
  }

  if (field.kind === 'text') {
    return (
      <label className="tke-field" title={field.help}>
        <span className="tke-field-label">{field.label}</span>
        <input type="text" value={String(raw ?? '')} onChange={(e) => onPatch(field.path, e.target.value)} />
      </label>
    );
  }

  const value = typeof raw === 'number' ? raw : 0;
  const bounded = field.min !== undefined && field.max !== undefined;
  return (
    <label className="tke-field" title={field.help}>
      <span className="tke-field-label">
        {field.label}
        {field.unit && <em> ({field.unit})</em>}
        {field.affectsTerrain && <b className="tke-regen" title="Regenerates the world">↻</b>}
      </span>
      <span className="tke-number-row">
        {bounded && (
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={value}
            onChange={(e) => onPatch(field.path, Number(e.target.value))}
          />
        )}
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={value}
          onChange={(e) => onPatch(field.path, Number(e.target.value))}
        />
      </span>
    </label>
  );
}

export const Inspector = createSlot('EditorInspector', DefaultInspector);
