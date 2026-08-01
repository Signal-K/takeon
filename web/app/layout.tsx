import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@takeon/ui/styles.css';
import '@takeon/editor/styles.css';
import './globals.css';
import { SyncProvider } from '../lib/sync-context';

export const metadata: Metadata = {
  title: 'TakeOn — Rover Missions',
  description:
    'Build a rover, send it to a planet, moon or asteroid. Drive, mine, photograph, discover, construct.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0a0d14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SyncProvider>
          <nav className="topnav">
            <Link href="/" className="logo">
              TAKE<span>ON</span>
            </Link>
            <span className="chip">rover missions</span>
            <span className="spacer" />
            <Link href="/editor">
              <button title="World editor: terrain, noise, maps, play mode">🛠 Editor</button>
            </Link>
            <Link href="/customize">
              <button>+ New rover</button>
            </Link>
          </nav>
          {children}
        </SyncProvider>
      </body>
    </html>
  );
}
