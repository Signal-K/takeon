package takeon

const ProtocolVersion = 1

type RuntimeCapabilities struct {
	ProtocolVersion int      `json:"protocolVersion"`
	Orders          []string `json:"orders"`
	Unsupported     []string `json:"unsupported"`
	SnapshotFormat  string   `json:"snapshotFormat"`
}

func Capabilities() RuntimeCapabilities {
	return RuntimeCapabilities{ProtocolVersion, []string{"move", "drill", "mine", "cancel"},
		[]string{"build", "craft", "scan", "photo", "launch", "upgrade", "placeBlock", "repair", "custom-world-registry", "blue-noise", "ore-bands", "dem"}, "takeon-go/v1"}
}
