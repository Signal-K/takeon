'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  createRoverGame,
  getBody,
  MATERIALS,
  RECIPES,
  RESOURCE_NAMES,
  STRUCTURES,
  WEATHER_INFO,
  type MissionState,
  type ResourceKey,
  type RoverGame,
  type RoverSpec,
  type StructureType,
  type Vec2,
} from '@takeon/engine';
import { useSync } from '../../lib/sync-context';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'good' | 'bad';
}

interface HudState {
  battery: number;
  batteryMax: number;
  durability: number;
  durabilityMax: number;
  cargoUsed: number;
  cargoMax: number;
  daylight: number;
  weatherLabel: string | null;
  cargo: Partial<Record<ResourceKey, number>>;
  status: 'active' | 'complete' | 'lost';
  canMine: boolean;
  canPhoto: boolean;
  canScan: boolean;
}

let toastId = 0;

function MissionPageInner() {
  const { sync, ready } = useSync();
  const router = useRouter();
  const params = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<RoverGame | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [buildOpen, setBuildOpen] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [tapMenu, setTapMenu] = useState<{ tile: Vec2; x: number; y: number } | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [fatal, setFatal] = useState('');
  const [showMinimap, setShowMinimap] = useState(true);

  const missionId = params.get('id');
  const roverId = params.get('rover');
  const bodyId = params.get('body');

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  // ── Boot the game ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    let disposed = false;
    let game: RoverGame | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;
    let mapTimer: ReturnType<typeof setInterval> | null = null;

    const boot = async () => {
      let resume: MissionState | undefined;
      let spec: RoverSpec | undefined;
      let body = bodyId ? getBody(bodyId) : undefined;

      if (missionId) {
        const state = await sync.loadMission(missionId);
        if (!state) {
          setFatal('Mission not found.');
          return;
        }
        resume = state;
        spec = state.rover.spec;
        body = getBody(state.bodyId);
      } else if (roverId && body) {
        const rovers = await sync.listRovers();
        spec = rovers.find((r) => r.id === roverId);
        if (!spec) {
          setFatal('Rover not found.');
          return;
        }
      }
      if (!spec || !body || disposed || !canvasRef.current) {
        if (!spec || !body) setFatal('Missing rover or destination.');
        return;
      }

      game = createRoverGame({
        canvas: canvasRef.current,
        body,
        spec,
        resume,
        onPhoto: (dataUrl, meta) => {
          toast(`📷 ${meta.caption}`, 'good');
          void sync.uploadPhoto(meta, dataUrl, game?.sim.missionId ?? '').catch(() => undefined);
        },
        onTileTap: (tile, pos) => {
          setTapMenu({ tile, x: pos.x, y: pos.y });
          return true;
        },
      });
      gameRef.current = game;

      const g = game;
      g.events.on('mined', ({ resource, amount }) => {
        if (resource) toast(`+${amount} ${RESOURCE_NAMES[resource]}`, 'good');
      });
      g.events.on('cargoFull', () => toast('Cargo hold full', 'warn'));
      g.events.on('blocked', ({ reason }) => {
        if (reason === 'cliff') toast('Too steep for this drivetrain', 'warn');
        if (reason === 'battery') toast('Not enough battery', 'warn');
        if (reason === 'edge') toast('Nothing to drive on there', 'warn');
      });
      g.events.on('scan', ({ found }) =>
        toast(found.length > 0 ? `Scanner: ${found.length} anomaly signal(s) marked` : 'Scanner: no new signals', found.length > 0 ? 'good' : 'info'),
      );
      g.events.on('anomalyDocumented', ({ anomaly }) => {
        toast(`★ Discovery documented: ${anomaly.name}`, 'good');
        void sync
          .recordDiscovery(anomaly, g.sim.body.id, g.sim.missionId)
          .catch(() => undefined);
      });
      g.events.on('built', ({ structure }) =>
        toast(`Constructed ${STRUCTURES[structure.type].name}`, 'good'),
      );
      g.events.on('buildFailed', ({ reason }) => toast(reason, 'warn'));
      g.events.on('crafted', ({ resource, amount }) =>
        toast(`Refined ${amount} ${RESOURCE_NAMES[resource]}`, 'good'),
      );
      g.events.on('craftFailed', ({ reason }) => toast(reason, 'warn'));
      g.events.on('blockPlaced', () => toast('Block placed', 'good'));
      g.events.on('damaged', ({ amount, reason }) => {
        if (amount >= 1) toast(`Chassis damage −${amount.toFixed(0)} (${reason})`, 'bad');
      });
      g.events.on('repaired', ({ amount }) => toast(`Repaired +${amount.toFixed(0)} durability`, 'good'));
      g.events.on('roverLost', ({ reason }) => toast(`Rover lost: ${reason}`, 'bad'));
      g.events.on('weather', ({ type, phase }) => {
        const info = WEATHER_INFO[type];
        if (phase === 'start') toast(`${info.icon} ${info.warning}`, 'warn');
        else toast(`${info.icon} ${info.name} has passed.`, 'good');
      });
      g.events.on('meteorImpact', ({ distance }) => {
        if (distance <= 2.5) toast('☄ Direct hit — chassis damage!', 'bad');
        else if (distance <= 6) toast('☄ Impact close by!', 'warn');
      });

      const resize = () => {
        const el = canvasRef.current;
        if (!el || !g) return;
        const rect = el.getBoundingClientRect();
        g.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
      };
      resize();
      window.addEventListener('resize', resize);
      g.start();

      const hudTimer = setInterval(() => {
        const r = g.sim.rover;
        setHud({
          battery: r.battery,
          batteryMax: r.stats.batteryCapacity,
          durability: r.durability,
          durabilityMax: r.stats.durabilityMax,
          cargoUsed: r.cargoUsed,
          cargoMax: r.stats.cargoCapacity,
          daylight: g.sim.daylight(),
          weatherLabel: g.sim.weather
            ? `${WEATHER_INFO[g.sim.weather.type].icon} ${WEATHER_INFO[g.sim.weather.type].name}`
            : null,
          cargo: { ...r.cargo },
          status: g.sim.status,
          canMine: r.stats.miningPower > 0,
          canPhoto: r.stats.photoQuality > 0,
          canScan: r.stats.scanRadius > 0,
        });
      }, 250);

      const save = () =>
        void sync.saveMission(g.save(), g.sim.rover.spec.name).catch(() => undefined);
      saveTimer = setInterval(save, 20000);
      const onHide = () => {
        if (document.visibilityState === 'hidden') save();
      };
      document.addEventListener('visibilitychange', onHide);

      mapTimer = setInterval(() => {
        if (minimapRef.current) g.renderer.renderMinimap(minimapRef.current);
      }, 1200);
      if (minimapRef.current) g.renderer.renderMinimap(minimapRef.current);

      // First save so the mission shows up as resumable immediately.
      save();

      cleanupRef.current = () => {
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onHide);
        clearInterval(hudTimer);
        if (saveTimer) clearInterval(saveTimer);
        if (mapTimer) clearInterval(mapTimer);
        save();
        g.dispose();
      };
    };

    const cleanupRef = { current: null as null | (() => void) };
    void boot();
    return () => {
      disposed = true;
      cleanupRef.current?.();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, missionId, roverId, bodyId, sync]);

  const endMission = async () => {
    const g = gameRef.current;
    if (!g) return;
    g.stop();
    const state = g.save();
    if (state.status === 'active') state.status = 'complete';
    try {
      const credits = await sync.completeMission(state, g.sim.banked);
      await sync.saveMission(state, g.sim.rover.spec.name).catch(() => undefined);
      toast(`Mission complete: +${credits} credits`, 'good');
    } catch (err) {
      console.warn('completeMission failed', err);
    }
    router.push('/');
  };

  const g = gameRef.current;

  if (fatal) {
    return (
      <main className="shell">
        <h1>Cannot start mission</h1>
        <p className="lede">{fatal}</p>
        <button onClick={() => router.push('/')}>Back to garage</button>
      </main>
    );
  }

  return (
    <div className="mission-root">
      <canvas ref={canvasRef} className="mission-canvas" aria-label="Rover mission view" />

      {hud && (
        <div className="hud-top">
          <div className="meter" title="Battery">
            ⚡ {Math.round(hud.battery)}/{hud.batteryMax}
            <div className="bar">
              <div
                style={{
                  width: `${(hud.battery / Math.max(1, hud.batteryMax)) * 100}%`,
                  background: hud.battery / Math.max(1, hud.batteryMax) < 0.2 ? 'var(--bad)' : 'var(--accent)',
                }}
              />
            </div>
          </div>
          <div className="meter" title="Durability">
            🛡 {Math.round(hud.durability)}/{hud.durabilityMax}
            <div className="bar">
              <div
                style={{
                  width: `${(hud.durability / Math.max(1, hud.durabilityMax)) * 100}%`,
                  background:
                    hud.durability / Math.max(1, hud.durabilityMax) < 0.25 ? 'var(--bad)' : 'var(--good)',
                }}
              />
            </div>
          </div>
          <div className="meter" title="Cargo">
            📦 {hud.cargoUsed}/{hud.cargoMax}
            <div className="bar">
              <div
                style={{
                  width: `${(hud.cargoUsed / Math.max(1, hud.cargoMax)) * 100}%`,
                  background: 'var(--accent-2)',
                }}
              />
            </div>
          </div>
          <span className="chip">{hud.daylight > 0.5 ? '☀️' : hud.daylight > 0 ? '🌆' : '🌙'}</span>
          {hud.weatherLabel && <span className="chip">{hud.weatherLabel}</span>}
          <span className="spacer" />
          <button onClick={() => gameRef.current?.rotateView()} title="Rotate view (R)">⟳</button>
          <button onClick={() => setShowMinimap((v) => !v)} title="Toggle map">🗺</button>
          <button onClick={() => setEndOpen(true)}>End</button>
        </div>
      )}

      <canvas
        ref={minimapRef}
        width={132}
        height={132}
        className="minimap"
        style={{ display: showMinimap ? 'block' : 'none' }}
      />

      <div className="dpad" aria-label="Drive controls">
        <span className="blank" />
        <button onPointerDown={() => gameRef.current?.move(3)} aria-label="Drive north-east">▲</button>
        <span className="blank" />
        <button onPointerDown={() => gameRef.current?.move(2)} aria-label="Drive north-west">◀</button>
        <button
          onPointerDown={() => gameRef.current?.setCameraFollow(true)}
          aria-label="Centre camera"
        >
          ◎
        </button>
        <button onPointerDown={() => gameRef.current?.move(0)} aria-label="Drive south-east">▶</button>
        <span className="blank" />
        <button onPointerDown={() => gameRef.current?.move(1)} aria-label="Drive south-west">▼</button>
        <span className="blank" />
      </div>

      <div className="hud-actions">
        {hud?.canMine && (
          <button className="action-btn" onClick={() => gameRef.current?.mine()}>
            <span className="ico">⛏</span>Mine
          </button>
        )}
        {hud?.canPhoto && (
          <button className="action-btn" onClick={() => gameRef.current?.photo()}>
            <span className="ico">📷</span>Photo
          </button>
        )}
        {hud?.canScan && (
          <button className="action-btn" onClick={() => gameRef.current?.scan()}>
            <span className="ico">📡</span>Scan
          </button>
        )}
        <button className="action-btn" onClick={() => setBuildOpen(true)}>
          <span className="ico">🏗</span>Build
        </button>
        <button className="action-btn" onClick={() => setCraftOpen(true)}>
          <span className="ico">⚗️</span>Craft
        </button>
        <button className="action-btn" onClick={() => gameRef.current?.placeBlock()}>
          <span className="ico">🧱</span>Place
        </button>
        <button className="action-btn" onClick={() => gameRef.current?.repair()}>
          <span className="ico">🔧</span>Repair
        </button>
        <button
          className="action-btn"
          onClick={() => {
            const moved = gameRef.current?.deposit() ?? 0;
            toast(moved > 0 ? `Banked ${moved} units in cache` : 'No cache adjacent', moved > 0 ? 'good' : 'warn');
          }}
        >
          <span className="ico">📥</span>Deposit
        </button>
      </div>

      {tapMenu && g && (
        <div
          className="tapmenu"
          style={{
            left: Math.min(tapMenu.x, (canvasRef.current?.clientWidth ?? 400) - 180),
            top: Math.min(tapMenu.y, (canvasRef.current?.clientHeight ?? 400) - 160),
          }}
        >
          {(() => {
            const world = g.sim.world;
            const mat = MATERIALS[world.surfaceMaterial(tapMenu.tile.x, tapMenu.tile.y)];
            const h = world.height(tapMenu.tile.x, tapMenu.tile.y);
            const canMine = h > 0 && g.sim.rover.stats.miningPower > 0;
            const yieldName = mat.yields ? RESOURCE_NAMES[mat.yields.resource] : null;
            return (
              <>
                <span className="hdr">
                  {mat.name} · [{tapMenu.tile.x},{tapMenu.tile.y}]
                </span>
                <button
                  onClick={() => {
                    gameRef.current?.walkTo(tapMenu.tile.x, tapMenu.tile.y);
                    setTapMenu(null);
                  }}
                >
                  🛞 Drive here
                </button>
                {canMine && (
                  <button
                    onClick={() => {
                      gameRef.current?.orderMine(tapMenu.tile.x, tapMenu.tile.y);
                      setTapMenu(null);
                      toast(`Mining order: ${mat.name}`);
                    }}
                  >
                    ⛏ Mine {yieldName ?? mat.name}
                  </button>
                )}
                <button onClick={() => setTapMenu(null)}>✕ Cancel</button>
              </>
            );
          })()}
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {buildOpen && g && (
        <div className="modal-backdrop" onClick={() => setBuildOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Construction — faces the tile ahead of the rover</h3>
            <p className="sub" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              Costs come out of the cargo hold. Cargo:{' '}
              {Object.entries(hud?.cargo ?? {})
                .map(([k, v]) => `${v} ${RESOURCE_NAMES[k as ResourceKey]}`)
                .join(', ') || 'empty'}
            </p>
            {Object.values(STRUCTURES).map((def) => {
              const affordable = Object.entries(def.cost).every(
                ([res, qty]) => (hud?.cargo[res as ResourceKey] ?? 0) >= (qty ?? 0),
              );
              return (
                <button
                  key={def.type}
                  className="build-option"
                  disabled={!affordable}
                  onClick={() => {
                    const ok = gameRef.current?.build(def.type as StructureType);
                    if (ok) setBuildOpen(false);
                  }}
                >
                  <span className="info">
                    <b>{def.name}</b>
                    <span className="desc">{def.description}</span>
                  </span>
                  <span className="tag">
                    {Object.entries(def.cost)
                      .map(([res, qty]) => `${qty} ${res}`)
                      .join(' + ')}
                  </span>
                </button>
              );
            })}
            <button onClick={() => setBuildOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {craftOpen && g && (
        <div className="modal-backdrop" onClick={() => setCraftOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Refining — from cargo, on the rover</h3>
            <p className="sub" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              Cargo:{' '}
              {Object.entries(hud?.cargo ?? {})
                .map(([k, v]) => `${v} ${RESOURCE_NAMES[k as ResourceKey]}`)
                .join(', ') || 'empty'}
            </p>
            {RECIPES.map((rec) => {
              const affordable = Object.entries(rec.input).every(
                ([res, qty]) => (hud?.cargo[res as ResourceKey] ?? 0) >= (qty ?? 0),
              );
              return (
                <button
                  key={rec.id}
                  className="build-option"
                  disabled={!affordable}
                  onClick={() => gameRef.current?.craft(rec.id)}
                >
                  <span className="info">
                    <b>
                      {rec.name}
                      {rec.near ? ' (needs refinery)' : ''}
                    </b>
                    <span className="desc">{rec.description}</span>
                  </span>
                  <span className="tag">
                    {Object.entries(rec.input)
                      .map(([res, qty]) => `${qty} ${res}`)
                      .join(' + ')}{' '}
                    → {rec.output.amount} {rec.output.resource}
                  </span>
                </button>
              );
            })}
            <button onClick={() => setCraftOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {(endOpen || hud?.status === 'lost') && (
        <div className="modal-backdrop" onClick={() => setEndOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {hud?.status === 'lost' ? (
              <>
                <h3>Rover lost</h3>
                <p className="sub" style={{ color: 'var(--text-dim)' }}>
                  The mission is over, but documented discoveries and photos still count. Banked
                  cache deposits are credited; cargo on the rover is not recovered.
                </p>
              </>
            ) : (
              <>
                <h3>End mission and recover yield?</h3>
                <p className="sub" style={{ color: 'var(--text-dim)' }}>
                  Cargo, cache deposits, photos and documented discoveries convert to credits.
                </p>
              </>
            )}
            <button className="primary" onClick={() => void endMission()}>
              {hud?.status === 'lost' ? 'Write off rover & collect science' : 'Recover & end mission'}
            </button>
            {hud?.status !== 'lost' && <button onClick={() => setEndOpen(false)}>Keep driving</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MissionPage() {
  return (
    <Suspense fallback={<main className="shell">Loading mission…</main>}>
      <MissionPageInner />
    </Suspense>
  );
}
