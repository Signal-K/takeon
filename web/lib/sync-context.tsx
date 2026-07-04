'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LocalSync, PocketBaseSync, type SyncAdapter } from '@takeon/engine';

/**
 * Chooses the persistence backend once per session:
 * - If NEXT_PUBLIC_TAKEON_PB_URL is set and healthy, use the PocketBase
 *   spoke (JWT read from the shared backend's SDK auth store in
 *   localStorage — hub-and-spoke, same as Landnam).
 * - Otherwise fall back to localStorage so standalone play always works.
 */

const TAKEON_PB_URL = process.env.NEXT_PUBLIC_TAKEON_PB_URL ?? '';

export function getSharedToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    // PocketBase JS SDK default LocalAuthStore key.
    const raw = localStorage.getItem('pocketbase_auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === 'string' && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

interface SyncContextValue {
  sync: SyncAdapter;
  ready: boolean;
}

const local = new LocalSync();
const SyncContext = createContext<SyncContextValue>({ sync: local, ready: false });

export function SyncProvider({ children }: { children: ReactNode }) {
  const [remote, setRemote] = useState<SyncAdapter | null>(null);
  const [ready, setReady] = useState(!TAKEON_PB_URL);

  useEffect(() => {
    if (!TAKEON_PB_URL) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    fetch(`${TAKEON_PB_URL.replace(/\/$/, '')}/api/takeon/health`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(() => {
        if (cancelled) return;
        setRemote(new PocketBaseSync({ baseUrl: TAKEON_PB_URL, getToken: getSharedToken }));
      })
      .catch(() => {
        console.warn('[takeon] spoke backend unreachable — playing in local mode');
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const value = useMemo<SyncContextValue>(() => ({ sync: remote ?? local, ready }), [remote, ready]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
