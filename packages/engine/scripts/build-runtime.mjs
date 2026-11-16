// KES-212 phase 3: packages the shared client as one versioned file a WebView or page can load.
// Output: dist/runtime/takeon-runtime.js (IIFE, global TakeOnRuntime), dist/runtime/index.html, dist/runtime/manifest.json.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'runtime');
mkdirSync(out, { recursive: true });

const host = readFileSync(join(root, 'src', 'core', 'host.ts'), 'utf8');
const protocol = readFileSync(join(root, 'src', 'core', 'protocol.ts'), 'utf8');
const runtimeVersion = /RUNTIME_VERSION = '([^']+)'/.exec(host)?.[1];
const protocolVersion = Number(/PROTOCOL_VERSION = (\d+)/.exec(protocol)?.[1]);
if (!runtimeVersion || !protocolVersion) throw new Error('could not read RUNTIME_VERSION / PROTOCOL_VERSION');

await build({
  entryPoints: [join(root, 'src', 'runtime', 'bundle.ts')],
  outfile: join(out, 'takeon-runtime.js'),
  bundle: true,
  format: 'iife',
  globalName: 'TakeOnRuntime',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'none',
  banner: { js: `/* TakeOn runtime ${runtimeVersion} · protocol ${protocolVersion} */` },
});

const js = readFileSync(join(out, 'takeon-runtime.js'));
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>TakeOn</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none}#takeon{display:block;width:100vw;height:100vh}</style>
</head><body><canvas id="takeon"></canvas>
<script src="takeon-runtime.js"></script><script>TakeOnRuntime.boot()</script>
</body></html>
`);
writeFileSync(join(out, 'manifest.json'), JSON.stringify({
  runtime: runtimeVersion,
  protocol: protocolVersion,
  entry: 'index.html',
  script: 'takeon-runtime.js',
  sha256: createHash('sha256').update(js).digest('hex'),
  bytes: js.length,
}, null, 2) + '\n');
console.log(`takeon-runtime ${runtimeVersion} (protocol ${protocolVersion}): ${(js.length / 1024).toFixed(0)} KB`);
