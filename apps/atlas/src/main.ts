import './styles.css';
import { createRoverGame, defaultSpec, getBody, type RoverGame } from '@takeon/engine';

type Route = '/' | '/demo' | '/ecosystem' | '/landnam' | '/language';

let disposeDemo: (() => void) | undefined;

const routes: Record<Route, { label: string; eyebrow: string }> = {
  '/': { label: 'Atlas', eyebrow: 'TAKEON / ATLAS' },
  '/demo': { label: 'Demo', eyebrow: 'LIVE MISSION MODULE' },
  '/ecosystem': { label: 'Ecosystem', eyebrow: 'HOST MAP' },
  '/landnam': { label: 'Landnam', eyebrow: 'PROGRAM → FIELD' },
  '/language': { label: 'Language', eyebrow: 'UI HANDOFF' },
};

function routeFor(pathname: string): Route {
  return pathname in routes ? pathname as Route : '/';
}

function link(route: Route, label: string, className = ''): string {
  return `<a href="${route}" data-route class="${className}">${label}</a>`;
}

function shell(route: Route, content: string): string {
  const active = (path: Route) => route === path ? 'is-active' : '';
  return `
    <div class="site-shell">
      <header class="topbar">
        ${link('/', '<span class="mark">T/O</span><span>TakeOn Atlas</span>', 'brand')}
        <nav aria-label="Primary navigation">
          <a href="/demo" data-route class="${active('/demo')}">Try the module</a>
          <a href="/ecosystem" data-route class="${active('/ecosystem')}">Ecosystem</a>
          <a href="/landnam" data-route class="${active('/landnam')}">Landnam</a>
          <a href="/language" data-route class="${active('/language')}">UI language</a>
        </nav>
      </header>
      <main>${content}</main>
      <footer><span>Static by design.</span><span>One engine · many host games.</span></footer>
    </div>`;
}

function home(): string {
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">BUILD / LAUNCH / EXPLORE</p>
        <h1>The shared layer where Star Sailors games become places.</h1>
        <p class="lede">TakeOn is not another destination. It is the compact building, rover, terrain and field-mission layer that a host game can reveal when a plan becomes something a player can inhabit.</p>
        <div class="actions">
          ${link('/demo', 'Explore TakeOn Mars', 'button primary')}
          ${link('/landnam', 'See the Landnam handoff', 'button')}
        </div>
      </div>
      <div class="hero-diagram" aria-label="TakeOn connects host games to a shared field layer">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="system-node node-landnam"><span>LANDNAM</span><small>programme</small></div>
        <div class="system-node node-atlas"><span>ATLAS</span><small>opportunity</small></div>
        <div class="core-node"><span>TAKEON</span><small>field layer</small></div>
        <div class="system-node node-saily"><span>SAILY</span><small>return</small></div>
      </div>
    </section>
    <section class="principles">
      <article><span class="index">01</span><h2>Host-first</h2><p>Each game owns its world, progression and voice. TakeOn accepts a body, rover and persistence adapter; it does not own the player.</p></article>
      <article><span class="index">02</span><h2>Field-real</h2><p>A command on a board can become a rover, a landscape, a cache, a route and the pleasure of doing the work.</p></article>
      <article><span class="index">03</span><h2>Quiet by default</h2><p>The engine is deterministic and dependency-free. A host only pays for a mission while it is actually mounted.</p></article>
    </section>`;
}

function demo(): string {
  return `
    <section class="page-heading">
      <p class="eyebrow">LIVE / DETERMINISTIC / LOCAL</p>
      <h1>TakeOn Mars</h1>
      <p class="lede">A real mission mounted from <code>@takeon/engine</code>. It starts only on this route and is released when you leave it.</p>
    </section>
    <section class="demo-layout">
      <div class="mission-frame"><canvas id="mission-canvas" aria-label="TakeOn Mars rover mission"></canvas><div class="mission-caption"><span class="signal"></span> MARS / LOCAL SIMULATION</div></div>
      <aside class="mission-panel">
        <p class="eyebrow">FIELD CONTROLS</p>
        <h2>Atlas Scout</h2>
        <p>Use the directional controls to drive. Mine, scan and photograph through the same narrow API a host game receives.</p>
        <div class="dpad" aria-label="Drive rover">
          <button data-action="move" data-dir="2">▲</button><button data-action="move" data-dir="1">◀</button><button data-action="move" data-dir="0">▶</button><button data-action="move" data-dir="3">▼</button>
        </div>
        <div class="tool-row"><button data-action="mine">Mine</button><button data-action="scan">Scan</button><button data-action="photo">Photo</button></div>
        <div class="module-note"><span>HOST CONTRACT</span><code>body + rover + save adapter + events</code></div>
      </aside>
    </section>`;
}

function ecosystem(): string {
  return `
    <section class="page-heading"><p class="eyebrow">ONE MODULE / MANY NARRATIVES</p><h1>TakeOn is the field layer.</h1><p class="lede">The shared contract is deliberately small. What changes is the reason a player enters it, what they bring, and how their work returns to the host.</p></section>
    <section class="ecosystem-grid">
      <article class="host-card landnam-card"><p class="eyebrow">RESOURCE-MANAGEMENT GAME</p><h2>Landnam</h2><p><b>Host owns:</b> programme, budgets, rockets, facilities, targets and client commitments.</p><p><b>TakeOn reveals:</b> rover-scale terrain, field construction, cargo routes and the satisfaction of a working site.</p><span class="handoff">Mission board → launch → surface operations → logistics</span>${link('/landnam', 'Explore the handoff', 'text-link')}</article>
      <article class="host-card atlas-card"><p class="eyebrow">ASTRONOMY COMPANION</p><h2>Atlas</h2><p><b>Host owns:</b> opportunity discovery, observing guidance and offline capture.</p><p><b>TakeOn can reveal:</b> an accessible, spatial field protocol when a mission benefits from equipment, site and route context.</p><span class="handoff">Opportunity → protocol → field context → observation record</span></article>
      <article class="host-card saily-card"><p class="eyebrow">EXPLAINER / RETURN LAYER</p><h2>Saily</h2><p><b>Host owns:</b> accessible explanation and verified public outcomes.</p><p><b>TakeOn can visualise:</b> the tangible work behind an outcome, without turning the explainer into a game client.</p><span class="handoff">Verified result → understandable place → return story</span></article>
      <article class="host-card shared-card"><p class="eyebrow">SHARED STAR SAILORS</p><h2>Mission identity</h2><p>Observation/task identity, consent, privacy, provenance, consensus and partner export stay above the engine.</p><span class="handoff">Shared task → host-specific play → trusted outcome</span></article>
    </section>`;
}

function landnam(): string {
  return `
    <section class="page-heading"><p class="eyebrow">TAKE ON MARS / LANDNAM</p><h1>The programme is the promise.<br>The field is the payoff.</h1><p class="lede">Landnam does not need to become a sandbox everywhere. It needs a clear handoff: rich, legible programme management creates intent; a contained TakeOn field scene lets the player inhabit the consequence.</p></section>
    <section class="handoff-board">
      <article class="programme-surface"><div class="surface-label"><span>01</span><p>LANDNAM / COMMAND DECK</p></div><h2>Commit the programme</h2><div class="program-metrics"><span><small>MISSION</small>Site access</span><span><small>CRAFT</small>Prospector</span><span><small>READINESS</small>74%</span></div><div class="queue-row"><i></i><div><b>Refinery queue</b><small>2 alloy plates · 05:12</small></div></div><div class="queue-row"><i></i><div><b>Launch window</b><small>Mare Imbrium · clear</small></div></div><p>Instrument panels, decisions and constraints are still Landnam’s domain: precise, information-rich, confidently authored.</p></article>
      <div class="handoff-arrow"><span>LAUNCH</span><b>→</b><small>same rover<br>same mission</small></div>
      <article class="field-surface"><div class="surface-label"><span>02</span><p>TAKEON / FIELD SANDBOX</p></div><h2>Enjoy the infrastructure</h2><div class="terrain-schematic"><span class="rock one"></span><span class="rock two"></span><span class="rover-dot">R</span><span class="route-line"></span><span class="cache-dot">C</span></div><div class="field-actions"><span>Drive</span><span>Build</span><span>Mine</span><span>Return</span></div><p>Here the UI recedes. Direct manipulation, a visible rover and a small terrain loop make the programme feel real.</p></article>
    </section>
    <section class="landnam-rules"><article><h2>Keep the seam visible</h2><p>Use a short launch/deployment transition and retain mission identity, cargo and target context on both sides.</p></article><article><h2>Do not duplicate HUDs</h2><p>The field scene needs a restrained action bar. Economy, contracts and programme-wide decisions stay in the host shell.</p></article><article><h2>Return with consequences</h2><p>Resources, photographs, discoveries and built infrastructure become readable programme state when the player comes back to Landnam.</p></article></section>`;
}

function language(): string {
  return `
    <section class="page-heading"><p class="eyebrow">DESIGN LANGUAGE / SCALE OF PLAY</p><h1>More TakeOn should change the rhythm, not erase the host.</h1><p class="lede">The UI responds to where the player is. It shifts from interpretation and commitment to direct action and spatial pleasure, then back to meaning.</p></section>
    <section class="language-track">
      <article class="language-stage host-stage"><span>01 / PLAN</span><h2>Host command deck</h2><p>Dense, mission-facing surfaces. Tables, target fit, budget, launch readiness and construction queues belong here.</p><div class="token-row"><i></i><i></i><i></i><i></i></div></article>
      <article class="language-stage field-stage"><span>02 / DO</span><h2>TakeOn field sandbox</h2><p>Canvas-first. Big terrain, compact physical controls, immediate feedback. The player looks at a place, not a dashboard.</p><div class="terrain-strip"><b></b><b></b><b></b><b></b><b></b></div></article>
      <article class="language-stage return-stage"><span>03 / UNDERSTAND</span><h2>Host return surface</h2><p>Reintroduce narrative, evidence and strategic decisions: what changed, what is unlocked, where to invest next.</p><div class="return-lines"><i></i><i></i><i></i></div></article>
    </section>
    <section class="scale-panel"><div><p class="eyebrow">USAGE SCALE</p><h2 id="scale-title">One focused field scene</h2><p id="scale-copy">Start with a single meaningful mission surface. Its job is to make a chosen programme decision tangible—not replace the whole game.</p></div><input id="scale" type="range" min="1" max="3" value="1" aria-label="TakeOn usage scale" /><div class="scale-labels"><span>Scene</span><span>Operations</span><span>World</span></div></section>`;
}

function page(route: Route): string {
  if (route === '/demo') return demo();
  if (route === '/ecosystem') return ecosystem();
  if (route === '/landnam') return landnam();
  if (route === '/language') return language();
  return home();
}

function mountDemo(): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>('#mission-canvas');
  const mars = getBody('mars');
  if (!canvas || !mars) return () => undefined;
  const game = createRoverGame({
    canvas,
    body: mars,
    spec: { ...defaultSpec(), id: 'atlas-scout', name: 'Atlas Scout' },
    audio: false,
  });
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    game.resize(bounds.width, bounds.height, Math.min(2, window.devicePixelRatio || 1));
  };
  resize();
  window.addEventListener('resize', resize);
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'move') game.move(Number(button.dataset.dir) as 0 | 1 | 2 | 3);
      if (action === 'mine') game.mine();
      if (action === 'scan') game.scan();
      if (action === 'photo') game.photo();
    });
  });
  game.start();
  return () => {
    window.removeEventListener('resize', resize);
    game.dispose();
  };
}

function mountLanguage(): void {
  const slider = document.querySelector<HTMLInputElement>('#scale');
  const title = document.querySelector<HTMLElement>('#scale-title');
  const copy = document.querySelector<HTMLElement>('#scale-copy');
  if (!slider || !title || !copy) return;
  const states = [
    ['One focused field scene', 'Start with a single meaningful mission surface. Its job is to make a chosen programme decision tangible—not replace the whole game.'],
    ['A connected operations loop', 'Surface sites, rover upgrades and local construction begin to carry forward. Keep the host shell responsible for programme-wide decisions.'],
    ['A world the host can revisit', 'Multiple missions reuse the same field language. Preserve host identity with clear transitions, distinct UI density and purposeful returns.'],
  ];
  const update = () => {
    const [nextTitle, nextCopy] = states[Number(slider.value) - 1];
    title.textContent = nextTitle;
    copy.textContent = nextCopy;
  };
  slider.addEventListener('input', update);
}

function render(): void {
  disposeDemo?.();
  disposeDemo = undefined;
  const route = routeFor(window.location.pathname);
  document.title = `${routes[route].label} · TakeOn Atlas`;
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = shell(route, page(route));
  document.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach(anchor => {
    anchor.addEventListener('click', event => {
      const href = anchor.getAttribute('href');
      if (!href?.startsWith('/')) return;
      event.preventDefault();
      window.history.pushState({}, '', href);
      render();
    });
  });
  if (route === '/demo') disposeDemo = mountDemo();
  if (route === '/language') mountLanguage();
}

window.addEventListener('popstate', render);
render();
