import { analyzeTerrain, type BodyDef, type BodyField, type RoverGame, type RoverSpec } from '@takeon/engine';
import { MissionProvider, MissionScreen, TakeOnUIProvider, type TakeOnUIConfig } from '@takeon/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisPanel } from './panels/AnalysisPanel.js';
import { BodyBrowser } from './panels/BodyBrowser.js';
import { ConsolePanel, type ConsoleLine } from './panels/ConsolePanel.js';
import { Inspector } from './panels/Inspector.js';
import { MapsPanel } from './panels/MapsPanel.js';
import { RoverPanel } from './panels/RoverPanel.js';
import { Toolbar } from './panels/Toolbar.js';
import { Viewport } from './panels/Viewport.js';
import { useEditorSim } from './useEditorSim.js';
import { useEditorState, type EditorPersistedState, type EditorStorage } from './state.js';

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
  /** Overrides for the editor's own panels and for the in-editor mission HUD. */
  ui?: TakeOnUIConfig;
  className?: string;
}

/**
 * A minimal game editor for TakeOn worlds — scene view, inspector, project
 * tree, analysis and play mode, in the browser or in a desktop shell.
 *
 * It is one React component with no routing of its own, so it drops into this
 * repo's Next.js app, into Landnam, or into an Electron window unchanged.
 * Every panel is registered through @takeon/ui's slot registry, so a host can
 * replace any of them (see `EDITOR_SLOT_KEYS`).
 */
export function TakeOnEditor({
  bodies,
  storage,
  storageKey,
  publish,
  onChange,
  extraFields,
  ui,
  className,
}: TakeOnEditorProps) {
  const editor = useEditorState({ bodies, storage, storageKey, publish, onChange });
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [maxClimb, setMaxClimb] = useState(2);
  const [time, setTime] = useState(0);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [tab, setTab] = useState<'maps' | 'analysis' | 'rover'>('maps');

  const { sim, world, version, ms, generating, regenerate } = useEditorSim(editor.body, editor.spec, mode === 'edit');

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

  return (
    <TakeOnUIProvider {...ui} className={className ? `tke-root ${className}` : 'tke-root'}>
      <Toolbar
        body={editor.body}
        mode={mode}
        canPlay={editor.validation.ok}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        generating={generating}
        genMs={ms}
        maxClimb={maxClimb}
        onMaxClimb={setMaxClimb}
        onMode={setMode}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onReseed={() => editor.patch('seed', Math.floor(Math.random() * 100000))}
        onRegenerate={regenerate}
        onImport={editor.importJson}
      />

      <div className="tke-layout">
        <aside className="tke-side tke-left">
          <PanelHeader title="Destinations" />
          <BodyBrowser
            entries={editor.entries}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            onCreate={editor.create}
            onDuplicate={editor.duplicate}
            onRemove={editor.remove}
            canRemove={editor.isDraft}
          />
        </aside>

        <main className="tke-centre">
          <div className="tke-stage">
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
          </div>
          <ConsolePanel lines={lines} onClear={() => setLines([])} />
        </main>

        <aside className="tke-side tke-right">
          <PanelHeader title={`Inspector — ${editor.body.name}`} />
          <Inspector
            body={editor.body}
            validation={editor.validation}
            onPatch={editor.patch}
            extraFields={extraFields}
          />
          <div className="tke-tabs tke-tabs-sticky">
            <button type="button" className={tab === 'maps' ? 'tke-tab tke-selected' : 'tke-tab'} onClick={() => setTab('maps')}>
              Maps
            </button>
            <button
              type="button"
              className={tab === 'analysis' ? 'tke-tab tke-selected' : 'tke-tab'}
              onClick={() => setTab('analysis')}
            >
              Analysis
            </button>
            <button type="button" className={tab === 'rover' ? 'tke-tab tke-selected' : 'tke-tab'} onClick={() => setTab('rover')}>
              Rover
            </button>
          </div>
          {tab === 'maps' && (
            <MapsPanel body={editor.body} world={world} version={version} maxClimb={maxClimb} from={landing} />
          )}
          {tab === 'analysis' && <AnalysisPanel world={world} maxClimb={maxClimb} version={version} />}
          {tab === 'rover' && <RoverPanel spec={editor.spec} body={editor.body} onChange={setSpec} />}
        </aside>
      </div>
    </TakeOnUIProvider>
  );
}

function PanelHeader({ title }: { title: string }) {
  return <h2 className="tke-panel-head">{title}</h2>;
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
  'EditorBodyBrowser',
  'EditorInspector',
  'EditorViewport',
  'EditorMapsPanel',
  'EditorAnalysisPanel',
  'EditorRoverPanel',
  'EditorConsolePanel',
] as const;
