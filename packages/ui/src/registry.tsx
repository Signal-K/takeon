import {
  createContext,
  useContext,
  useMemo,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * The component registry.
 *
 * Every piece of TakeOn's UI is rendered through `createSlot`, which looks the
 * component up by key before falling back to the built-in default. A parent
 * app sitting on top of TakeOn (Landnam, the editor, your own shell) can
 * therefore replace, wrap or restyle any part of the interface without
 * forking this package:
 *
 * ```tsx
 * <TakeOnUIProvider
 *   components={{ ActionBar: MyActionBar }}      // replace outright
 *   labels={{ 'action.mine': 'Dig' }}            // reskin the words
 *   classNames={{ HudBar: 'my-hud' }}            // restyle in place
 *   slots={{ 'hudBar.end': <MyClock /> }}        // inject extra chrome
 * >
 *   <MissionScreen />
 * </TakeOnUIProvider>
 * ```
 *
 * An override that wants to keep the stock markup renders the default it is
 * replacing: `ActionBar.Default`. Rendering `<ActionBar/>` from inside its own
 * override is safe too — the registry suppresses the override one level deep
 * rather than recursing forever.
 */

// Overrides are supplied by hosts we cannot type ahead of time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = ComponentType<any>;

export type SlotContent = ReactNode | (() => ReactNode);

export interface TakeOnUIConfig {
  /** Replace built-in components, keyed by slot name (see `SLOT_KEYS`). */
  components?: Record<string, AnyComponent | undefined>;
  /** Override user-visible strings and icons. */
  labels?: Record<string, string | undefined>;
  /** Extra class names appended to a component's root element. */
  classNames?: Record<string, string | undefined>;
  /** Content injected at named anchor points inside built-in components. */
  slots?: Record<string, SlotContent>;
  /** CSS custom properties applied to the TakeOn scope (without `--tk-`). */
  theme?: Record<string, string | number | undefined>;
}

interface Resolved extends Required<Omit<TakeOnUIConfig, 'theme'>> {
  theme: Record<string, string | number | undefined>;
}

const EMPTY: Resolved = {
  components: {},
  labels: {},
  classNames: {},
  slots: {},
  theme: {},
};

const UIContext = createContext<Resolved>(EMPTY);
/** Slots currently being rendered through an override, to stop recursion. */
const ActiveOverrides = createContext<Record<string, boolean>>({});

export interface TakeOnUIProviderProps extends TakeOnUIConfig {
  children: ReactNode;
  /** Class for the scope element (which is `display: contents` by default). */
  className?: string;
  style?: CSSProperties;
}

/**
 * Supplies UI configuration to everything below it. Nesting is additive: an
 * inner provider merges over the outer one, so an app can set house style at
 * the root and a single screen can still swap one panel.
 */
export function TakeOnUIProvider({
  children,
  className,
  style,
  components,
  labels,
  classNames,
  slots,
  theme,
}: TakeOnUIProviderProps) {
  const parent = useContext(UIContext);
  const value = useMemo<Resolved>(
    () => ({
      components: { ...parent.components, ...components },
      labels: { ...parent.labels, ...labels },
      classNames: mergeClassNames(parent.classNames, classNames),
      slots: { ...parent.slots, ...slots },
      theme: { ...parent.theme, ...theme },
    }),
    [parent, components, labels, classNames, slots, theme],
  );

  const vars: CSSProperties = { ...style };
  for (const [key, val] of Object.entries(value.theme)) {
    if (val === undefined) continue;
    (vars as Record<string, string | number>)[`--tk-${key}`] = val;
  }

  return (
    <UIContext.Provider value={value}>
      <div className={cx('tk-scope', className)} style={vars}>
        {children}
      </div>
    </UIContext.Provider>
  );
}

function mergeClassNames(
  a: Record<string, string | undefined>,
  b: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const out = { ...a };
  for (const [key, val] of Object.entries(b)) {
    out[key] = out[key] ? `${out[key]} ${val ?? ''}`.trim() : val;
  }
  return out;
}

export function useTakeOnUI(): Resolved {
  return useContext(UIContext);
}

/** A component that can be replaced through the registry. */
export type Slotted<P> = ComponentType<P> & {
  /** The stock implementation — render it to wrap rather than replace. */
  Default: ComponentType<P>;
  slotKey: string;
};

/** Wrap a default implementation so hosts can override it by key. */
export function createSlot<P extends object>(key: string, Default: ComponentType<P>): Slotted<P> {
  function Slot(props: P) {
    const { components } = useTakeOnUI();
    const active = useContext(ActiveOverrides);
    const override = active[key] ? undefined : (components[key] as ComponentType<P> | undefined);
    if (!override) return <Default {...props} />;
    const Override = override;
    const next = { ...active, [key]: true };
    return (
      <ActiveOverrides.Provider value={next}>
        <Override {...props} />
      </ActiveOverrides.Provider>
    );
  }
  Slot.displayName = `TakeOn(${key})`;
  const slotted = Slot as unknown as Slotted<P>;
  slotted.Default = Default;
  slotted.slotKey = key;
  return slotted;
}

/** Extra classes a host attached to this slot, if any. */
export function useSlotClass(key: string): string | undefined {
  return useTakeOnUI().classNames[key];
}

/** Render host-injected content for a named anchor point. */
export function useSlot(name: string): ReactNode {
  const content = useTakeOnUI().slots[name];
  return typeof content === 'function' ? content() : (content ?? null);
}

/** Anchor points built-in components expose to hosts. */
export function Slot({ name }: { name: string }) {
  return <>{useSlot(name)}</>;
}

export function useLabels(): Record<string, string | undefined> {
  return useTakeOnUI().labels;
}

/** A user-visible string, overridable by the host. */
export function useLabel(key: string, fallback: string): string {
  return useLabels()[key] ?? fallback;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
