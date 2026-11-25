package mobile

import (
	"encoding/json"
	takeon "github.com/Signal-K/takeon-go"
	"testing"
)

func TestLocationMobile(t *testing.T) {
	spec := takeon.LocationSpec{Version: 1, ID: "site-1", ParentID: "system-1", BodyID: "mars", Seed: 42}
	b, _ := json.Marshal(spec)
	result, err := GenerateLocationJSON(string(b))
	if err != nil {
		t.Fatal(err)
	}
	var got takeon.Location
	if err := json.Unmarshal([]byte(result), &got); err != nil {
		t.Fatal(err)
	}
	want, err := takeon.GenerateLocation(spec)
	if err != nil || got != want {
		t.Fatalf("mobile differs from core: %+v != %+v (%v)", got, want, err)
	}
	if _, err := GenerateLocationJSON("{"); err == nil {
		t.Fatal("accepted invalid JSON")
	}
}
