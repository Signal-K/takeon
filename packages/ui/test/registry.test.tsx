import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSlot, Slot, TakeOnUIProvider, useLabel, useSlotClass } from '../src/registry.js';

/**
 * The contract that lets a game built on TakeOn adapt the UI: any component
 * can be replaced, wrapped, relabelled, restyled or extended from the parent
 * app — including components rendered deep inside other components.
 */

interface PanelProps {
  title: string;
}

function DefaultPanel({ title }: PanelProps) {
  return (
    <section className={['panel', useSlotClass('Panel')].filter(Boolean).join(' ')}>
      <h1>{useLabel('panel.title', title)}</h1>
      <Slot name="panel.end" />
    </section>
  );
}

const Panel = createSlot('Panel', DefaultPanel);

function Screen() {
  return (
    <main>
      <Panel title="Stock" />
    </main>
  );
}

describe('component registry', () => {
  it('renders the default when nothing is registered', () => {
    const html = renderToStaticMarkup(
      <TakeOnUIProvider>
        <Screen />
      </TakeOnUIProvider>,
    );
    expect(html).toContain('<h1>Stock</h1>');
  });

  it('replaces a nested component from the parent app', () => {
    const html = renderToStaticMarkup(
      <TakeOnUIProvider components={{ Panel: ({ title }: PanelProps) => <aside>custom {title}</aside> }}>
        <Screen />
      </TakeOnUIProvider>,
    );
    expect(html).toContain('<aside>custom Stock</aside>');
    expect(html).not.toContain('<h1>');
  });

  it('lets an override wrap the default instead of replacing it', () => {
    const Wrapping = (props: PanelProps) => (
      <div className="wrapper">
        <Panel.Default {...props} />
      </div>
    );
    const html = renderToStaticMarkup(
      <TakeOnUIProvider components={{ Panel: Wrapping }}>
        <Screen />
      </TakeOnUIProvider>,
    );
    expect(html).toContain('wrapper');
    expect(html).toContain('<h1>Stock</h1>');
  });

  it('does not recurse when an override renders its own slot', () => {
    const Recursive = (props: PanelProps) => (
      <div className="wrapper">
        <Panel {...props} />
      </div>
    );
    const html = renderToStaticMarkup(
      <TakeOnUIProvider components={{ Panel: Recursive }}>
        <Screen />
      </TakeOnUIProvider>,
    );
    // One wrapper, then the stock panel — the override is suppressed one level
    // down rather than looping forever.
    expect(html.match(/wrapper/g)?.length).toBe(1);
    expect(html).toContain('<h1>Stock</h1>');
  });

  it('applies labels, class names, slots and theme variables', () => {
    const html = renderToStaticMarkup(
      <TakeOnUIProvider
        labels={{ 'panel.title': 'Relabelled' }}
        classNames={{ Panel: 'host-panel' }}
        slots={{ 'panel.end': <b>extra</b> }}
        theme={{ accent: '#ff8a3d' }}
      >
        <Screen />
      </TakeOnUIProvider>,
    );
    expect(html).toContain('Relabelled');
    expect(html).toContain('panel host-panel');
    expect(html).toContain('<b>extra</b>');
    expect(html).toContain('--tk-accent:#ff8a3d');
  });

  it('merges nested providers so a screen can refine app-wide config', () => {
    const html = renderToStaticMarkup(
      <TakeOnUIProvider labels={{ 'panel.title': 'App' }} classNames={{ Panel: 'app' }}>
        <TakeOnUIProvider classNames={{ Panel: 'screen' }}>
          <Screen />
        </TakeOnUIProvider>
      </TakeOnUIProvider>,
    );
    expect(html).toContain('App');
    expect(html).toContain('panel app screen');
  });
});
