import { useState, type CSSProperties, type ReactNode } from 'react';
import { surveySnapshot } from '@takeon/engine';
import { useMission } from '../mission-context.js';
import { createSlot, cx, useSlotClass } from '../registry.js';
import { MissionCanvas } from './MissionCanvas.js';

export interface SurveyScreenProps {
  /** Host HUB action. When omitted, a small field sheet opens instead. */
  onHub?: () => void;
  className?: string;
  style?: CSSProperties;
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6"
      />
    </svg>
  );
}

function IconCube() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        d="M12 3.5 20 8v8l-8 4.5L4 16V8z"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.7" d="M12 12.2 20 8M12 12.2 4 8M12 12.2V20" />
    </svg>
  );
}

/**
 * Survey chrome: d-pad bottom-left, one large SCAN button bottom-right,
 * SCAN / HUB / LASER as small pills. WASD and arrows come from the engine.
 */
function DefaultSurveyScreen({ onHub, className, style }: SurveyScreenProps) {
  const { hud, actions, game } = useMission();
  const [hubOpen, setHubOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const snap = game ? surveySnapshot(game.sim) : null;
  const clock = snap?.clock ?? '00:00';
  const fuel = snap?.fuelLabel ?? 'F—';
  const hot = snap?.formationInRange ?? false;

  const scan = () => actions.scan();
  const laser = () => actions.mine();
  const hub = () => {
    if (onHub) onHub();
    else setHubOpen((v) => !v);
  };

  return (
    <div className={cx('tk-survey', useSlotClass('SurveyScreen'), className)} style={style}>
      <MissionCanvas />
      <div className="tk-survey-top">
        <div className="tk-survey-cluster">
          <button
            type="button"
            className="tk-survey-icon"
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            onClick={() => {
              const next = game?.audio.toggle() ?? !muted;
              setMuted(!next);
            }}
          >
            <IconGear />
          </button>
          <span className="tk-survey-pill" aria-label="Mission time">
            <i className="tk-survey-dot" />
            {clock}
          </span>
        </div>
        <div className="tk-survey-cluster">
          <span className="tk-survey-pill" aria-label="Fuel">
            {fuel}
          </span>
          <button type="button" className="tk-survey-icon" aria-label="Recentre camera" onClick={actions.centreCamera}>
            <IconCube />
          </button>
          <button type="button" className="tk-survey-pill tk-survey-pill-btn" onClick={scan}>
            SCAN
          </button>
          <button type="button" className="tk-survey-pill tk-survey-pill-btn" onClick={hub} aria-expanded={hubOpen}>
            HUB
          </button>
        </div>
      </div>

      <div className="tk-survey-pad" aria-label="Drive controls">
        <span className="tk-survey-plus" aria-hidden="true" />
        <PadButton className="n" label="Drive up" onPress={() => actions.move(3)}>
          ▲
        </PadButton>
        <PadButton className="w" label="Drive left" onPress={() => actions.move(2)}>
          ◀
        </PadButton>
        <PadButton className="e" label="Drive right" onPress={() => actions.move(0)}>
          ▶
        </PadButton>
        <PadButton className="s" label="Drive down" onPress={() => actions.move(1)}>
          ▼
        </PadButton>
      </div>

      <button
        type="button"
        className="tk-survey-go"
        data-hot={hot ? 'true' : 'false'}
        onClick={scan}
        aria-label={hot ? 'Scan formation in range' : 'Scan'}
      >
        SCAN
      </button>
      <button type="button" className="tk-survey-laser" onClick={laser} disabled={hud ? !hud.can.mine : false}>
        LASER
      </button>

      {hubOpen && snap && (
        <div className="tk-survey-sheet" role="dialog" aria-label="Field hub">
          <p className="tk-survey-sheet-kicker">Field hub</p>
          <p>
            {snap.scanned} / {snap.total} formations scanned
          </p>
          <p>{snap.prompt}</p>
          <button type="button" className="tk-survey-pill tk-survey-pill-btn" onClick={() => setHubOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function PadButton({
  className,
  label,
  onPress,
  children,
}: {
  className: string;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={className} aria-label={label} onPointerDown={onPress}>
      {children}
    </button>
  );
}

export const SurveyScreen = createSlot('SurveyScreen', DefaultSurveyScreen);
