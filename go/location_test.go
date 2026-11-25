package takeon

import "testing"

func TestLocationDeterminismAndSurface(t *testing.T) {
	spec := LocationSpec{Version: 1, ID: "site-1", ParentID: "system-1", BodyID: "mars", Seed: 42}
	a, err := GenerateLocation(spec)
	if err != nil {
		t.Fatal(err)
	}
	b, err := GenerateLocation(spec)
	if err != nil {
		t.Fatal(err)
	}
	if a != b || a.Type != "planet" || a.MapX > 10000 || a.MapY > 10000 {
		t.Fatalf("invalid location: %+v, %+v", a, b)
	}
	g1, err := NewGame(int64(a.TerrainSeed), a.Spec.BodyID)
	if err != nil {
		t.Fatal(err)
	}
	g2, err := NewGame(int64(b.TerrainSeed), b.Spec.BodyID)
	if err != nil {
		t.Fatal(err)
	}
	w1, err := g1.Window(0, 0, 16, 16)
	if err != nil {
		t.Fatal(err)
	}
	w2, err := g2.Window(0, 0, 16, 16)
	if err != nil {
		t.Fatal(err)
	}
	if w1 != w2 {
		t.Fatal("same location produced different surfaces")
	}
	changed := spec
	changed.ID = "site-2"
	other, err := GenerateLocation(changed)
	if err != nil {
		t.Fatal(err)
	}
	if a.TerrainSeed == other.TerrainSeed {
		t.Fatal("distinct identity did not change generation")
	}
	if a.MapX != 2939 || a.MapY != 9051 || a.TerrainSeed != 2717056761 {
		t.Fatalf("version 1 output changed: %+v", a)
	}
}

func TestLocationValidation(t *testing.T) {
	valid := LocationSpec{Version: 1, ID: "a", ParentID: "b", BodyID: "moon"}
	cases := []LocationSpec{valid, valid, valid, valid, valid}
	cases[0].Version = 2
	cases[1].ID = " "
	cases[2].ParentID = ""
	cases[3].BodyID = "missing"
	cases[4].BodyID = "skyhaven"
	for _, spec := range cases {
		if _, err := GenerateLocation(spec); err == nil {
			t.Errorf("accepted %+v", spec)
		}
	}
	for _, body := range []string{"mars", "moon", "ceres"} {
		spec := valid
		spec.BodyID = body
		if _, err := GenerateLocation(spec); err != nil {
			t.Errorf("%s: %v", body, err)
		}
	}
}
