import './styles.css';
import { createRoverGame, defaultSpec, getBody, type BodyDef, type RoverGame, type RoverSpec, type Vec2 } from '@takeon/engine';

type DemoId = 'takeon' | 'landnam' | 'atlas' | 'saily';
type Route = '/' | '/demo' | '/demos' | '/demos/landnam' | '/demos/atlas' | '/demos/saily' | '/field/landnam' | '/field/atlas' | '/field/saily' | '/ecosystem' | '/landnam' | '/language';
type ActionId = 'route' | 'clear-route' | 'mine' | 'scan' | 'photo' | 'rotate' | 'recover';

type HostDemo = {
  id: DemoId; eyebrow: string; title: string; scene: string; caption: string;
  body: BodyDef; spec: RoverSpec; premise: string; returnLabel: string;
  metrics: [string, string, string]; actions: { id: ActionId; label: string; key?: string }[];
};

const moon = getBody('moon')!;
const mars = getBody('mars')!;
const terra = getBody('terra')!;

const demos: Record<DemoId, HostDemo> = {
  takeon: {
    id: 'takeon', eyebrow: 'LIVE / DETERMINISTIC / LOCAL', title: 'TakeOn Mars', scene: 'Jezero field trial', caption: 'MARS / LOCAL SIMULATION',
    body: { ...mars, weather: { 'dust-devil': 0.4 }, terrain: { ...mars.terrain, roughness: 0.42, craters: 3 } },
    spec: { ...defaultSpec(), id: 'takeon-scout', name: 'Atlas Scout', color: '#a8f0d1' },
    premise: 'The small baseline: a host mounts one fully local rover scene only while it is useful, then releases it cleanly.', returnLabel: 'Reset field trial',
    metrics: ['Route-ready terrain', 'No network dependency', 'One mounted canvas'],
    actions: [{ id: 'route', label: 'Set route' }, { id: 'mine', label: 'Mine', key: 'E' }, { id: 'scan', label: 'Scan', key: 'X' }, { id: 'photo', label: 'Photo', key: 'P' }],
  },
  landnam: {
    id: 'landnam', eyebrow: 'LANDNAM / SURFACE OPS', title: 'Shackleton Rim', scene: 'Prospector deployment', caption: 'LANDNAM / LUNAR SOUTH POLE',
    body: { ...moon, id: 'landnam-shackleton', name: 'Shackleton Rim', weather: { 'solar-storm': 0.15 }, terrain: { ...moon.terrain, roughness: 0.29, craters: 4, iceCaps: 0.18 } },
    spec: { ...defaultSpec(), id: 'landnam-prospector', name: 'Prospector', chassis: 'chassis-lab', wheels: 'wheels-rocker', power: 'power-solar-xl', battery: 'batt-stack', modules: ['tool-drill', 'cam-pano', 'cargo-crate'], color: '#f6c96a' },
    premise: 'This is the moment after Landnam commits Site Access, a rocket and a Prospector. The programme owns Francs, launch readiness and contracts; this scene owns direct surface work.', returnLabel: 'Return to programme',
    metrics: ['Site Access / Shackleton Rim', 'Prospector / field lab', 'Cargo / programme ledger'],
    actions: [{ id: 'route', label: 'Plot traverse' }, { id: 'scan', label: 'Survey', key: 'X' }, { id: 'mine', label: 'Extract', key: 'E' }, { id: 'photo', label: 'Document', key: 'P' }],
  },
  atlas: {
    id: 'atlas', eyebrow: 'ATLAS / OBSERVING PROTOCOL', title: 'Mallee Sky Reserve', scene: 'Dark-sky station setup', caption: 'ATLAS / OFFLINE FIELD PROTOCOL',
    body: { ...terra, id: 'atlas-mallee', name: 'Mallee Sky Reserve', dayLength: 720, weather: {}, terrain: { ...terra.terrain, roughness: 0.18, biomes: true } },
    spec: { ...defaultSpec(), id: 'atlas-field-lab', name: 'Field Instrument Carrier', chassis: 'chassis-lab', wheels: 'wheels-rigid', power: 'power-rtg', battery: 'batt-stack', modules: ['cam-science', 'scan-deep', 'fuel-aux'], color: '#9dc9ff' },
    premise: 'Atlas already owns opportunity discovery, observing guidance and offline capture. Here TakeOn gives a site, a route and equipment context to a field protocol without replacing the sky map.', returnLabel: 'Reset observing station',
    metrics: ['Opportunity / visible tonight', 'Protocol / instrument location', 'Capture / offline record'],
    actions: [{ id: 'route', label: 'Set station route' }, { id: 'rotate', label: 'Orient rig' }, { id: 'scan', label: 'Check sky', key: 'X' }, { id: 'photo', label: 'Capture', key: 'P' }],
  },
  saily: {
    id: 'saily', eyebrow: 'SAILY / CLOUDSPOTTING MARS', title: 'Ares Cloud Review', scene: 'Context for a daily game round', caption: 'SAILY / EXPLAINER FIELD SCENE',
    body: { ...mars, id: 'saily-ares', name: 'Ares Cloud Review', palette: { sky: '#9a6285', skyNight: '#160e2e', tint: [0.88, 0.82, 1.08] }, weather: {}, terrain: { ...mars.terrain, roughness: 0.25, craters: 2 } },
    spec: { ...defaultSpec(), id: 'saily-reviewer', name: 'Cloud Review Rover', chassis: 'chassis-scout', wheels: 'wheels-rigid', power: 'power-solar-s', battery: 'batt-cell', modules: ['cam-pano', 'scan-short'], color: '#f09abb' },
    premise: 'Saily’s Daily Transit and Cloudspotting Mars remain compact, accessible science games. This optional scene makes the place and evidence behind one round tangible, then returns the player to the explainer.', returnLabel: 'Return to daily game',
    metrics: ['Round / Cloudspotting Mars', 'Evidence / image + context', 'Return / daily puzzle loop'],
    actions: [{ id: 'route', label: 'Follow review path' }, { id: 'scan', label: 'Inspect', key: 'X' }, { id: 'photo', label: 'Record', key: 'P' }, { id: 'rotate', label: 'Reframe view' }],
  },
};

let disposeDemo: (() => void) | undefined;
const routes: Record<Route, { label: string }> = {
  '/': { label: 'Atlas' }, '/demo': { label: 'TakeOn demo' }, '/demos': { label: 'Host demos' },
  '/demos/landnam': { label: 'Landnam field demo' }, '/demos/atlas': { label: 'Atlas field demo' }, '/demos/saily': { label: 'Saily field demo' },
  '/field/landnam': { label: 'Landnam field view' }, '/field/atlas': { label: 'Atlas field view' }, '/field/saily': { label: 'Saily field view' },
  '/ecosystem': { label: 'Ecosystem' }, '/landnam': { label: 'Landnam' }, '/language': { label: 'UI language' },
};

function routeFor(pathname: string): Route { return pathname in routes ? pathname as Route : '/'; }
function link(route: Route, label: string, className = ''): string { return `<a href="${route}" data-route class="${className}">${label}</a>`; }
function shell(route: Route, content: string): string {
  const active = (path: Route) => route === path ? 'is-active' : '';
  if (route.startsWith('/field/')) return `<div class="field-window">${content}</div>`;
  return `<div class="site-shell"><header class="topbar">${link('/', '<span class="mark">T/O</span><span>TakeOn Atlas</span>', 'brand')}<nav aria-label="Primary navigation"><a href="/demos" data-route class="${active('/demos')}">Playable demos</a><a href="/ecosystem" data-route class="${active('/ecosystem')}">Ecosystem</a><a href="/landnam" data-route class="${active('/landnam')}">Landnam</a><a href="/language" data-route class="${active('/language')}">UI language</a></nav></header><main>${content}</main><footer><span>Static by design.</span><span>One engine · many host games.</span></footer></div>`;
}

function home(): string {
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow">BUILD / LAUNCH / EXPLORE</p><h1>The shared layer where Star Sailors games become places.</h1><p class="lede">TakeOn is not another destination. It is the compact building, rover, terrain and field-mission layer that a host game can reveal when a plan becomes something a player can inhabit.</p><div class="actions">${link('/demos', 'Explore host demos', 'button primary')}${link('/landnam', 'See the Landnam handoff', 'button')}</div></div><div class="hero-diagram" aria-label="TakeOn connects host games to a shared field layer"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="system-node node-landnam"><span>LANDNAM</span><small>programme</small></div><div class="system-node node-atlas"><span>ATLAS</span><small>opportunity</small></div><div class="core-node"><span>TAKEON</span><small>field layer</small></div><div class="system-node node-saily"><span>SAILY</span><small>return</small></div></div></section><section class="principles"><article><span class="index">01</span><h2>Host-first</h2><p>Each game owns its world, progression and voice. TakeOn accepts a body, rover and persistence adapter; it does not own the player.</p></article><article><span class="index">02</span><h2>Field-real</h2><p>A command on a board can become a rover, a landscape, a cache, a route and the pleasure of doing the work.</p></article><article><span class="index">03</span><h2>Quiet by default</h2><p>The engine is deterministic and dependency-free. A host only pays for a mission while it is actually mounted.</p></article></section>`;
}

function demoCards(): string {
  return `<section class="page-heading"><p class="eyebrow">ACTUAL HOST-SPECIFIC SCENES</p><h1>One engine. Different games, scenes and hotbars.</h1><p class="lede">Each runnable demo uses a different world configuration, rover assembly, field language and action bar. They are not cosmetic skins of one Mars screen.</p></section><section class="demo-cards">${(['landnam', 'atlas', 'saily'] as DemoId[]).map(id => { const d = demos[id]; return `<article class="demo-card demo-card-${id}"><p class="eyebrow">${d.eyebrow}</p><h2>${d.title}</h2><p>${d.premise}</p><div class="demo-card-metrics">${d.metrics.map(metric => `<span>${metric}</span>`).join('')}</div>${link(`/demos/${id}` as Route, `Open ${id} demo`, 'button')}</article>`; }).join('')}</section>`;
}

function missionDemo(id: DemoId, full = false): string {
  const d = demos[id];
  const fullLink = id === 'takeon' ? '' : `<a class="field-open" href="/field/${id}" target="_blank" rel="noopener">Open full field view ↗</a>`;
  return `<section class="mission-demo ${full ? 'mission-demo-full' : ''}" data-demo="${id}"><div class="mission-heading"><div><p class="eyebrow">${d.eyebrow}</p><h1>${d.title}</h1><p class="lede">${d.premise}</p></div>${full ? '<a class="field-close" href="/demos" data-route>Close field view</a>' : fullLink}</div><section class="demo-layout demo-layout-${id}"><div class="mission-frame"><canvas id="mission-canvas" aria-label="${d.title} interactive field scene. Tap terrain to plan a safe rover route."></canvas><div class="mission-caption"><span class="signal"></span> ${d.caption}</div><div class="mission-readout" aria-live="polite"><span id="mission-position">Landing site</span><span id="mission-telemetry">Battery —</span></div></div><aside class="mission-panel"><p class="eyebrow">${d.scene}</p><h2>${d.spec.name}</h2><div class="field-metrics">${d.metrics.map(metric => `<span>${metric}</span>`).join('')}</div><output id="mission-status" class="mission-status" data-tone="ready" aria-live="polite">Ready at the landing site.</output><output id="route-readout" class="route-readout" aria-live="polite">Tap terrain for a safe route.</output><div class="dpad" aria-label="Drive rover"><button type="button" data-action="move" data-dir="3" aria-label="Drive north">▲</button><button type="button" data-action="move" data-dir="2" aria-label="Drive west">◀</button><button type="button" data-action="move" data-dir="0" aria-label="Drive east">▶</button><button type="button" data-action="move" data-dir="1" aria-label="Drive south">▼</button></div><div class="tool-row">${d.actions.map(action => `<button type="button" data-action="${action.id}">${action.label}${action.key ? ` <kbd>${action.key}</kbd>` : ''}</button>`).join('')}</div><button type="button" class="clear-route" data-action="clear-route">Clear path</button><button type="button" class="recover-button" data-action="recover">${d.returnLabel}</button><div class="control-help"><span><b>Keyboard</b> Arrow keys / WASD · E mine · X scan · P photo</span><span><b>Controller</b> left stick or D-pad · A mine · B scan · X photo</span></div><div class="module-note"><span>HOST CONTRACT</span><code>body + rover + scene text + save adapter + events</code></div></aside></section></section>`;
}

function ecosystem(): string {
  return `<section class="page-heading"><p class="eyebrow">ONE MODULE / MANY NARRATIVES</p><h1>TakeOn is the field layer.</h1><p class="lede">The shared contract stays small. What changes is the reason a player enters it, the scene they enter and what returns to the host.</p></section><section class="ecosystem-grid"><article class="host-card landnam-card"><p class="eyebrow">RESOURCE-MANAGEMENT GAME</p><h2>Landnam</h2><p><b>Host owns:</b> programme, budgets, rockets, facilities, targets and client commitments.</p><p><b>TakeOn reveals:</b> lunar terrain, field construction, cargo routes and the satisfaction of a working site.</p><span class="handoff">Mission board → launch → surface operations → logistics</span>${link('/demos/landnam', 'Play the Landnam scene', 'text-link')}</article><article class="host-card atlas-card"><p class="eyebrow">ASTRONOMY COMPANION</p><h2>Atlas</h2><p><b>Host owns:</b> opportunity discovery, observing guidance and offline capture.</p><p><b>TakeOn reveals:</b> an accessible station site and equipment routing when a protocol benefits from place.</p><span class="handoff">Opportunity → protocol → field context → observation record</span>${link('/demos/atlas', 'Play the Atlas scene', 'text-link')}</article><article class="host-card saily-card"><p class="eyebrow">EXPLAINER / RETURN LAYER</p><h2>Saily</h2><p><b>Host owns:</b> accessible explanation and the compact Daily Transit game loop.</p><p><b>TakeOn reveals:</b> the place and evidence behind an optional science-game scene, then returns to the explainer.</p><span class="handoff">Daily game → understandable place → return story</span>${link('/demos/saily', 'Play the Saily scene', 'text-link')}</article><article class="host-card shared-card"><p class="eyebrow">SHARED STAR SAILORS</p><h2>Mission identity</h2><p>Observation/task identity, consent, privacy, provenance, consensus and partner export stay above the engine.</p><span class="handoff">Shared task → host-specific play → trusted outcome</span></article></section>`;
}

function landnam(): string {
  return `<section class="page-heading"><p class="eyebrow">TAKE ON MARS / LANDNAM</p><h1>The programme is the promise.<br>The field is the payoff.</h1><p class="lede">Landnam stays an authored resource-management game. TakeOn starts only after a programme decision has bought access, prepared a vehicle and committed a real mission—then returns cargo and construction state to the same programme.</p></section><section class="handoff-board" aria-label="Landnam programme-to-field handoff"><article class="programme-surface"><div class="surface-label"><span>01</span><p>LANDNAM / MISSION CONTROL</p></div><h2>Commit a real operation</h2><div class="program-metrics"><span><small>SITE ACCESS</small>Lunar South Pole<br><b>₣4.0M</b></span><span><small>VEHICLE</small>Prospector<br><b>₣13.0M</b></span><span><small>BUILD</small>Settlement Launchpad<br><b>₣6.0M + stock</b></span></div><div class="queue-row"><i></i><div><b>Shackleton Rim</b><small>Orbit 1 · baseline demand · surveyed ice access</small></div></div><div class="queue-row"><i></i><div><b>Programme route</b><small>Mission Board → target → rocket → site logistics</small></div></div><p>Client contracts, Francs, rockets, access quotes, build materials and launch readiness remain Landnam’s precise, information-rich domain.</p></article><div class="handoff-arrow"><span>DEPLOY</span><b>→</b><small>same mission identity<br>same cargo ledger</small></div><article class="field-surface"><div class="surface-label"><span>02</span><p>TAKEON / SURFACE OPS FIELD</p></div><h2>Operate the site</h2><div class="terrain-schematic"><span class="rock one"></span><span class="rock two"></span><span class="rover-dot">R</span><span class="route-line"></span><span class="cache-dot">PAD</span></div><div class="field-actions"><span>Plot traverse</span><span>Survey</span><span>Extract</span><span>Return cargo</span></div><p>The field screen keeps only a sparse hotbar, path control and local telemetry. Programme economics remain in Landnam.</p>${link('/demos/landnam', 'Play Shackleton Rim', 'text-link field-link')}</article></section><section class="landnam-rules"><article><h2>Keep the seam visible</h2><p>Use a short deployment transition and retain mission identity, target, rover and cargo on both sides.</p></article><article><h2>Do not duplicate HUDs</h2><p>The field scene needs a compact action bar. Contracts, costs and programme-wide decisions stay in Landnam.</p></article><article><h2>Return with consequences</h2><p>Resources enter the site buffer; launchpad dispatch and programme progress resume in the host shell.</p></article></section>`;
}

function language(): string {
  return `<section class="page-heading"><p class="eyebrow">DESIGN LANGUAGE / SCALE OF PLAY</p><h1>More TakeOn should change the rhythm, not erase the host.</h1><p class="lede">The UI responds to where the player is. It shifts from interpretation and commitment to direct action and spatial pleasure, then back to meaning.</p></section><section class="language-track"><article class="language-stage host-stage"><span>01 / PLAN</span><h2>Host command deck</h2><p>Dense, mission-facing surfaces. Tables, target fit, budget, launch readiness and construction queues belong here.</p><div class="token-row"><i></i><i></i><i></i><i></i></div></article><article class="language-stage field-stage"><span>02 / DO</span><h2>TakeOn field sandbox</h2><p>Canvas-first. Big terrain, compact physical controls, immediate feedback. The player looks at a place, not a dashboard.</p><div class="terrain-strip"><b></b><b></b><b></b><b></b><b></b></div></article><article class="language-stage return-stage"><span>03 / UNDERSTAND</span><h2>Host return surface</h2><p>Reintroduce narrative, evidence and strategic decisions: what changed, what is unlocked, where to invest next.</p><div class="return-lines"><i></i><i></i><i></i></div></article></section><section class="scale-panel"><div><p class="eyebrow">USAGE SCALE</p><h2 id="scale-title">One focused field scene</h2><p id="scale-copy">Start with a single meaningful mission surface. Its job is to make a chosen programme decision tangible—not replace the whole game.</p></div><input id="scale" type="range" min="1" max="3" value="1" aria-label="TakeOn usage scale"><div class="scale-labels"><span>Scene</span><span>Operations</span><span>World</span></div></section>`;
}

function page(route: Route): string {
  if (route === '/demo') return missionDemo('takeon');
  if (route === '/demos') return demoCards();
  if (route === '/demos/landnam' || route === '/field/landnam') return missionDemo('landnam', route.startsWith('/field/'));
  if (route === '/demos/atlas' || route === '/field/atlas') return missionDemo('atlas', route.startsWith('/field/'));
  if (route === '/demos/saily' || route === '/field/saily') return missionDemo('saily', route.startsWith('/field/'));
  if (route === '/ecosystem') return ecosystem(); if (route === '/landnam') return landnam(); if (route === '/language') return language(); return home();
}

function mountDemo(): () => void {
  const root = document.querySelector<HTMLElement>('[data-demo]'); const canvas = document.querySelector<HTMLCanvasElement>('#mission-canvas'); const config = root ? demos[root.dataset.demo as DemoId] : undefined;
  if (!root || !canvas || !config) return () => undefined;
  const status = document.querySelector<HTMLOutputElement>('#mission-status'); const position = document.querySelector<HTMLElement>('#mission-position'); const telemetry = document.querySelector<HTMLElement>('#mission-telemetry'); const routeReadout = document.querySelector<HTMLOutputElement>('#route-readout');
  let game: RoverGame | undefined; let pendingDirection: (0 | 1 | 2 | 3) | undefined; let routeMode = false; let waypoints: Vec2[] = []; let telemetryTimer = 0; let gamepadFrame = 0; let lastGamepadMove = 0; let pressedButtons: boolean[] = []; let disposeGame = () => undefined;
  const setStatus = (message: string, tone: 'ready' | 'warning' | 'success' = 'ready') => { if (status) { status.textContent = message; status.dataset.tone = tone; } };
  const updateRoute = () => { if (!routeReadout || !game) return; const steps = game.plannedRoute().length; routeReadout.textContent = routeMode ? `Route design mode · ${waypoints.length} waypoint${waypoints.length === 1 ? '' : 's'} · ${steps} safe steps.` : steps ? `Driving ${steps} safe route steps · tap Set route to add a waypoint.` : 'Tap terrain for a safe route, or Set route to place waypoints.'; };
  const updateTelemetry = () => { if (!game) return; const rover = game.sim.rover; if (position) position.textContent = `Tile ${rover.pos.x}, ${rover.pos.y}`; if (telemetry) telemetry.textContent = `Battery ${Math.round(rover.battery)} · cargo ${rover.cargoUsed}/${rover.stats.cargoCapacity}`; updateRoute(); };
  const resize = () => { const bounds = canvas.getBoundingClientRect(); game?.resize(bounds.width, bounds.height, Math.min(2, window.devicePixelRatio || 1)); };
  const drive = (direction: 0 | 1 | 2 | 3) => { if (!game) return; if (game.sim.rover.moveFrom || game.sim.rover.mining) { pendingDirection = direction; setStatus('Drive command queued until the rover is clear.'); return; } routeMode = false; waypoints = []; if (game.move(direction)) setStatus('Driving across the surface.', 'success'); };
  const startGame = () => {
    disposeGame(); routeMode = false; waypoints = [];
    game = createRoverGame({ canvas, body: config.body, spec: config.spec, seed: config.body.seed, audio: false, controls: false });
    const off = [
      game.events.on('blocked', ({ reason }) => { if (reason !== 'busy') { pendingDirection = undefined; setStatus(reason === 'cliff' ? 'That slope is too steep. Plot a route around it.' : reason === 'edge' ? 'That route leaves the field boundary.' : 'Battery is too low for that action.', 'warning'); } }),
      game.events.on('miningStarted', () => setStatus('Working the exposed surface.', 'success')),
      game.events.on('mined', ({ resource, amount }) => setStatus(resource ? `Collected ${amount} ${resource}.` : 'Regolith cleared.', 'success')),
      game.events.on('scan', ({ found }) => setStatus(found.length ? `Field check found ${found.length} nearby signal${found.length === 1 ? '' : 's'}.` : 'Field check complete. No new signal nearby.', 'success')),
      game.events.on('photo', () => setStatus('Field record captured.', 'success')),
      game.events.on('tick', () => { if (pendingDirection !== undefined && !game?.sim.rover.moveFrom && !game?.sim.rover.mining) { const direction = pendingDirection; pendingDirection = undefined; drive(direction); } }),
    ];
    resize(); game.start(); updateTelemetry(); setStatus(`Ready: ${config.scene}.`); disposeGame = () => { off.forEach(stop => stop()); game?.dispose(); game = undefined; };
  };
  const runAction = (action: ActionId) => {
    if (!game) return;
    if (action === 'route') { routeMode = !routeMode; setStatus(routeMode ? 'Route design enabled. Tap terrain to add waypoints; each leg is checked for safe slopes.' : 'Route design closed. The active safe path will continue.'); updateRoute(); return; }
    if (action === 'clear-route') { game.cancelOrder(); routeMode = false; waypoints = []; setStatus('Route cleared.'); updateRoute(); return; }
    if (action === 'mine') { if (!game.mine()) setStatus('Move beside an exposed tile before extracting.', 'warning'); return; }
    if (action === 'scan') { game.scan(); return; } if (action === 'photo') { game.photo(); return; }
    if (action === 'rotate') { game.rotateView(); setStatus('View reoriented.', 'success'); return; } if (action === 'recover') startGame();
  };
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-action]')];
  const buttonHandlers = buttons.map(button => { const handler = () => { const action = button.dataset.action as ActionId | 'move'; if (action === 'move') drive(Number(button.dataset.dir) as 0 | 1 | 2 | 3); else runAction(action); }; button.addEventListener('click', handler); return () => button.removeEventListener('click', handler); });
  const onKey = (event: KeyboardEvent) => { if (event.metaKey || event.ctrlKey || event.altKey || /^(input|textarea|select)$/i.test((event.target as HTMLElement | null)?.tagName ?? '')) return; const key = event.key.toLowerCase(); const directions: Record<string, 0 | 1 | 2 | 3> = { arrowright: 0, d: 0, arrowdown: 1, s: 1, arrowleft: 2, a: 2, arrowup: 3, w: 3 }; if (key in directions) { event.preventDefault(); drive(directions[key]); } else if ((key === 'e' || key === ' ') && !event.repeat) { event.preventDefault(); runAction('mine'); } else if (key === 'x' && !event.repeat) runAction('scan'); else if (key === 'p' && !event.repeat) runAction('photo'); else if (key === 'r' && !event.repeat) runAction('route'); };
  const onCanvasClick = (event: MouseEvent) => { if (!game) return; const bounds = canvas.getBoundingClientRect(); const tile = game.renderer.pickTile(event.clientX - bounds.left, event.clientY - bounds.top); if (!tile) return; if (routeMode) { const next = [...waypoints, tile]; if (!game.planPath(next)) { setStatus('That waypoint cannot be safely connected from this field position.', 'warning'); return; } waypoints = next; setStatus(`Waypoint ${waypoints.length} accepted at tile ${tile.x}, ${tile.y}.`, 'success'); } else { game.walkTo(tile.x, tile.y); setStatus(`Planning a safe route to tile ${tile.x}, ${tile.y}.`); } updateRoute(); };
  const pollGamepad = (time: number) => { const pad = navigator.getGamepads?.().find(Boolean); if (pad) { const horizontal = pad.axes[0] ?? 0; const vertical = pad.axes[1] ?? 0; const dpad = [pad.buttons[15]?.pressed, pad.buttons[13]?.pressed, pad.buttons[14]?.pressed, pad.buttons[12]?.pressed]; const direction = dpad[0] || horizontal > 0.55 ? 0 : dpad[1] || vertical > 0.55 ? 1 : dpad[2] || horizontal < -0.55 ? 2 : dpad[3] || vertical < -0.55 ? 3 : undefined; if (direction !== undefined && time - lastGamepadMove > 160) { drive(direction as 0 | 1 | 2 | 3); lastGamepadMove = time; } (['mine', 'scan', 'photo'] as ActionId[]).forEach((action, index) => { const pressed = !!pad.buttons[index]?.pressed; if (pressed && !pressedButtons[index]) runAction(action); pressedButtons[index] = pressed; }); } gamepadFrame = requestAnimationFrame(pollGamepad); };
  window.addEventListener('resize', resize); window.addEventListener('keydown', onKey); canvas.addEventListener('click', onCanvasClick); telemetryTimer = window.setInterval(updateTelemetry, 200); startGame(); gamepadFrame = requestAnimationFrame(pollGamepad);
  return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', onKey); canvas.removeEventListener('click', onCanvasClick); buttonHandlers.forEach(remove => remove()); window.clearInterval(telemetryTimer); cancelAnimationFrame(gamepadFrame); disposeGame(); };
}

function mountLanguage(): void {
  const slider = document.querySelector<HTMLInputElement>('#scale'); const title = document.querySelector<HTMLElement>('#scale-title'); const copy = document.querySelector<HTMLElement>('#scale-copy'); if (!slider || !title || !copy) return;
  const states = [['One focused field scene', 'Start with a single meaningful mission surface. Its job is to make a chosen programme decision tangible—not replace the whole game.'], ['A connected operations loop', 'Surface sites, rover upgrades and local construction begin to carry forward. Keep the host shell responsible for programme-wide decisions.'], ['A world the host can revisit', 'Multiple missions reuse the same field language. Preserve host identity with clear transitions, distinct UI density and purposeful returns.']];
  slider.addEventListener('input', () => { const [nextTitle, nextCopy] = states[Number(slider.value) - 1]; title.textContent = nextTitle; copy.textContent = nextCopy; });
}

function render(): void {
  disposeDemo?.(); disposeDemo = undefined; const route = routeFor(window.location.pathname); document.title = `${routes[route].label} · TakeOn Atlas`; document.querySelector<HTMLDivElement>('#app')!.innerHTML = shell(route, page(route));
  document.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach(anchor => anchor.addEventListener('click', event => { const href = anchor.getAttribute('href'); if (!href?.startsWith('/')) return; event.preventDefault(); window.history.pushState({}, '', href); render(); }));
  if (document.querySelector('[data-demo]')) disposeDemo = mountDemo(); if (route === '/language') mountLanguage();
}

window.addEventListener('popstate', render);
render();
