import { bodyToJson, bodyToTypeScript, type BodyDef } from '@takeon/engine';
import { createSlot } from '@takeon/ui';
import { useState } from 'react';

export interface ToolbarProps {
  body: BodyDef;
  mode: 'edit' | 'play';
  theme: 'light' | 'dark';
  canPlay: boolean;
  canUndo: boolean;
  canRedo: boolean;
  generating: boolean;
  genMs: number;
  maxClimb: number;
  onMaxClimb(value: number): void;
  onMode(mode: 'edit' | 'play'): void;
  onTheme(theme: 'light' | 'dark'): void;
  onUndo(): void;
  onRedo(): void;
  onReseed(): void;
  onRegenerate(): void;
  onImport(text: string): { ok: boolean; errors: string[] };
}

/** Play/stop, history, seed and import/export — the editor's top bar. */
function DefaultToolbar({
  body,
  mode,
  theme,
  canPlay,
  canUndo,
  canRedo,
  generating,
  genMs,
  maxClimb,
  onMaxClimb,
  onMode,
  onTheme,
  onUndo,
  onRedo,
  onReseed,
  onRegenerate,
  onImport,
}: ToolbarProps) {
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState('');

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      // Clipboard is permission-gated; downloading always works.
      download(`${body.id}.${label === 'TS' ? 'ts' : 'json'}`, value);
    }
  };

  return (
    <div className="tke-toolbar">
      <button
        type="button"
        className={mode === 'play' ? 'tke-primary tke-playing' : 'tke-primary'}
        onClick={() => onMode(mode === 'play' ? 'edit' : 'play')}
        disabled={!canPlay && mode === 'edit'}
        title={canPlay ? 'Drive this world with the editor rover' : 'Fix the validation errors first'}
      >
        {mode === 'play' ? '■ Stop' : '▶ Play'}
      </button>

      <span className="tke-divider" />
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)">
        ↶
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⌘/Ctrl+Shift+Z)">
        ↷
      </button>

      <span className="tke-divider" />
      <button type="button" onClick={onReseed} title="Roll a new seed">
        🎲 Seed
      </button>
      <button type="button" onClick={onRegenerate} title="Rebuild the world from the current settings">
        ↻ Regenerate
      </button>
      <label className="tke-inline-range" title="Drivetrain climb limit used by the slope and drivability views">
        climb ≤ {maxClimb}
        <input type="range" min={1} max={5} step={1} value={maxClimb} onChange={(e) => onMaxClimb(Number(e.target.value))} />
      </label>

      <span className="tke-spacer" />
      <span className="tke-status">
        {generating ? 'generating…' : `${body.size}² · ${genMs.toFixed(0)} ms`}
        {copied && ` · ${copied} copied`}
      </span>
      <button type="button" onClick={() => copy('JSON', bodyToJson(body))} title="Copy BodyDef JSON">
        ⧉ JSON
      </button>
      <button type="button" onClick={() => copy('TS', bodyToTypeScript(body))} title="Copy a TypeScript literal for world/bodies.ts">
        ⧉ TS
      </button>
      <button type="button" onClick={() => download(`${body.id}.json`, bodyToJson(body))} title="Download BodyDef JSON">
        ⭳
      </button>
      <button type="button" onClick={() => setImporting(true)}>
        ⭱ Import
      </button>
      <button
        type="button"
        onClick={() => onTheme(theme === 'light' ? 'dark' : 'light')}
        title={theme === 'light' ? 'Switch to dark chrome' : 'Switch to light chrome'}
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>

      {importing && (
        <div className="tke-backdrop" onClick={() => setImporting(false)} role="presentation">
          <div className="tke-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Import a destination</h3>
            <p className="tke-hint">Paste a BodyDef JSON object. Missing fields fall back to draft defaults.</p>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            {errors.map((e) => (
              <div key={e} className="tke-error">
                ✕ {e}
              </div>
            ))}
            <div className="tke-dialog-actions">
              <button
                type="button"
                className="tke-primary"
                onClick={() => {
                  const result = onImport(text);
                  setErrors(result.errors);
                  if (result.errors.length === 0) {
                    setImporting(false);
                    setText('');
                  }
                }}
              >
                Import
              </button>
              <button type="button" onClick={() => setImporting(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const Toolbar = createSlot('EditorToolbar', DefaultToolbar);
