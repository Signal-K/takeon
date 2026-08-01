import { Camera, FlatRenderer, IsoRenderer, type SceneView, type Simulation, type ViewKind } from '@takeon/engine';
import { createSlot } from '@takeon/ui';
import { useEffect, useRef, useState } from 'react';

export interface ViewportProps {
  sim: Simulation | null;
  version: number;
  generating: boolean;
  /** Game seconds used for lighting; drives the day/night preview. */
  time: number;
  onTimeChange(time: number): void;
  /** Which renderer to draw with. */
  view?: ViewKind;
  onViewChange?(view: ViewKind): void;
}

/**
 * Scene view: the engine's own renderers drawing the real generated world,
 * with editor camera controls (drag to pan, wheel to zoom, R to rotate) and a
 * time-of-day scrub so lighting can be judged without playing.
 *
 * Both views are the same scene: `3D` is the isometric voxel diorama, `2D` is
 * the top-down map with hillshading — the one you want when laying out routes
 * or reading terrain. The camera is shared, so toggling keeps your place.
 *
 * The simulation is not ticked here — nothing moves, nothing drains — so what
 * you see is purely the authored world.
 */
function DefaultViewport({ sim, version, generating, time, onTimeChange, view = 'iso', onViewChange }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneView | null>(null);
  // One camera for the panel's lifetime: switching views keeps the framing.
  const cameraRef = useRef<Camera>(new Camera());
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sim) return;

    const camera = cameraRef.current;
    const renderer: SceneView =
      view === 'flat' ? new FlatRenderer(canvas, sim, camera) : new IsoRenderer(canvas, sim, camera);
    renderer.activate();
    rendererRef.current = renderer;
    camera.follow = false;
    renderer.focusTile(sim.rover.pos);
    setRotation(renderer.rotation);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width || 640, rect.height || 480, Math.min(2, window.devicePixelRatio || 1));
    };
    resize();
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    let raf = 0;
    const frame = () => {
      renderer.draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      camera.panBy(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      camera.setZoom(camera.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        renderer.rotateClockwise();
        setRotation(renderer.rotation);
      }
      if (e.key === 'f' || e.key === 'F') renderer.focusTile(sim.rover.pos);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      renderer.deactivate();
      window.removeEventListener('resize', resize);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      rendererRef.current = null;
    };
  }, [sim, version, view]);

  // Lighting follows the scrubbed time; the sim itself never advances here.
  useEffect(() => {
    if (sim) sim.time = time;
  }, [sim, time, version]);

  const dayLength = sim?.body.dayLength ?? 0;

  return (
    <div className="tke-viewport">
      <canvas ref={canvasRef} className="tke-scene" />
      <div className="tke-viewport-bar">
        <button
          type="button"
          onClick={() => onViewChange?.(view === 'iso' ? 'flat' : 'iso')}
          title={view === 'iso' ? 'Switch to the 2D map' : 'Switch to the 3D diorama'}
          disabled={!onViewChange}
        >
          {view === 'iso' ? '⬔ 3D' : '▦ 2D'}
        </button>
        <button
          type="button"
          onClick={() => {
            rendererRef.current?.rotateClockwise();
            setRotation(rendererRef.current?.rotation ?? 0);
          }}
          title="Rotate view (R)"
        >
          ⟳ {rotation * 90}°
        </button>
        <button type="button" onClick={() => sim && rendererRef.current?.focusTile(sim.rover.pos)} title="Frame the landing site (F)">
          ◎ Frame
        </button>
        {dayLength > 0 && (
          <label className="tke-inline-range" title="Preview lighting through the day">
            ☀
            <input
              type="range"
              min={0}
              max={dayLength}
              step={Math.max(1, Math.round(dayLength / 120))}
              value={Math.min(time, dayLength)}
              onChange={(e) => onTimeChange(Number(e.target.value))}
            />
          </label>
        )}
        {generating && <span className="tke-hint">generating…</span>}
      </div>
    </div>
  );
}

export const Viewport = createSlot('EditorViewport', DefaultViewport);
