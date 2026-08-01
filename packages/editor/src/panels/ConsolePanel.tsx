import { createSlot } from '@takeon/ui';
import { useEffect, useRef } from 'react';

export interface ConsoleLine {
  id: number;
  t: number;
  key: string;
  detail: string;
}

export interface ConsolePanelProps {
  lines: ConsoleLine[];
  /** Kept for hosts that render their own header; the card supplies one. */
  onClear(): void;
}

/** Live engine event log during play mode — the editor's "output" pane. */
function DefaultConsolePanel({ lines }: ConsolePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="tke-console">
      <div className="tke-console-body" ref={ref}>
        {lines.length === 0 && <span className="tke-hint">Press ▶ Play to drive the world and watch events here.</span>}
        {lines.map((line) => (
          <div key={line.id} className="tke-console-line">
            <code>{line.t.toFixed(1)}s</code> <b>{line.key}</b> {line.detail}
          </div>
        ))}
      </div>
    </div>
  );
}

export const ConsolePanel = createSlot('EditorConsolePanel', DefaultConsolePanel);
