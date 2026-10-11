//go:build js && wasm

// Command wasm exposes the takeon engine to JavaScript as globalThis.takeon.
package main

import (
	"syscall/js"

	"github.com/Signal-K/takeon-go/mobile"
)

func main() {
	var eng *mobile.Engine
	api := map[string]any{
		"new": js.FuncOf(func(_ js.Value, a []js.Value) any {
			var err error
			eng, err = mobile.NewEngine(int64(a[0].Int()), a[1].String())
			if err != nil {
				return err.Error()
			}
			return nil
		}),
		"step":      js.FuncOf(func(_ js.Value, a []js.Value) any { s, _ := eng.Step(a[0].Float()); return s }),
		"order":     js.FuncOf(func(_ js.Value, a []js.Value) any { ok, _ := eng.Order(a[0].String(), a[1].Int()); return ok }),
		"orderMine": js.FuncOf(func(_ js.Value, a []js.Value) any { return eng.OrderMine(a[0].Int(), a[1].Int()) }),
		"bank":      js.FuncOf(func(_ js.Value, _ []js.Value) any { return eng.Bank() }),
		"state":     js.FuncOf(func(_ js.Value, _ []js.Value) any { s, _ := eng.StateJSON(); return s }),
		"mission":   js.FuncOf(func(_ js.Value, _ []js.Value) any { s, _ := eng.MissionJSON(); return s }),
		"snapshot":  js.FuncOf(func(_ js.Value, _ []js.Value) any { b, _ := eng.Snapshot(); return string(b) }),
		"restore": js.FuncOf(func(_ js.Value, a []js.Value) any {
			if err := eng.Restore([]byte(a[0].String())); err != nil {
				return err.Error()
			}
			return nil
		}),
	}
	js.Global().Set("takeon", js.ValueOf(api))
	select {}
}
