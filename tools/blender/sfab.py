# Sketchfab car -> Redline Nights game model. Run after carlib.py (uses mat(), apply_mods, export_glb).
# prepare_car(id, rules) takes whatever the Sketchfab import left in the scene and turns it into:
#   <id>_body            one decimated mesh, materials renamed to the game's set (paint, glass, trim, chrome, light_head, light_tail)
#   <id>_wheel_FL/FR/RL/RR  tyre + rim meshes with their origin on the hub, so the game can spin them
# all parented to R_<id>, nose toward -Y, wheels on z=0, centred on the wheelbase midpoint in x/y.
import bpy, bmesh, math, re
from mathutils import Vector, Matrix

DEFAULT_RULES = [
    # (regex on material name, game material or 'delete'); first match wins
    (r'interior|seat|steer|dash|pedal|engine|cockpit|belt|carpet|gauge|mirror_?glass|plate|licen', 'delete'),
    (r'red_?glass|taill|tail_?light|brake_?light|rear_?light', 'light_tail'),
    (r'wheel|(?<![a-z])rim|^rim|tyre|tire|lug|hub', 'wheel'),
    (r'callip|caliper|brake|disc|rotor', 'trim'),
    (r'light|lamp|headl|(?<![a-z])led(?![a-z])|drl', 'light'),
    (r'window|glass|windscreen|windshield', 'glass'),
    (r'chrome|exhaust|badge|logo|emblem', 'chrome'),
    (r'paint|colou?r|body|carpaint|exterior', 'paint'),
]

def classify(name, rules):
    n = name.lower()
    for pat, tgt in rules + DEFAULT_RULES:
        if re.search(pat, n):
            return tgt
    return 'trim'

def material_report():
    from collections import Counter
    cnt = Counter()
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        for p in o.data.polygons:
            m = o.material_slots[p.material_index].material if o.material_slots else None
            cnt[m.name if m else 'None'] += 1
    return cnt

def join_all(name):
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and not any(s.material for s in o.material_slots)]:
        bpy.data.objects.remove(o, do_unlink=True)   # stray helper geometry with no material
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.hide_viewport = False
        o.hide_select = False
        o.hide_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # bake parent transforms (Sketchfab files nest objects under scaled/rotated empties)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name + '_body'
    for o in list(bpy.data.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    return ob

def faces_by_class(ob, rules):
    cls = [classify(s.material.name if s.material else 'None', rules) for s in ob.material_slots]
    return cls

TYRE_FRAC = 0.74   # tyre = faces further than this fraction of the wheel radius from the hub

def prepare_car(name, rules=(), nose='auto', target_faces=22000, wheel_faces=1400, flip_x=False, grab_rims=False, strip_under_paint=0.0):
    rules = list(rules)
    ob = join_all(name)
    me = ob.data
    cls = faces_by_class(ob, rules)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    # drop interior etc.
    dead = [f for f in bm.faces if cls[f.material_index] == 'delete']
    if strip_under_paint:
        # trim/chrome panels lying just under the paint (inner skins, door shuts) z-fight once decimated: drop them
        from mathutils.bvhtree import BVHTree
        pf = [f for f in bm.faces if cls[f.material_index] == 'paint']
        tree = BVHTree.FromPolygons([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in pf])
        nrm = [f.normal.copy() for f in pf]
        for f in bm.faces:
            if cls[f.material_index] in ('trim', 'chrome'):
                loc, n, idx, d = tree.find_nearest(f.calc_center_median())
                if loc is not None and d < strip_under_paint and abs(f.normal.dot(nrm[idx])) > 0.8:
                    dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    # orientation: put the ground at z=0, then find the nose
    zs = [v.co.z for v in me.vertices]
    z0 = min(zs)
    for v in me.vertices:
        v.co.z -= z0
    wheel_idx = [i for i, c in enumerate(cls) if c == 'wheel']
    wpts = [Vector(me.vertices[vi].co) for p in me.polygons if p.material_index in wheel_idx for vi in p.vertices]
    if not wpts:
        raise RuntimeError('no wheel faces found; adjust rules')
    # long axis must be Y
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    if max(xs) - min(xs) > max(ys) - min(ys):
        me.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
        wpts = [Matrix.Rotation(math.pi / 2, 3, 'Z') @ p for p in wpts]
    # cluster wheel points into 4 by sign of (x - cx), (y - cy)
    cx = sum(p.x for p in wpts) / len(wpts)
    cy = sum(p.y for p in wpts) / len(wpts)
    quads = {}
    for p in wpts:
        quads.setdefault((p.x > cx, p.y > cy), []).append(p)
    centres = {}
    for k, pts in quads.items():
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        centres[k] = ((lo + hi) / 2, (hi.z - lo.z) / 2, hi.x - lo.x)
    # nose: the end farther from its axle (front overhang) is usually... ambiguous, so use the light classes:
    # head lights at the nose. Fallback: shorter overhang = rear for mid/rear-engine is unreliable, so require lights.
    head = [Vector(me.vertices[vi].co) for p in me.polygons if cls[p.material_index] == 'light' for vi in p.vertices]
    ymin, ymax = min(v.co.y for v in me.vertices), max(v.co.y for v in me.vertices)
    if nose == 'auto':
        # tail lights are classed separately when named; otherwise light faces near each end decide
        tail = [Vector(me.vertices[vi].co) for p in me.polygons if cls[p.material_index] == 'light_tail' for vi in p.vertices]
        if tail:
            nose_neg = sum(p.y for p in tail) / len(tail) > (ymin + ymax) / 2
        else:
            # headlights sit lower and further out; compare light area near each end
            nf = sum(1 for p in head if p.y < ymin + 0.6)
            nr = sum(1 for p in head if p.y > ymax - 0.6)
            nose_neg = nf >= nr
    else:
        nose_neg = nose == '-y'
    if not nose_neg:
        me.transform(Matrix.Rotation(math.pi, 4, 'Z'))
        centres = {(not k[0], not k[1]): (Matrix.Rotation(math.pi, 3, 'Z') @ c, r, w) for k, (c, r, w) in centres.items()}
    if flip_x:
        me.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
        me.flip_normals()
    # centre on the wheels
    cxy = sum((c for c, r, w in centres.values()), Vector()) / 4
    me.transform(Matrix.Translation(Vector((-cxy.x, -cxy.y, 0))))
    centres = {k: (c - Vector((cxy.x, cxy.y, 0)), r, w) for k, (c, r, w) in centres.items()}
    # lights: split into head (front half) / tail (rear half)
    names = {}
    def slot(mname):
        if mname not in names:
            ob.data.materials.append(mat(mname))
            names[mname] = len(ob.data.materials) - 1
        return names[mname]
    for poly in me.polygons:
        c = cls[poly.material_index]
        if c == 'light':
            c = 'light_head' if poly.center.y < 0 else 'light_tail'
        if c == 'wheel':
            c = 'wheelpart'
        poly.material_index = slot(c if c != 'wheelpart' else 'rim')
    if grab_rims:
        # rims that share a material with body chrome: claim anything inside each tyre's cylinder
        rs = slot('rim')
        for poly in me.polygons:
            pc = poly.center
            for c, r, w in centres.values():
                if abs(pc.x - c.x) < w / 2 + 0.02 and math.hypot(pc.y - c.y, pc.z - c.z) < r * 0.97:
                    poly.material_index = rs
                    break
    # separate wheel faces into 4 objects
    wheel_slot = names.get('rim')
    tag = {(True, True): 'RL', (False, True): 'RR', (True, False): 'FL', (False, False): 'FR'}  # +x = car's left, -y = front
    bm = bmesh.new()
    bm.from_mesh(me)
    wobs = []
    for key, (c, r, w) in centres.items():
        sel = [f for f in bm.faces if f.material_index == wheel_slot and (f.calc_center_median().x > 0) == (c.x > 0) and (f.calc_center_median().y > 0) == (c.y > 0)]
        if not sel:
            continue
        nb = bmesh.new()
        vmap = {}
        for f in sel:
            vs = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = nb.verts.new(v.co - c)
                vs.append(vmap[v])
            try:
                nf = nb.faces.new(vs)
                nf.smooth = f.smooth
                # tyre = outer band of the wheel
                fc = f.calc_center_median() - c
                nf.material_index = 0 if math.hypot(fc.y, fc.z) > r * TYRE_FRAC else 1
            except ValueError:
                pass
        wme = bpy.data.meshes.new(name + '_wheel_' + tag[(c.x > 0, c.y > 0)])
        nb.to_mesh(wme)
        nb.free()
        wme.materials.append(mat('tyre'))
        wme.materials.append(mat('rim'))
        wo = bpy.data.objects.new(wme.name, wme)
        bpy.context.scene.collection.objects.link(wo)
        wo.location = c
        wobs.append(wo)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == wheel_slot], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    # decimate
    def decimate(o, target, protect=()):
        n = len(o.data.polygons)
        if n > target:
            m = o.modifiers.new('dec', 'DECIMATE')
            if protect:
                # glass and light shells are thin and fall apart when collapsed: keep them as they are
                mats = [x.name if x else '' for x in o.data.materials]
                keep = {vi for p in o.data.polygons if mats[p.material_index] in protect for vi in p.vertices}
                vg = o.vertex_groups.new(name='keep')
                vg.add(list(keep), 1.0, 'REPLACE')
                m.vertex_group = 'keep'
                m.invert_vertex_group = True
                kept = sum(1 for p in o.data.polygons if mats[p.material_index] in protect)
                target = max(target - kept, target // 3)
                n = n - kept
            m.ratio = min(1.0, target / max(n, 1))
            m.use_collapse_triangulate = True
            apply_mods(o)
            for g in list(o.vertex_groups):
                o.vertex_groups.remove(g)
    decimate(ob, target_faces, ('glass',))
    for wo in wobs:
        decimate(wo, wheel_faces)
    for o in [ob] + wobs:
        for p in o.data.polygons:
            p.use_smooth = True
        try:
            o.data.set_sharp_from_angle(angle=math.radians(50))
        except Exception:
            pass
    # drop material slots nothing uses any more
    for o in [ob] + wobs:
        mats = list(o.data.materials)
        per_face = [mats[p.material_index] for p in o.data.polygons]
        keep = []
        for m in per_face:
            if m not in keep:
                keep.append(m)
        o.data.materials.clear()
        for m in keep:
            o.data.materials.append(m)
        for p, m in zip(o.data.polygons, per_face):
            p.material_index = keep.index(m)
    # collection + root
    coll = collection('car_' + name)
    root = bpy.data.objects.new('R_' + name, None)
    coll.objects.link(root)
    for o in [ob] + wobs:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
        o.parent = root
    # remove now-unused imported materials/images to keep things light
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)
    dims = ob.dimensions
    return dict(body_faces=len(ob.data.polygons), wheels={o.name: (tuple(round(v, 3) for v in o.location), len(o.data.polygons)) for o in wobs},
                dims=tuple(round(v, 3) for v in dims), slots=[m.name for m in ob.data.materials])

RAW_DIR = '/private/tmp/claude-501/-Applications/12184fb6-ed69-457e-b6e8-d4b8a9997bda/scratchpad/raw/'

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(blk):
            if x.users == 0:
                blk.remove(x)

def save_raw(name):
    """Keep the untouched Sketchfab import so the pipeline can be re-run without downloading again."""
    bpy.data.libraries.write(RAW_DIR + name + '.blend', set(o for o in bpy.data.objects), fake_user=True)

def load_raw(name):
    clear_scene()
    with bpy.data.libraries.load(RAW_DIR + name + '.blend', link=False) as (src, dst):
        dst.objects = src.objects
    for o in dst.objects:
        if o is not None:
            bpy.context.scene.collection.objects.link(o)
    return len(dst.objects)
