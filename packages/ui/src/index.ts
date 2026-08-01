/**
 * @takeon/ui — React shell for @takeon/engine.
 *
 * Two ideas:
 *  1. `MissionProvider` owns a running mission (engine lifecycle, HUD
 *     snapshot, toasts, persistence) and exposes it through hooks.
 *  2. Every component is registered by key through `createSlot`, so the app
 *     sitting on top of TakeOn can replace, wrap, restyle or extend any part
 *     of the interface via `TakeOnUIProvider` — no forking, no prop drilling.
 *
 * Import the stylesheet once: `import '@takeon/ui/styles.css'`.
 */

export {
  TakeOnUIProvider,
  useTakeOnUI,
  createSlot,
  useSlot,
  useSlotClass,
  useLabel,
  useLabels,
  Slot,
  cx,
  type TakeOnUIConfig,
  type TakeOnUIProviderProps,
  type SlotContent,
  type Slotted,
  type AnyComponent,
} from './registry.js';

export {
  MissionProvider,
  useMission,
  useMissionMaybe,
  useHud,
  useMissionActions,
  type MissionProviderProps,
  type MissionContextValue,
  type MissionActions,
  type MissionHud,
  type MissionPanel,
  type TileMenuTarget,
  type Toast,
  type ToastKind,
} from './mission-context.js';

export { TakeOnMission, type TakeOnMissionProps } from './TakeOnMission.js';

export { MissionScreen, type MissionScreenProps, type MissionScreenPart } from './components/MissionScreen.js';
export { MissionCanvas, type MissionCanvasProps } from './components/MissionCanvas.js';
export { HudBar, type HudBarProps } from './components/HudBar.js';
export { DPad, type DPadProps } from './components/DPad.js';
export { ActionBar, DEFAULT_ACTIONS, type ActionBarProps, type ActionItem } from './components/ActionBar.js';
export { Minimap, type MinimapProps } from './components/Minimap.js';
export { CrossSectionView, type CrossSectionViewProps } from './components/CrossSectionView.js';
export { TileMenu, type TileMenuProps } from './components/TileMenu.js';
export { BuildPanel, describeCargo, type BuildPanelProps } from './components/BuildPanel.js';
export { CraftPanel, type CraftPanelProps } from './components/CraftPanel.js';
export { CargoPanel } from './components/CargoPanel.js';
export { ToastStack, type ToastStackProps } from './components/ToastStack.js';
export { EndMissionDialog, type EndMissionDialogProps } from './components/EndMissionDialog.js';
export { Meter, Modal, Chip, type MeterProps, type ModalProps, type ChipProps } from './components/primitives.js';

/**
 * Every slot key the built-in UI registers. Handy for hosts that want to
 * enumerate what they can override (the editor lists these).
 */
export const SLOT_KEYS = [
  'MissionScreen',
  'MissionCanvas',
  'HudBar',
  'DPad',
  'ActionBar',
  'Minimap',
  'CrossSectionView',
  'TileMenu',
  'BuildPanel',
  'CraftPanel',
  'CargoPanel',
  'ToastStack',
  'EndMissionDialog',
  'Meter',
  'Modal',
  'Chip',
] as const;

/** Anchor points that accept host-supplied content. */
export const SLOT_ANCHORS = [
  'hudBar.start',
  'hudBar.end',
  'actionBar.start',
  'actionBar.end',
  'tileMenu.end',
  'mission.overlay',
] as const;
