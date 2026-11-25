"""Render NASA LRO lunar topography as a high-resolution 3D preview.

Usage: blender -b -t 4 --python tools/solar/render_moon.py -- <output.png>
The 1024 × 512 UV sphere has 16× the triangles of the previous 256 × 128
studio mesh. Elevations are exaggerated fourfold for legibility.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
output = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/landnam-moon.png'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.world.color = (0.005, 0.008, 0.018)
scene.view_settings.view_transform = 'AgX'

# Construct a 1024 × 512 latitude-longitude sphere in bulk. Quads render as
# 1,048,576 triangles: sixteen times the 128 × 256 interactive grid.
rows, cols = 512, 1024
lat = np.linspace(-np.pi/2, np.pi/2, rows+1, dtype=np.float32)[:,None]
lon = np.linspace(-np.pi, np.pi, cols+1, dtype=np.float32)[None,:]
coslat = np.cos(lat)
vertices = np.stack(np.broadcast_arrays(coslat*np.cos(lon), coslat*np.sin(lon), np.sin(lat)), axis=-1).astype(np.float32).ravel()
y, x = np.indices((rows, cols), dtype=np.int32)
a = y*(cols+1)+x
faces = np.stack((a, a+1, a+cols+2, a+cols+1), axis=-1).ravel()
mesh = bpy.data.meshes.new('LRO sphere')
mesh.vertices.add((rows+1)*(cols+1)); mesh.vertices.foreach_set('co',vertices)
mesh.loops.add(rows*cols*4); mesh.loops.foreach_set('vertex_index',faces)
mesh.polygons.add(rows*cols)
mesh.polygons.foreach_set('loop_start',np.arange(rows*cols,dtype=np.int32)*4)
mesh.polygons.foreach_set('loop_total',np.full(rows*cols,4,dtype=np.int32))
mesh.polygons.foreach_set('use_smooth',np.ones(rows*cols,dtype=np.bool_))
mesh.update()
# UV images run west→east, north→south. UV's v axis is bottom→top.
u = x.astype(np.float32)/cols; v = y.astype(np.float32)/rows
uv = np.stack((np.stack((u,v),-1),np.stack((u+1/cols,v),-1),np.stack((u+1/cols,v+1/rows),-1),np.stack((u,v+1/rows),-1)),axis=-2).ravel()
mesh.uv_layers.new(name='LRO').data.foreach_set('uv',uv)
moon = bpy.data.objects.new('LRO Moon · 16× mesh',mesh)
scene.collection.objects.link(moon)
# Blender's sphere UV uses the global equirectangular texture directly.
height = bpy.data.images.load(os.path.join(root, 'go/data/lunar/ldem_4_uint.png'))
height.colorspace_settings.name = 'Non-Color'
tex = bpy.data.textures.new('NASA LOLA elevation', type='IMAGE')
tex.image = height
modifier = moon.modifiers.new('LOLA elevation, 4× vertical exaggeration', 'DISPLACE')
modifier.texture = tex
modifier.texture_coords = 'UV'
modifier.uv_layer = moon.data.uv_layers.active.name
modifier.mid_level = 20000 / 65535
modifier.strength = 4 * 32767.5 / 1737400
mat = bpy.data.materials.new('LROC lunar surface')
mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = nodes.get('Principled BSDF')
color = nodes.new('ShaderNodeTexImage')
color.image = bpy.data.images.load(os.path.join(root, 'go/data/lunar/lroc_color_2k.jpg'))
mat.node_tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.9
moon.data.materials.append(mat)

def point_at(obj, target=(0, 0, 0)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.camera_add(location=(0, -3.6, 0.25))
camera = bpy.context.object
point_at(camera)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.45
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 3))
light = bpy.context.object
light.data.energy = 500
light.data.shape = 'DISK'
light.data.size = 3
point_at(light)
bpy.ops.object.light_add(type='AREA', location=(3, 0, -1))
fill = bpy.context.object
fill.data.energy = 100
fill.data.size = 5
point_at(fill)
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output
bpy.ops.render.render(write_still=True)
