package mobile

import (
	"encoding/json"
	takeon "github.com/Signal-K/takeon-go"
	"testing"
)

func TestSolarMobile(t *testing.T) {
	value, err := SolarSampleJSON("mars", 42, 10, 20)
	if err != nil {
		t.Fatal(err)
	}
	var got takeon.SolarSample
	if err = json.Unmarshal([]byte(value), &got); err != nil {
		t.Fatal(err)
	}
	want, err := takeon.SampleSolarBody("mars", 42, 10, 20)
	if err != nil || got != want {
		t.Fatalf("mobile mismatch %+v %+v %v", got, want, err)
	}
	styled, err := StyledSolarSampleJSON("mars", 42, 10, 20)
	if err != nil {
		t.Fatal(err)
	}
	patch, err := StyledSolarPatchJSON("mars", 42, 10, 20, 1, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	var one takeon.StyledSolarSample
	var many []takeon.StyledSolarSample
	if json.Unmarshal([]byte(styled), &one) != nil || json.Unmarshal([]byte(patch), &many) != nil || len(many) != 4 || one != many[0] {
		t.Fatal("styled mobile patch mismatch")
	}
	landingJSON, err := SolarLandingJSON("mars", 42, 10, 20, 1, 3, 3)
	if err != nil {
		t.Fatal(err)
	}
	var landing takeon.SolarLanding
	if json.Unmarshal([]byte(landingJSON), &landing) != nil || landing.Center != one {
		t.Fatal("mobile landing mismatch")
	}
	if _, err = SolarSampleJSON("mars", -1, 0, 0); err == nil {
		t.Fatal("negative seed accepted")
	}
	if _, err = SolarPatchJSON("jupiter", 42, 0, 0, 1, 2, 2); err == nil {
		t.Fatal("gas surface accepted")
	}
}
