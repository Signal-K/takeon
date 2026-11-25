//go:build !engine_minimal

package takeon

import "embed"

//go:embed data/planetary/*
var planetaryFiles embed.FS
