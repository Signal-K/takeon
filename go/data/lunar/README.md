# NASA Lunar Reconnaissance Orbiter maps

Source: [NASA Scientific Visualization Studio, CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), visualization by Ernie Wright, NASA's Scientific Visualization Studio.

- `ldem_4_uint.png` is a lossless PNG conversion of NASA's `ldem_4_uint.tif`, 1440 × 720, LOLA elevation at 4 pixels per degree. The 16-bit values encode half-metres with a 20,000-unit offset relative to a 1,737,400 m reference sphere.
- `lroc_color_2k.jpg` is NASA's 2048 × 1024 LROC colour mosaic. NASA identifies it as optimized for visualization rather than scientific analysis.

Both maps are equirectangular and centered on 0° longitude. Polar parts of the colour map incorporate lower-resolution altimeter albedo. Their resolution limits what a denser mesh can reveal. The viewer exaggerates elevation fourfold for readability. Other solar bodies still use procedural, not observed, terrain.
