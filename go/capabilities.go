package takeon

const ProtocolVersion = 1

// Set from the same canonical source digest for WASM, xcframework and AAR builds.
var CoreSourceHash = "development"

type RuntimeCapabilities struct {
	SourceHash      string   `json:"sourceHash"`
	ProtocolVersion int      `json:"protocolVersion"`
	Commands        []string `json:"commands"`
	Orders          []string `json:"orders"`
	Unsupported     []string `json:"unsupported"`
	SnapshotFormat  string   `json:"snapshotFormat"`
}

func Capabilities() RuntimeCapabilities {
	return RuntimeCapabilities{SourceHash: CoreSourceHash, ProtocolVersion: ProtocolVersion, Commands: []string{"build", "craft", "scan", "photo", "rotateStructure", "demolish"}, Orders: []string{"move", "drill", "mine", "cancel", "scan", "photo", "launch", "deposit", "upgrade", "placeBlock", "repair"}, Unsupported: []string{}, SnapshotFormat: "takeon-go/v1"}
}
