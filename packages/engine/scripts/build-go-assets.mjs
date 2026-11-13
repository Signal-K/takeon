import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
if(process.argv.includes('--clean'))rmSync(new URL('../dist/',import.meta.url),{recursive:true,force:true});
const generatedData = new URL('../src/data/', import.meta.url);
mkdirSync(generatedData, { recursive: true });
const catalogs = ['bodies', 'parts', 'materials', 'biomes', 'rules']
  .map(
    (name) =>
      'export const ' +
      name +
      '=' +
      readFileSync(new URL('../../../go/data/' + name + '.json', import.meta.url), 'utf8').trim() +
      ';',
  )
  .join('\n');
writeFileSync(
  new URL('core-catalog.ts', generatedData),
  '// Generated from canonical go/data JSON; do not edit.\n' + catalogs + '\n',
);
execFileSync('bash', ['go/scripts/build.sh', 'wasm'], { cwd: root, stdio: 'inherit' });
const shim = readFileSync(new URL('../../../go/dist/wasm_exec.js', import.meta.url), 'utf8');
const wasm = readFileSync(new URL('../../../go/dist/takeon.wasm', import.meta.url));
writeFileSync(
  new URL('../src/go/artifacts.ts', import.meta.url),
  '// @ts-nocheck\n// Generated from Go; do not edit.\nexport function installGoShim(){\n' +
    shim +
    '\nreturn globalThis.Go;\n}\nexport const wasmBase64: string =' +
    JSON.stringify(wasm.toString('base64')) +
    ';\n',
);
const out = new URL('../dist/go/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const name of ['wasm_exec.js', 'takeon.wasm'])
  cpSync(new URL('../../../go/dist/' + name, import.meta.url), new URL(name, out));
