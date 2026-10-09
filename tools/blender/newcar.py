# A new car, start to finish, from a Sketchfab import already in the scene (MCP import_asset, target_size ~4.6).
# Load into Blender once per session, in this order, all into one namespace put on builtins (each MCP call gets a fresh
# namespace):
#   carlib.py, sfab.py, texsplit.py, newcar.py
# then per car:
#   build('valhalla', rules=[...], **prepare_car options)   -> OUT/<id>.glb (and the raw import saved to RAW_DIR)
# and from app/:  python3 ../tools/blender/glb2json.py OUT   -> app/models/<id>.json
import bpy, bmesh, os

OUT = '/tmp/rh_glb'


def smooth(id):
    """Even out the decimated paint so reflections run clean: weld near-duplicate paint vertices, relax the interior of
    paint regions a little, shade smooth and weight normals by face area (sharp edges kept)."""
    ob = bpy.data.objects[id + '_body']
    me = ob.data
    pi = [i for i, s in enumerate(ob.material_slots) if s.material and s.material.name.split('.')[0] == 'paint']
    bm = bmesh.new()
    bm.from_mesh(me)
    if pi:
        pv = list({v for f in bm.faces if f.material_index in pi for v in f.verts})
        bmesh.ops.remove_doubles(bm, verts=pv, dist=0.0005)
        for _ in range(4):
            inner = [v for v in bm.verts if v.link_faces and all(f.material_index in pi for f in v.link_faces) and not v.is_boundary]
            bmesh.ops.smooth_vert(bm, verts=inner, factor=0.45, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.mode = 'FACE_AREA'
    m.weight = 50
    m.keep_sharp = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='wn')


BUDGET = {'paint': 11000, 'black': 6000, 'trim': 6000, 'chrome': 2500, 'glass': 4000, 'light_head': 1500, 'light_tail': 1500}


def per_class_decimate(id, budget=BUDGET, weld=0.0002):
    """Weld the body (Sketchfab meshes are often split at every seam, and a collapse decimate shreds them), then
    decimate each material on its own to its budget so collapses never cross from one part into another."""
    ob = bpy.data.objects[id + '_body']
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.selected_objects]
    out = {}
    for o in parts:
        if not o.data.polygons:
            continue
        base = o.material_slots[o.data.polygons[0].material_index].material.name.split('.')[0]
        n = len(o.data.polygons)
        t = budget.get(base)
        if t and n > t:
            m = o.modifiers.new('dec', 'DECIMATE')
            m.ratio = t / n
            m.use_collapse_triangulate = True
            apply_mods(o)
        out[base] = (n, len(o.data.polygons))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    ob.name = id + '_body'
    ob.data.validate(clean_customdata=False)
    return out


def export(id):
    os.makedirs(OUT, exist_ok=True)
    root = bpy.data.objects['R_' + id]
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root] + list(root.children_recursive):
        o.select_set(True)
        if o.type == 'MESH' and 'Col' in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes['Col']
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{id}.glb', export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_materials='EXPORT', export_texcoords=False, export_normals=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    return os.path.getsize(f'{OUT}/{id}.glb')


def build(id, rules=(), **kw):
    """texsplit (bake texture colours, split two-tone paint) -> prepare_car (game materials, wheels) -> weld and decimate
    per material -> smooth -> export. Returns prepare_car's report plus the per-material face counts and the GLB size."""
    rules = list(rules)
    try:
        save_raw(id)
    except Exception as e:
        print('raw not saved:', e)
    split = kw.pop('split', ('paint', 'trim', 'chrome'))   # (drop 'paint' when a livery would be split into chrome/black)
    stats = texsplit(rules, split=split)
    budget = kw.pop('budget', BUDGET)
    rep = prepare_car(id, SPLIT_RULES + rules, target_faces=10 ** 7, **kw)   # (the body is decimated per material below)
    rep['classes'] = per_class_decimate(id, budget)
    rep['body_faces'] = len(bpy.data.objects[id + '_body'].data.polygons)
    smooth(id)
    rep['split'] = {f'{a}->{b}': n for (a, b), n in stats.items()}
    rep['glb'] = export(id)
    return rep


def report(rules=(), n=24):
    """What just came in: overall size, and the biggest materials with the class each would get."""
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c) for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box]
    if pts:
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        print('dims', [round(hi[i] - lo[i], 2) for i in range(3)], 'zmin', round(lo[2], 3))
    cnt = material_report()
    for name, c in sorted(cnt.items(), key=lambda x: -x[1])[:n]:
        print(c, name, '->', classify(name, list(rules)))
