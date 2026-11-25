"""Render a contact sheet from the running solar studio's actual mesh API.

Run the studio locally, then: python3 tools/solar/contact_sheet.py OUTPUT.png
The simplified offline rasteriser is for review, not the interactive renderer.
"""
import json, math, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont

base = os.environ.get('SOLAR_STUDIO_URL', 'http://127.0.0.1:4343')
def fetch(path):
    with urllib.request.urlopen(base + path, timeout=90) as response:
        return json.load(response)
profiles = fetch('/api/profiles')
w, h, cols = 290, 310, 6
sheet = Image.new('RGB', (w*cols, h*math.ceil(len(profiles)/cols)), '#0b1321')
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
for k, p in enumerate(profiles):
    m = fetch('/api/mesh?id=%s&seed=42' % p['id'])
    pos = np.asarray(m['positions'], dtype=np.float32).reshape(-1,3,3)
    norm = np.asarray(m['normals'], dtype=np.float32).reshape(-1,3,3)
    color = np.asarray(m['colors'], dtype=np.float32).reshape(-1,3,3).mean(axis=1)
    # Rotate the actual viewer mesh into a common three-quarter view.
    right = np.array([.8, 0, -.6]); up = np.array([-.15, .968, -.2]); view = np.cross(right, up)
    xy = np.stack((pos @ right, pos @ up), axis=-1)
    depth = (pos @ view).mean(axis=1)
    n = norm.mean(axis=1)
    visible = (n @ view) > 0
    shade = np.clip(.35 + .75 * (n @ np.array([-.25, .65, .72])), .24, 1)
    rgb = np.clip(color * shade[:,None] * 255, 0, 255).astype(np.uint8)
    xy = xy * 103 + np.array([w/2, h/2-14]); xy[:,:,1] = h-28-xy[:,:,1]
    tile = Image.new('RGB', (w,h), '#111e30'); draw=ImageDraw.Draw(tile)
    for i in np.argsort(depth):
        if visible[i]: draw.polygon([tuple(point) for point in xy[i]], fill=tuple(rgb[i]))
    draw.text((16, 12), p['name'], fill='#f4f0e8', font=font)
    label = 'CLOUDS' if not p['landable'] else ('MEASURED + GENERATED' if p['id'] in ('moon','mars') else 'GENERATED RELIEF')
    draw.text((16, 37), label, fill='#a5b6c7', font=small)
    sheet.paste(tile, ((k%cols)*w, (k//cols)*h))
    print(p['name'], flush=True)
sheet.save(sys.argv[1])
