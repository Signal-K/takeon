import { analyzeTerrain, type BodyDef, type BodyField, type RoverGame, type RoverSpec } from '@takeon/engine';
import { MissionProvider, MissionScreen, TakeOnUIProvider, type TakeOnUIConfig } from '@takeon/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisPanel } from './panels/AnalysisPanel.js';
import { BodyBrowser } from './panels/BodyBrowser.js';
import { EditorCard } from './panels/Card.js';
import { ConsolePanel, type ConsoleLine } from './panels/ConsolePanel.js';
import { Inspector } from './panels/Inspector.js';
import { MapsPanel } from './panels/MapsPanel.js';
import { RoverPanel } from './panels/RoverPanel.js';
import { Toolbar } from './panels/Toolbar.js';
import { Viewport } from './panels/Viewport.js';
import { useEditorSim } from './useEditorSim.js';
import { useEditorState, type EditorPersistedState, type EditorStorage } from './state.js';

export type EditorTheme = 'light' | 'dark';

export interface TakeOnEditorProps {
  /** Extra destinations to edit alongside the built-ins (e.g. backend rows). */
  bodies?: BodyDef[];
  /** Where the project is stored; pass null to keep it in memory only. */
  storage?: EditorStorage | null;
  storageKey?: string;
  /** Publish drafts to the engine's body registry as they change (default true). */
  publish?: boolean;
  /** Fires on every project change — persist to your own backend here. */
  onChange?(state: EditorPersistedState): void;
  /** Host-specific inspector fields, using the engine's field schema shape. */
  extraFields?: BodyField[];
  /** Initial chrome theme (default light); the toolbar toggle overrides it. */
  theme?: EditorTheme;
  /** Overrides for the editor's own panels and for the in-editor mission HUD. */
  ui?: TakeOnUIConfig;
  className?: string;
}

const THEME_KEY = 'takeon.editor.theme';

/**
 * A minimal game editor for TakeOn worlds — scene view, inspector, project
 * tree, terrain instruments and play mode, in the browser or in a desktop
 * shell.
 *
 * Layout is one uniform grid of equal-height cards rather than sidebars: every
 * panel has the same header, the same footprint and the same scroll behaviour,
 * so nothing shifts as content grows. It is a single React component with no
 * routing of its own, so it drops into this repo's Next.js app, into Landnam,
 * or into an Electron window unchanged. Every panel is registered through
 * @takeon/ui's slot registry (see `EDITOR_SLOT_KEYS`).
 */
export function TakeOnEditor({
  bodies,
  storage,
  storageKey,
  publish,
  onChange,
  extraFields,
  theme: initialTheme = 'light',
  ui,
  className,
}: TakeOnEditorProps) {
  const editor = useEditorState({ bodies, storage, storageKey, publish, onChange });
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [theme, setTheme] = useState<EditorTheme>(initialTheme);
  const [maxClimb, setMaxClimb] = useState(2);
  const [time, setTime] = useState(0);
  const [lines, setLines] = useState<ConsoleLine[]>([]);

  const { sim, world, version, ms, generating, regenerate } = useEditorSim(editor.body, editor.spec, mode === 'edit');

  // Remember the chrome theme across sessions; the scene stays dark either way.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const landing = useMemo(
    () => (world ? analyzeTerrain(world, { maxClimb }).landingSite : null),
    // Recomputed with the world; `version` marks a fresh build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, version, maxClimb],
  );

  // Stop play mode when the world being played is edited out from under it.
  useEffect(() => {
    if (mode === 'play' && !editor.validation.ok) setMode('edit');
  }, [mode, editor.validation.ok]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const playGame = useRef<RoverGame | null>(null);
  const log = useCallback((key: string, payload: unknown) => {
    // `tick` fires 10×/s and `stateChanged` shadows other events — logging
    // them would bury everything the designer actually pressed a button for.
    if (key === 'tick' || key === 'stateChanged') return;
    setLines((cur) => {
      const line: ConsoleLine = {
        id: (cur[cur.length - 1]?.id ?? 0) + 1,
        t: playGame.current?.sim.time ?? 0,
        key,
        detail: summarise(payload),
      };
      return [...cur.slice(-199), line];
    });
  }, []);

  const setSpec = (spec: RoverSpec) => editor.setSpec(spec);
  const problems = editor.validation.errors.length + editor.validation.warnings.length;

  return (
    <TakeOnUIProvider {...ui} className={className ? `tke-root ${className}` : 'tke-root'}>
      <div className="tke-shell" data-theme={theme}>
        <Toolbar
          body={editor.body}
          mode={mode}
          theme={theme}
          canPlay={editor.validation.ok}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          generating={generating}
          genMs={ms}
          maxClimb={maxClimb}
          onMaxClimb={setMaxClimb}
          onMode={setMode}
          onTheme={setTheme}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onReseed={() => editor.patch('seed', Math.floor(Math.random() * 100000))}
          onRegenerate={regenerate}
          onImport={editor.importJson}
        />

        <div className="tke-grid">
          <EditorCard
            title={mode === 'play' ? `Play — ${editor.body.name}` : `Scene — ${editor.body.name}`}
            hint={mode === 'play' ? 'live mission' : 'drag pan · wheel zoom · R rotate · F frame'}
            className="tke-card-scene"
            flush
          >
            {mode === 'play' ? (
              <MissionProvider
                key={`${editor.body.id}:${editor.body.seed}`}
                body={editor.body}
                spec={editor.spec}
                audio={false}
                autosaveMs={0}
                onReady={(game) => {
                  playGame.current = game;
                }}
                onEvent={(key, payload) => log(key, payload)}
              >
                <MissionScreen />
              </MissionProvider>
            ) : (
              <Viewport sim={sim} version={version} generating={generating} time={time} onTimeChange={setTime} />
            )}
          </EditorCard>

          <EditorCard title="Inspector" hint={problems > 0 ? `${problems} note(s)` : 'valid'}>
            <Inspector
              body={editor.body}
              validation={editor.validation}
              onPatch={editor.patch}
              extraFields={extraFields}
            />
          </EditorCard>

          <EditorCard title="Maps" hint="click to inspect a column">
            <MapsPanel body={editor.body} world={world} version={version} maxClimb={maxClimb} from={landing} />
          </EditorCard>

          <EditorCard title="Analysis" hint={`climb ≤ ${maxClimb}`}>
            <AnalysisPanel world={world} maxClimb={maxClimb} version={version} />
          </EditorCard>

          <EditorCard title="Rover" hint="used by play mode">
            <RoverPanel spec={editor.spec} body={editor.body} onChange={setSpec} />
          </EditorCard>

          <EditorCard title="Destinations" hint="drafts shadow the shipped catalog" className="tke-card-wide">
            <BodyBrowser
              entries={editor.entries}
              selectedId={editor.selectedId}
              onSelect={editor.select}
              onCreate={editor.create}
              onDuplicate={editor.duplicate}
              onRemove={editor.remove}
              canRemove={editor.isDraft}
            />
          </EditorCard>

          <EditorCard
            title="Events"
            hint="engine events during play"
            className="tke-card-wide"
            actions={
              <button type="button" onClick={() => setLines([])}>
                Clear
              </button>
            }
            flush
          >
            <ConsolePanel lines={lines} onClear={() => setLines([])} />
          </EditorCard>
        </div>
      </div>
    </TakeOnUIProvider>
  );
}

function summarise(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.x === 'number' && typeof obj.y === 'number') parts.push(`${key}=[${obj.x},${obj.y}]`);
      continue;
    }
    if (typeof value === 'string' && value.length > 40) continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.slice(0, 4).join(' ');
}

/** Panel slot keys a host can override through `TakeOnUIProvider`. */
export const EDITOR_SLOT_KEYS = [
  'EditorToolbar',
  'EditorCard',
  'EditorBodyBrowser',
  'EditorInspector',
  'EditorViewport',
  'EditorMapsPanel',
  'EditorAnalysisPanel',
  'EditorRoverPanel',
  'EditorConsolePanel',
] as const;
