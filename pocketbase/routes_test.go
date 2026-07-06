package main

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// missionCreditsGo is the server's authoritative payout. It must match the
// engine's missionCredits() in packages/engine/src/net/sync.ts — the
// economy-parity vitest guards the constants; this guards the arithmetic.
func TestMissionCreditsGo(t *testing.T) {
	const stateJSON = `{
		"id":"m","bodyId":"mars","status":"active",
		"rover":{"cargo":{"copper":2}},
		"anomalies":[{"documented":true},{"documented":false}],
		"photos":[{"quality":10},{"quality":6}]
	}`
	var lite missionStateLite
	if err := json.Unmarshal([]byte(stateJSON), &lite); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// banked iron 3*5=15 + cargo copper 2*6=12 + 1 documented*120 + photos
	// round(10*2)+round(6*2)=32  =>  179
	if got := missionCreditsGo(lite, map[string]float64{"iron": 3}); got != 179 {
		t.Fatalf("credits = %d, want 179", got)
	}

	// Empty everything pays nothing.
	if got := missionCreditsGo(missionStateLite{}, nil); got != 0 {
		t.Fatalf("empty credits = %d, want 0", got)
	}

	// Photo quality rounds half up (2.5*2 = 5.0 + 0.5 -> 5).
	var half missionStateLite
	_ = json.Unmarshal([]byte(`{"photos":[{"quality":2.5}]}`), &half)
	if got := missionCreditsGo(half, nil); got != 5 {
		t.Fatalf("rounded photo credits = %d, want 5", got)
	}

	// Unknown resource keys contribute nothing (map zero value), never panic.
	if got := missionCreditsGo(missionStateLite{}, map[string]float64{"unobtanium": 99}); got != 0 {
		t.Fatalf("unknown resource credits = %d, want 0", got)
	}
}

func TestDecodeDataURL(t *testing.T) {
	// A 1x1 PNG.
	png := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
	raw, name, err := decodeDataURL(png, "pho_1")
	if err != nil {
		t.Fatalf("valid png: %v", err)
	}
	if len(raw) == 0 || !strings.HasSuffix(name, ".png") {
		t.Fatalf("decoded name=%q len=%d", name, len(raw))
	}

	// JPEG keeps the default extension.
	if _, name, err := decodeDataURL("data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString([]byte("hi")), "p"); err != nil || !strings.HasSuffix(name, ".jpg") {
		t.Fatalf("jpeg name=%q err=%v", name, err)
	}

	// Rejections.
	if _, _, err := decodeDataURL("https://example.com/x.png", "p"); err == nil {
		t.Fatal("expected error for non-data url")
	}
	if _, _, err := decodeDataURL("data:image/png,notbase64", "p"); err == nil {
		t.Fatal("expected error for non-base64 data url")
	}
	// Oversized payload (> 2MB decoded) is rejected.
	big := base64.StdEncoding.EncodeToString(make([]byte, 2_000_001))
	if _, _, err := decodeDataURL("data:image/png;base64,"+big, "p"); err == nil {
		t.Fatal("expected error for oversized image")
	}
}
