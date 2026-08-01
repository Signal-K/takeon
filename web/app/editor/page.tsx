'use client';

import dynamic from 'next/dynamic';

/**
 * The world editor. Loaded client-side only: it drives canvases, localStorage
 * and the engine's runtime body registry, none of which exist during SSR.
 */
const TakeOnEditor = dynamic(() => import('@takeon/editor').then((m) => m.TakeOnEditor), {
  ssr: false,
  loading: () => <main className="shell">Loading editor…</main>,
});

export default function EditorPage() {
  return (
    <div className="editor-fullscreen">
      <TakeOnEditor />
    </div>
  );
}
