import {
  BODIES,
  cloneBody,
  createBodyDraft,
  defaultSpec,
  forkBody,
  parseBodyJson,
  registerBodies,
  setBodyField,
  validateBody,
  type BodyDef,
  type BodyValidation,
  type RoverSpec,
} from '@takeon/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Editor project state: the body drafts being authored, the rover used for
 * play mode, the selection and an undo stack.
 *
 * Drafts shadow built-in destinations by id, exactly like the engine's runtime
 * registry — so "edit Mars, press play" runs the edited Mars everywhere in the
 * host app, and deleting the draft restores the shipped one.
 */

export const EDITOR_STORAGE_KEY = 'takeon.editor.v1';
const HISTORY_LIMIT = 60;

export interface EditorPersistedState {
  version: 1;
  drafts: BodyDef[];
  selectedId: string;
  spec: RoverSpec;
}

export interface EditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EditorEntry {
  body: BodyDef;
  /** Present in the shipped catalog. */
  builtin: boolean;
  /** Being overridden or newly authored in this project. */
  draft: boolean;
}

export interface EditorStateOptions {
  /** Extra bodies to expose alongside the built-ins (e.g. backend rows). */
  bodies?: BodyDef[];
  storage?: EditorStorage | null;
  storageKey?: string;
  /** Publish drafts to the engine registry as they change (default true). */
  publish?: boolean;
  onChange?(state: EditorPersistedState): void;
}

export interface EditorState {
  entries: EditorEntry[];
  selectedId: string;
  body: BodyDef;
  validation: BodyValidation;
  spec: RoverSpec;
  isDraft: boolean;
  canUndo: boolean;
  canRedo: boolean;
  select(id: string): void;
  /** Edit a dotted field path on the selected body. */
  patch(path: string, value: unknown): void;
  /** Replace the selected body wholesale (import, randomise…). */
  replace(body: BodyDef): void;
  create(): void;
  duplicate(): void;
  /** Drop the draft: custom bodies disappear, edited built-ins revert. */
  remove(): void;
  setSpec(spec: RoverSpec): void;
  undo(): void;
  redo(): void;
  importJson(text: string): { ok: boolean; errors: string[] };
  /** Everything the host would want to persist itself. */
  snapshot(): EditorPersistedState;
}

interface Doc {
  drafts: BodyDef[];
  selectedId: string;
}

interface Store {
  doc: Doc;
  past: Doc[];
  future: Doc[];
}

export function useEditorState(opts: EditorStateOptions = {}): EditorState {
  const { bodies: extra, storage = defaultStorage(), storageKey = EDITOR_STORAGE_KEY, publish = true } = opts;

  const catalog = useMemo(() => {
    const merged = [...BODIES];
    for (const b of extra ?? []) {
      const i = merged.findIndex((m) => m.id === b.id);
      if (i >= 0) merged[i] = b;
      else merged.push(b);
    }
    return merged;
  }, [extra]);

  const initial = useRef<EditorPersistedState | null>(null);
  if (initial.current === null) initial.current = load(storage, storageKey, catalog);

  const [store, setStore] = useState<Store>({
    doc: { drafts: initial.current.drafts, selectedId: initial.current.selectedId },
    past: [],
    future: [],
  });
  const [spec, setSpec] = useState<RoverSpec>(initial.current.spec);
  const doc = store.doc;

  const entries = useMemo<EditorEntry[]>(() => {
    const draftIds = new Set(doc.drafts.map((d) => d.id));
    const builtinIds = new Set(catalog.map((b) => b.id));
    const out: EditorEntry[] = catalog.map((b) => ({
      body: doc.drafts.find((d) => d.id === b.id) ?? b,
      builtin: true,
      draft: draftIds.has(b.id),
    }));
    for (const d of doc.drafts) {
      if (!builtinIds.has(d.id)) out.push({ body: d, builtin: false, draft: true });
    }
    return out;
  }, [catalog, doc]);

  const selected = entries.find((e) => e.body.id === doc.selectedId) ?? entries[0];
  const body = selected?.body ?? createBodyDraft();
  const validation = useMemo(() => validateBody(body), [body]);

  // Persist and publish. Publishing means a mission started anywhere in the
  // host app resolves the edited definition — that is what makes play mode
  // (and the rest of the game) reflect the editor.
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  useEffect(() => {
    const state: EditorPersistedState = { version: 1, drafts: doc.drafts, selectedId: doc.selectedId, spec };
    if (storage) {
      try {
        storage.setItem(storageKey, JSON.stringify(state));
      } catch (err) {
        console.warn('[takeon-editor] could not persist project', err);
      }
    }
    if (publish) registerBodies(doc.drafts);
    onChangeRef.current?.(state);
  }, [doc, spec, storage, storageKey, publish]);

  const commit = useCallback((fn: (cur: Doc) => Doc) => {
    setStore((s) => {
      const next = fn(s.doc);
      if (next === s.doc) return s;
      return { doc: next, past: [...s.past.slice(-HISTORY_LIMIT), s.doc], future: [] };
    });
  }, []);

  const upsertDraft = useCallback(
    (updated: BodyDef, previousId: string) => {
      commit((cur) => {
        const drafts = [...cur.drafts];
        const i = drafts.findIndex((d) => d.id === previousId);
        if (i >= 0) drafts[i] = updated;
        else drafts.push(updated);
        return { drafts, selectedId: updated.id };
      });
    },
    [commit],
  );

  const takenIds = entries.map((e) => e.body.id);

  return {
    entries,
    selectedId: body.id,
    body,
    validation,
    spec,
    isDraft: selected?.draft ?? false,
    canUndo: store.past.length > 0,
    canRedo: store.future.length > 0,
    select: (id) =>
      setStore((s) => (s.doc.selectedId === id ? s : { ...s, doc: { ...s.doc, selectedId: id } })),
    patch: (path, value) => upsertDraft(setBodyField(body, path, value), body.id),
    replace: (next) => upsertDraft(cloneBody(next), body.id),
    create: () => {
      const id = uniqueId('new-world', takenIds);
      commit((cur) => ({
        drafts: [...cur.drafts, createBodyDraft({ id, name: title(id), seed: Math.floor(Math.random() * 100000) })],
        selectedId: id,
      }));
    },
    duplicate: () => {
      const id = uniqueId(`${body.id}-copy`, takenIds);
      commit((cur) => ({ drafts: [...cur.drafts, forkBody(body, id)], selectedId: id }));
    },
    remove: () =>
      commit((cur) => {
        const drafts = cur.drafts.filter((d) => d.id !== cur.selectedId);
        const stillShipped = catalog.some((b) => b.id === cur.selectedId);
        return {
          drafts,
          selectedId: stillShipped ? cur.selectedId : (drafts[0]?.id ?? catalog[0]?.id ?? ''),
        };
      }),
    setSpec,
    undo: () =>
      setStore((s) => {
        const prev = s.past[s.past.length - 1];
        if (!prev) return s;
        return { doc: prev, past: s.past.slice(0, -1), future: [...s.future, s.doc] };
      }),
    redo: () =>
      setStore((s) => {
        const next = s.future[s.future.length - 1];
        if (!next) return s;
        return { doc: next, past: [...s.past, s.doc], future: s.future.slice(0, -1) };
      }),
    importJson: (text) => {
      const { body: parsed, validation: v } = parseBodyJson(text);
      if (!parsed) return { ok: false, errors: v.errors };
      upsertDraft(parsed, parsed.id);
      return { ok: v.ok, errors: v.errors };
    },
    snapshot: () => ({ version: 1, drafts: doc.drafts, selectedId: doc.selectedId, spec }),
  };
}

function load(storage: EditorStorage | null, key: string, catalog: BodyDef[]): EditorPersistedState {
  const fallback: EditorPersistedState = {
    version: 1,
    drafts: [],
    selectedId: catalog[0]?.id ?? 'mars',
    spec: { ...defaultSpec(), id: 'editor-rover', name: 'Editor rover' },
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EditorPersistedState>;
    return {
      version: 1,
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      selectedId: parsed.selectedId ?? fallback.selectedId,
      spec: parsed.spec ?? fallback.spec,
    };
  } catch {
    return fallback;
  }
}

function defaultStorage(): EditorStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function uniqueId(base: string, taken: string[]): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'world';
  if (!taken.includes(slug)) return slug;
  let n = 2;
  while (taken.includes(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

function title(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
