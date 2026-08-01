/**
 * @takeon/editor — a minimal, embeddable game editor for TakeOn worlds.
 *
 * ```tsx
 * import { TakeOnEditor } from '@takeon/editor';
 * import '@takeon/ui/styles.css';
 * import '@takeon/editor/styles.css';
 *
 * <TakeOnEditor onChange={(project) => save(project)} />
 * ```
 *
 * The editor is a plain React component: it runs in this repo's Next.js app at
 * `/editor`, inside another game (Landnam) or in a desktop shell, and it edits
 * the same `BodyDef`s the engine generates worlds from — no separate format.
 */

export { TakeOnEditor, EDITOR_SLOT_KEYS, type TakeOnEditorProps, type EditorTheme } from './TakeOnEditor.js';
export {
  useEditorState,
  EDITOR_STORAGE_KEY,
  type EditorState,
  type EditorStateOptions,
  type EditorEntry,
  type EditorPersistedState,
  type EditorStorage,
} from './state.js';
export { useEditorSim, type EditorSim } from './useEditorSim.js';
export {
  paintMap,
  paintCrossSection,
  paintField,
  mapPointToTile,
  MAP_KINDS,
  type MapKind,
  type PaintOptions,
} from './maps.js';

export { Toolbar, type ToolbarProps } from './panels/Toolbar.js';
export { EditorCard, type EditorCardProps } from './panels/Card.js';
export { BodyBrowser, type BodyBrowserProps } from './panels/BodyBrowser.js';
export { Inspector, type InspectorProps } from './panels/Inspector.js';
export { Viewport, type ViewportProps } from './panels/Viewport.js';
export { MapsPanel, type MapsPanelProps } from './panels/MapsPanel.js';
export { AnalysisPanel, type AnalysisPanelProps } from './panels/AnalysisPanel.js';
export { RoverPanel, type RoverPanelProps } from './panels/RoverPanel.js';
export { ConsolePanel, type ConsoleLine, type ConsolePanelProps } from './panels/ConsolePanel.js';
