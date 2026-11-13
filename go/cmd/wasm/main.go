//go:build js && wasm

// The WASM target exports a single versioned JSON boundary. Each create request
// owns an independent Game; no simulation state is held in a singleton engine.
package main

import (
	"github.com/Signal-K/takeon-go/bridge"
	"syscall/js"
)

func main() {
	var session bridge.Session
	call := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return `{"ok":false,"error":"expected one JSON request"}`
		}
		return session.Call(args[0].String())
	})
	js.Global().Set("takeonCore", call)
	select {}
}
