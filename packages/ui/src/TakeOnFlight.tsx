import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  createFlightScene,
  type BodyDef,
  type FlightBodyLook,
  type FlightConfig,
  type FlightCraftLook,
  type FlightEvent,
  type FlightSceneHandle,
  type FlightSnapshot,
} from '@takeon/engine';
import { TakeOnUIProvider, createSlot, cx, useSlotClass, type TakeOnUIConfig } from './registry.js';

export interface FlightScreenProps {
  scene: FlightSceneHandle | null;
  snapshot: FlightSnapshot | null;
  /** Host action for leaving the flight. Hidden when omitted. */
  onHub?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Flight chrome, laid out like the survey scene: nudge pad bottom-left, one
 * large button bottom-right (BOOST in flight, MARK in orbit), status pills on
 * top. A nudge is held, so the pad steers while a button is down.
 */
function DefaultFlightScreen({ scene, snapshot, onHub, className, style }: FlightScreenProps) {
  const hold = (x: number, y: number) => ({
    onPointerDown: () => scene?.steer(x, y),
    onPointerUp: () => scene?.steer(0, 0),
    onPointerLeave: () => scene?.steer(0, 0),
    onPointerCancel: () => scene?.steer(0, 0),
  });
  const orbit = snapshot?.phase === 'orbit';
  const ready = orbit ? snapshot?.canMark : (snapshot?.boosts ?? 0) > 0 && !snapshot?.boosting;
  return (
    <div className={cx('tk-flight-chrome', useSlotClass('FlightScreen'), className)} style={style}>
      <div className="tk-survey-top">
        <div className="tk-survey-cluster">
          <span className="tk-survey-pill" aria-label="Flight phase">
            <i className="tk-survey-dot" />
            {(snapshot?.phase ?? 'departure').toUpperCase()}
          </span>
          <span className="tk-survey-pill" aria-label="Course flown">
            {snapshot?.percent ?? 0}%
          </span>
        </div>
        <div className="tk-survey-cluster">
          <span className="tk-survey-pill" aria-label={orbit ? 'Sites marked' : 'Boost charges'}>
            {orbit ? `${snapshot?.marked ?? 0}/${snapshot?.sites ?? 0} SITES` : `B${snapshot?.boosts ?? 0}`}
          </span>
          {onHub && (
            <button type="button" className="tk-survey-pill tk-survey-pill-btn" onClick={onHub}>
              HUB
            </button>
          )}
        </div>
      </div>
      <p className="tk-flight-prompt" role="status">
        {snapshot?.prompt}
      </p>
      <div className="tk-survey-pad" aria-label="Nudge controls">
        <span className="tk-survey-plus" aria-hidden="true" />
        <button type="button" className="n" aria-label="Nudge up" {...hold(0, 1)}>▲</button>
        <button type="button" className="w" aria-label="Nudge left" {...hold(-1, 0)}>◀</button>
        <button type="button" className="e" aria-label="Nudge right" {...hold(1, 0)}>▶</button>
        <button type="button" className="s" aria-label="Nudge down" {...hold(0, -1)}>▼</button>
      </div>
      <button
        type="button"
        className="tk-survey-go"
        data-hot={ready ? 'true' : 'false'}
        onClick={() => (orbit ? scene?.mark() : scene?.boost())}
      >
        {orbit ? 'MARK' : 'BOOST'}
      </button>
    </div>
  );
}

export const FlightScreen = createSlot('FlightScreen', DefaultFlightScreen);

export interface TakeOnFlightProps {
  config: FlightConfig;
  destination: BodyDef | FlightBodyLook;
  craft?: FlightCraftLook;
  ui?: TakeOnUIConfig;
  onEvent?: (event: FlightEvent) => void;
  onHub?: () => void;
  onReady?: (scene: FlightSceneHandle) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Drop-in space flight scene for a React host.
 *
 * ```tsx
 * <TakeOnFlight config={{ seed: 7, duration: 60, debris: 0.4, pickups: 0.4 }} destination={getBody('mars')!} />
 * ```
 */
export function TakeOnFlight({ config, destination, craft, ui, onEvent, onHub, onReady, className, style }: TakeOnFlightProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scene, setScene] = useState<FlightSceneHandle | null>(null);
  const [snapshot, setSnapshot] = useState<FlightSnapshot | null>(null);
  const callbacks = useRef({ onEvent, onReady });
  callbacks.current = { onEvent, onReady };
  // A flight is defined by its config: a new one starts a new flight.
  const key = JSON.stringify(config);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = createFlightScene({ canvas, config, destination, craft, onEvent: (e) => callbacks.current.onEvent?.(e) });
    const fit = () => next.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(canvas);
    next.start();
    setScene(next);
    callbacks.current.onReady?.(next);
    const poll = window.setInterval(() => setSnapshot(next.snapshot()), 150);
    return () => {
      window.clearInterval(poll);
      observer?.disconnect();
      next.destroy();
      setScene(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (scene && craft) scene.setCraft(craft);
  }, [scene, craft]);

  return (
    <TakeOnUIProvider {...ui}>
      <div className={cx('tk-flight', className)} style={style}>
        <canvas ref={canvasRef} className="tk-flight-canvas" />
        <FlightScreen scene={scene} snapshot={snapshot} onHub={onHub} />
      </div>
    </TakeOnUIProvider>
  );
}
