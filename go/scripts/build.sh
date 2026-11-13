#!/usr/bin/env bash
# Build takeon runtime artifacts into go/dist. Usage: build.sh [ios|android|wasm|test|all]
# Needs: go, gomobile (go install golang.org/x/mobile/cmd/gomobile@latest; gomobile init),
# Xcode (ios), ANDROID_HOME + NDK + JDK (android).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/dist"; mkdir -p "$OUT"
JAVAPKG=com.signalk.takeon
what="${1:-all}"
# Hash only canonical runtime source/content, excluding tests and build products.
CORE_HASH="$(find . -type f \( -name '*.go' -o -name '*.json' \) ! -name '*_test.go' ! -path './dist/*' ! -path './android/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')"
CORE_LDFLAGS="-X github.com/Signal-K/takeon-go.CoreSourceHash=$CORE_HASH"

t_test()    { go test ./... ; GOOS=js GOARCH=wasm go vet ./... ; }
t_wasm() {
  GOOS=js GOARCH=wasm go build -buildvcs=false -ldflags "$CORE_LDFLAGS" -trimpath -o "$OUT/takeon.wasm" ./cmd/wasm
  local shim="$(go env GOROOT)/lib/wasm/wasm_exec.js"
  if [ ! -f "$shim" ]; then shim="$(go env GOROOT)/misc/wasm/wasm_exec.js"; fi
  cp "$shim" "$OUT/wasm_exec.js"
}
# Apple Silicon only and stripped (about 9 MB, 3.5 MB zipped); TAKEON_IOS_TARGETS=ios,iossimulator,macos adds Intel.
t_ios()     { rm -rf "$OUT/Takeon.xcframework" "$OUT/Takeon.xcframework.zip"
              go tool gomobile bind -ldflags="-s -w $CORE_LDFLAGS" -trimpath -target "${TAKEON_IOS_TARGETS:-ios/arm64,iossimulator/arm64,macos/arm64}" -o "$OUT/Takeon.xcframework" ./mobile
              (cd "$OUT" && ditto -c -k --keepParent Takeon.xcframework Takeon.xcframework.zip && shasum -a 256 Takeon.xcframework.zip); }
t_android() { go tool gomobile bind -ldflags="$CORE_LDFLAGS" -target android -androidapi 24 -javapkg "$JAVAPKG" -o "$OUT/takeon.aar" ./mobile; }
case "$what" in
  test) t_test;; wasm) t_wasm;; ios) t_ios;; android) t_android;;
  all) t_test; t_wasm; t_ios; t_android;;
  *) echo "usage: $0 [test|wasm|ios|android|all]"; exit 2;;
esac
