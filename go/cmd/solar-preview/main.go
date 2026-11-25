// solar-preview produces a diagnostic overview of the shared globe and tile
// samples. It is not a game renderer or a visual acceptance test.
package main

import (
	"fmt"
	takeon "github.com/Signal-K/takeon-go"
	"math"
	"os"
)

var palette = map[string]string{
	"ocean": "#246781", "ice": "#d2e6e5", "tundra": "#b0b9a0", "highlands": "#8b9275", "drylands": "#c1a275", "grassland": "#7eaa80", "red-desert": "#b66b55", "volcanic-highlands": "#6c5754", "sulfur-plains": "#c5a66f", "ice-ridges": "#adc9d0", "icefield": "#d5e7e8", "methane-lakes": "#536c7a", "dunes": "#ae936a", "rubble-highlands": "#746c70", "dark-regolith": "#56575f", "metal-ridges": "#aab2b5", "metal-regolith": "#818b91", "crater-highlands": "#a59c90", "regolith": "#777772", "cloud-band": "#d3c0a2", "storm-band": "#a68771",
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: solar-preview output.svg")
		os.Exit(2)
	}
	f, err := os.Create(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()
	ps := takeon.SolarProfiles()
	fmt.Fprintln(f, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680" viewBox="0 0 1200 1680"><rect width="1200" height="1680" fill="#132238"/><g font-family="sans-serif" fill="#e9eff2"><text x="25" y="32" font-size="20">Solar generation · diagnostic overview · seed 42</text><text x="25" y="55" font-size="13">Globe sample and equatorial tile patch; colours are placeholders, not final art.</text>`)
	for i, p := range ps {
		ox, oy := float64(20+(i%4)*295), float64(75+(i/4)*264)
		fmt.Fprintf(f, `<g transform="translate(%.0f %.0f)"><rect width="280" height="250" rx="8" fill="#21334b"/><text x="12" y="23" font-size="16">%s</text><text x="12" y="42" font-size="11">%s · %s · %.0f°C baseline</text>`, ox, oy, p.Name, p.Type, p.Climate, p.Temperature)
		// 60x60 orthographic samples show the same spherical field as the tile patch.
		for y := 0; y < 60; y++ {
			for x := 0; x < 60; x++ {
				nx, ny := (float64(x)+0.5-30)/30, (30-float64(y)-0.5)/30
				if nx*nx+ny*ny > 1 {
					continue
				}
				lat := math.Asin(ny)
				lon := math.Asin(math.Max(-1, math.Min(1, nx/math.Cos(lat))))
				s, e := takeon.SampleSolarBody(p.ID, 42, lat*180/math.Pi, lon*180/math.Pi)
				if e != nil {
					panic(e)
				}
				fmt.Fprintf(f, `<rect x="%d" y="%d" width="2" height="2" fill="%s"/>`, 20+x*2, 55+y*2, palette[s.Biome])
			}
		}
		if p.Landable {
			patch, e := takeon.SampleSolarPatch(p.ID, 42, -6, -6, 1, 12, 12)
			if e != nil {
				panic(e)
			}
			for j, s := range patch {
				fmt.Fprintf(f, `<rect x="%d" y="%d" width="8" height="8" fill="%s"/>`, 164+(j%12)*8, 66+(11-j/12)*8, palette[s.Biome])
			}
			fmt.Fprint(f, `<text x="164" y="180" font-size="11">surface tiles</text>`)
		} else {
			fmt.Fprint(f, `<text x="156" y="110" font-size="12">No solid surface</text>`)
		}
		fmt.Fprint(f, `</g>`)
	}
	fmt.Fprintln(f, `</g></svg>`)
}
