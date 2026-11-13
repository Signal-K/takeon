# Takeon shared Go core

The deterministic core, mission runtime and mobile facade live here. See
[../docs/go-runtime.md](../docs/go-runtime.md) for ownership, supported operations,
package builds, source provenance and the remaining migration gates (SSL-778).

Go >= 1.26 is required. `go test ./...` reads the tracked `../golden/*.json`
fixtures; they are historical parity evidence, not coverage of every current
TypeScript feature. `scripts/build.sh wasm` produces `dist/takeon.wasm` plus its
matching `wasm_exec.js`. Mobile build requirements are documented alongside the
[Kotlin wrapper](android/README.md).
