package takeon

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
)

func TestExpandedGameplayAgainstTypeScript(t *testing.T) {
	data, err := os.ReadFile("../golden/expanded.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name       string
		Config     HostData
		Host       HostView
		Kind, Text string
		Arg, Ticks int
		Expected   map[string]any
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			g, err := NewConfiguredGame(4212, c.Config)
			if err != nil {
				t.Fatal(err)
			}
			g.ApplyHost(c.Host)
			var result any
			if c.Kind == "tick" {
				for i := 0; i < c.Ticks; i++ {
					g.Tick()
				}
			} else {
				result, err = g.HostCommand(c.Kind, c.Text, c.Arg, 0)
				if err != nil {
					t.Fatal(err)
				}
			}
			got := g.HostState()
			got["result"] = result
			b, _ := json.Marshal(got)
			var actual map[string]any
			_ = json.Unmarshal(b, &actual)
			var compare func(string, any, any)
			compare = func(path string, want, got any) {
				switch w := want.(type) {
				case map[string]any:
					a, ok := got.(map[string]any)
					if !ok {
						if len(w) == 0 && got == nil {
							return
						}
						t.Errorf("%s: expected object, got %v", path, got)
						return
					}
					for k, v := range w {
						if k == "id" || k == "renderPos" {
							continue
						}
						compare(path+"."+k, v, a[k])
					}
				case []any:
					a, ok := got.([]any)
					if !ok {
						if len(w) == 0 && got == nil {
							return
						}
						t.Errorf("%s: expected array", path)
						return
					}
					if len(a) != len(w) {
						t.Errorf("%s: length %d != %d", path, len(a), len(w))
						return
					}
					for i, v := range w {
						compare(fmt.Sprintf("%s[%d]", path, i), v, a[i])
					}
				case float64:
					a, ok := got.(float64)
					if !ok || math.Abs(a-w) > 1e-9 {
						t.Errorf("%s: %v != %v", path, got, w)
					}
				default:
					if want != got {
						t.Errorf("%s: %v != %v", path, got, want)
					}
				}
			}
			compare(c.Name, c.Expected, actual)
		})
	}
}
