#!/usr/bin/env node
/**
 * Copy non-TypeScript build assets (stylesheets) into a package's dist.
 * `tsc` ignores them, and a plain `cp` is not portable enough for CI on
 * every platform contributors use.
 *
 *   node ../../scripts/copy-assets.mjs src/styles.css dist/styles.css
 *
 * Paths are resolved relative to the current working directory, i.e. the
 * package running the script.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('usage: copy-assets.mjs <src> <dest> [<src> <dest>...]');
  process.exit(1);
}

for (let i = 0; i < args.length; i += 2) {
  const src = resolve(process.cwd(), args[i]);
  const dest = resolve(process.cwd(), args[i + 1]);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
