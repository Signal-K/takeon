// Produce the opt-in package artifacts without changing the default TS build.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
execFileSync('bash', ['go/scripts/build.sh', 'wasm'], { cwd: root, stdio: 'inherit' });
execFileSync('npm', ['run', 'build', '-w', '@takeon/engine'], { cwd: root, stdio: 'inherit' });
const destination = new URL('../dist/go/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const file of ['takeon.wasm', 'wasm_exec.js']) {
  cpSync(new URL(`../../../go/dist/${file}`, import.meta.url), new URL(file, destination));
}
