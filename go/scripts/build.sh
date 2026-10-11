#!/usr/bin/env bash
# Build takeon runtime artifacts into go/dist. Usage: build.sh [ios|android|wasm|test|all]
# Needs: go, gomobile (go install golang.org/x/mobile/cmd/gomobile@latest; gomobile init),
# Xcode (ios), ANDROID_HOME + NDK + JDK (android).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/dist"; mkdir -p "$OUT"
JAVAPKG=com.signalk.takeon
what="${1:-all}"
t_test()    { go test ./... ; GOOS=js GOARCH=wasm go vet ./... ; }
t_wasm()    { GOOS=js GOARCH=wasm go build -o "$OUT/takeon.wasm" ./cmd/wasm && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$OUT/" 2>/dev/null || cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" "$OUT/"; }
t_ios()     { gomobile bind -target ios,iossimulator,macos -o "$OUT/Takeon.xcframework" ./mobile; }
t_android() { gomobile bind -target android -androidapi 24 -javapkg "$JAVAPKG" -o "$OUT/takeon.aar" ./mobile; }
case "$what" in
  test) t_test;; wasm) t_wasm;; ios) t_ios;; android) t_android;;
  all) t_test; t_wasm; t_ios; t_android;;
  *) echo "usage: $0 [test|wasm|ios|android|all]"; exit 2;;
esac
