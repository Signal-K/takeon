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
	if _, err = SolarSampleJSON("mars", -1, 0, 0); err == nil {
		t.Fatal("negative seed accepted")
	}
	if _, err = SolarPatchJSON("jupiter", 42, 0, 0, 1, 2, 2); err == nil {
		t.Fatal("gas surface accepted")
	}
}
