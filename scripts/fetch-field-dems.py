#!/usr/bin/env python3
"""Cut real terrain patches for field scenes (KES-543).

    pip install rasterio numpy
    CURL_CA_BUNDLE=/path/to/ca.pem python3 scripts/fetch-field-dems.py

Reads USGS analysis-ready DTMs (cloud-optimised GeoTIFFs on the public
astrogeo-ard bucket, CC0) with HTTP range requests, so only the window it needs
is downloaded. For each source it scans the DTM on a coarse overview, picks the
window with the most relief that a rover can still drive (no cliffs, no holes),
reads that window at full resolution, resamples it to the patch grid and writes
heights in decimetres relative to the window's lowest point.

Output: packages/engine/src/field/dems.generated.ts (a FieldDemPatch per id).
Heights are real metres; the field PCG adds only detail finer than the patch's
ground sample distance, so the shape you drive over is the real one.
"""
import base64
import json
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')

BUCKET = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com'

# id, body, source text, DTM path, patch grid size, patch ground sample (m/px)
SOURCES = [
    dict(
        id='mars-jezero-fan', body='mars', label='Jezero crater, Mars · HiRISE',
        source='MRO HiRISE DTM DTEEC_002387_1985_003798_1985 (Univ. of Arizona / USGS ARD), Jezero crater depositional fan',
        path='/mars/mro/hirise/controlled/dtm/PSP_002387_1985_PSP_003798_1985/DTEEC_002387_1985_003798_1985_A01.tif',
        size=192, gsd=1.0, max_slope=0.42, max_relief=24,
    ),
    dict(
        id='mars-gale-dunes', body='mars', label='Gale crater dunes, Mars · HiRISE',
        source='MRO HiRISE DTM DTEEC_040770_1755_039280_1755 (Univ. of Arizona / USGS ARD), Bagnold dunes, Gale crater',
        path='/mars/mro/hirise/controlled/dtm/ESP_040770_1755_ESP_039280_1755/DTEEC_040770_1755_039280_1755_A01.tif',
        size=192, gsd=1.0, max_slope=0.45, max_relief=24, blur=2,
    ),
    dict(
        id='moon-taurus-littrow', body='moon', label='Taurus-Littrow, Moon · Kaguya',
        source='SELENE/Kaguya Terrain Camera DTM v2 TC2W2B0_01_07060N199E0305 (JAXA / USGS ARD), Taurus-Littrow valley (Apollo 17)',
        path='/moon/kaguya/terrain_camera/usgs_dtms_v2/TC2W2B0_01_07060N199E0305__TC1W2B0_01_07060N204E0305/TC2W2B0_01_07060N199E0305__TC1W2B0_01_07060N204E0305-DEM.tif',
        size=96, gsd=8.0, max_slope=0.3, max_relief=60, blur=4,
    ),
]


def pick_windows(src, side_px, max_slope, max_relief):
    """Windows (col, row) of side_px native pixels, best first: rough and drivable, no nodata."""
    # Work on an overview roughly 8 native px per cell.
    f = 8
    w, h = src.width // f, src.height // f
    a = src.read(1, out_shape=(h, w), resampling=Resampling.average, masked=True).astype('float64')
    valid = ~np.ma.getmaskarray(a) & (a.filled(-1e30) > -1e20)
    z = a.filled(np.nan)
    res = src.res[0] * f
    gy, gx = np.gradient(z, res)
    slope = np.hypot(gx, gy)
    s = max(4, side_px // f)
    found = []
    step = max(1, s // 3)
    for r in range(0, h - s, step):
        for c in range(0, w - s, step):
            if not valid[r:r + s, c:c + s].all():
                continue
            win = z[r:r + s, c:c + s]
            sl = slope[r + 1:r + s - 1, c + 1:c + s - 1]
            if not np.isfinite(sl).all() or np.percentile(sl, 97) > max_slope:
                continue
            relief = float(np.nanmax(win) - np.nanmin(win))
            if relief > max_relief:
                continue
            rough = float(np.nanstd(sl))
            found.append((relief + rough * 10, (c * f, r * f)))
    found.sort(reverse=True)
    return [at for _, at in found]


def cut(spec):
    url = '/vsicurl/' + BUCKET + spec['path']
    with rasterio.open(url) as src:
        native = src.res[0]
        side_px = int(round(spec['size'] * spec['gsd'] / native))
        n = spec['size']
        z = None
        for at in pick_windows(src, side_px, spec['max_slope'], spec['max_relief'])[:12]:
            win = Window(at[0], at[1], side_px, side_px)
            z = src.read(1, window=win, out_shape=(n, n), resampling=Resampling.bilinear, masked=True)
            if not np.ma.getmaskarray(z).any() and float(z.min()) > -1e20:
                break
            z = None
        if z is None:
            raise SystemExit(f"{spec['id']}: no drivable window without holes")
        z = np.asarray(z, dtype='float64')
        # Stereo DTMs carry pixel-scale matching noise and seam stripes; a
        # light blur removes it, and the PCG puts real-scale grain back.
        for _ in range(spec.get('blur', 1)):
            p = np.pad(z, 1, mode='edge')
            z = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 4 * p[1:-1, 1:-1]) / 8
        lon, lat = src.xy(at[1] + side_px / 2, at[0] + side_px / 2)
    z -= z.min()
    dm = np.clip(np.round(z * 10), 0, 32767).astype('<i2')
    relief = float(z.max())
    print(f"  {spec['id']}: {n}x{n} @ {spec['gsd']} m (native {native:.2f} m), relief {relief:.1f} m", file=sys.stderr)
    return {
        'id': spec['id'], 'body': spec['body'], 'label': spec['label'], 'source': spec['source'],
        'size': n, 'gsd': spec['gsd'], 'relief': round(relief, 1),
        'centre': [round(lon, 2), round(lat, 2)],
        'dm': base64.b64encode(dm.tobytes()).decode('ascii'),
    }


def main():
    patches = []
    for s in SOURCES:
        print(f"cutting {s['id']} ...", file=sys.stderr)
        patches.append(cut(s))
    lines = [
        '/**',
        ' * GENERATED by scripts/fetch-field-dems.py — do not edit by hand.',
        ' * Real DTM windows (USGS analysis-ready data, CC0). Heights are decimetres',
        ' * above the window minimum, little-endian int16, base64. `centre` is the',
        ' * window centre in projected metres of the source DTM.',
        ' */',
        "import type { FieldDemPatch } from './dem.js';",
        '',
        'export const FIELD_DEMS: FieldDemPatch[] = [',
    ]
    for p in patches:
        dm = p.pop('dm')
        head = json.dumps(p)[1:-1]
        lines.append(f"  {{ {head}, dm: '{dm}' }},")
    lines.append('];')
    lines.append('')
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'packages', 'engine', 'src', 'field', 'dems.generated.ts')
    with open(out, 'w') as fh:
        fh.write('\n'.join(lines))
    print('wrote', os.path.normpath(out), file=sys.stderr)


if __name__ == '__main__':
    main()
