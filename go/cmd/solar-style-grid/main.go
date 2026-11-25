// solar-style-grid exports the shared Go sampler for the offline Blender proof.
package main

import (
	"bufio"
	"encoding/binary"
	"flag"
	takeon "github.com/Signal-K/takeon-go"
	"log"
	"os"
)

func main() {
	body := flag.String("body", "mars", "solar body")
	seed := flag.Uint("seed", 11, "terrain seed")
	output := flag.String("out", "/tmp/solar-style-grid.bin", "float32 radius grid")
	flag.Parse()
	f, err := os.Create(*output)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	for y := 0; y <= 512; y++ {
		for x := 0; x <= 1024; x++ {
			s, err := takeon.SampleStyledSolarBody(*body, uint32(*seed), -90+180*float64(y)/512, -180+360*float64(x)/1024)
			if err != nil {
				log.Fatal(err)
			}
			if err = binary.Write(w, binary.LittleEndian, float32(s.Radius)); err != nil {
				log.Fatal(err)
			}
		}
	}
	if err = w.Flush(); err != nil {
		log.Fatal(err)
	}
}
