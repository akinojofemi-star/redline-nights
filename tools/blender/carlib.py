# Car body builder for Redline Nights, run inside Blender via exec(open(path).read()).
# Car faces -Y (so glTF export, +Y up, puts the nose on +Z); +X is the car's left. Units: metres.
import bpy, bmesh, math
from mathutils import Vector

MATS = {
    'paint':      ((0.80, 0.30, 0.05, 1), 0.5, 0.30, None),
    'glass':      ((0.02, 0.025, 0.035, 1), 0.2, 0.05, None),
    'trim':       ((0.02, 0.02, 0.025, 1), 0.3, 0.50, None),
    'chrome':     ((0.85, 0.85, 0.88, 1), 1.0, 0.15, None),
    'light_head': ((0.95, 0.97, 1.0, 1), 0.0, 0.20, (0.9, 0.95, 1.0, 1)),
    'light_tail': ((0.90, 0.05, 0.08, 1), 0.0, 0.30, (1.0, 0.05, 0.08, 1)),
    'tyre':       ((0.03, 0.03, 0.035, 1), 0.0, 0.85, None),
    'rim':        ((0.75, 0.76, 0.80, 1), 0.9, 0.25, None),
}

def mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    col, met, rough, em = MATS[name]
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Metallic'].default_value = met
    bsdf.inputs['Roughness'].default_value = rough
    if em:
        (bsdf.inputs.get('Emission Color') or bsdf.inputs.get('Emission')).default_value = em
        bsdf.inputs['Emission Strength'].default_value = 2.0
    m.diffuse_color = col
    return m

def clear_car(name):
    for o in list(bpy.data.objects):
        if o.name.startswith(name + '_') or o.name == name:
            bpy.data.objects.remove(o, do_unlink=True)

def link(obj, coll):
    coll.objects.link(obj)

def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

KEYS = ('z0', 'w', 'zs', 'wb', 'zb', 'wr', 'zr')

def interp(stations, s):
    """Linear interpolation of the section parameters at distance s from the nose."""
    if s <= stations[0]['s']:
        return dict(stations[0])
    for a, b in zip(stations, stations[1:]):
        if a['s'] <= s <= b['s']:
            t = (s - a['s']) / max(b['s'] - a['s'], 1e-6)
            t = t * t * (3 - 2 * t)  # ease between key stations
            d = {k: a[k] + (b[k] - a[k]) * t for k in KEYS}
            d['s'] = s
            return d
    return dict(stations[-1])

def section(p):
    """Half section from bottom centre, out and up the side, over the fender/roof edge, to top centre."""
    return [
        (0.0, p['z0']),
        (p['w'] * 0.84, p['z0']),
        (p['w'] * 0.97, p['z0'] + 0.07),
        (p['w'], p['zs']),
        (p['wb'], p['zb']),
        (p['wr'], p['zr'] - 0.025),
        (p['wr'] * 0.5, p['zr'] - 0.006),
        (0.0, p['zr']),
    ]

def build_body(name, spec, coll, n_st=96, subdiv=2):
    L = spec['len']
    st = sorted(spec['stations'], key=lambda d: d['s'])
    bm = bmesh.new()
    rings = []
    for i in range(n_st + 1):
        s = L * i / n_st
        p = interp(st, s)
        half = section(p)
        y = s - L / 2
        right = [(x, z) for x, z in half]                      # bottom-centre ... top-centre
        left = [(-x, z) for x, z in reversed(half[1:-1])]       # mirrored, skipping the centre points
        ring = [bm.verts.new((x, y, z)) for x, z in right + left]
        rings.append(ring)
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name + '_body')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name + '_body', me)
    link(ob, coll)
    for poly in me.polygons:
        poly.use_smooth = True
    mod = ob.modifiers.new('sub', 'SUBSURF')
    mod.levels = subdiv
    mod.render_levels = subdiv
    apply_mods(ob)
    return ob

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)

def cut_arches(ob, spec):
    L = spec['len']
    for s_ax, r in ((spec['axleF'], spec['wrF']), (spec['axleR'], spec['wrR'])):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r + 0.06, depth=4.0,
                                            location=(0, s_ax - L / 2, r), rotation=(0, math.pi / 2, 0))
        cyl = bpy.context.active_object
        mod = ob.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cyl
        mod.solver = 'EXACT'
        apply_mods(ob)
        bpy.data.objects.remove(cyl, do_unlink=True)
    # the cutter leaves an empty material slot on the new wheel-well faces: make them black
    for i, m in enumerate(ob.data.materials):
        if m is None:
            ob.data.materials[i] = mat('trim')

def assign(ob, matname, test):
    """Paint faces whose centre/normal pass test(c, n, s) with a material (s = distance from nose)."""
    me = ob.data
    names = [m.name if m else '' for m in me.materials]
    if matname not in names:
        me.materials.append(mat(matname))
        names.append(matname)
    idx = names.index(matname)
    L = ob['len']
    for poly in me.polygons:
        c = poly.center
        if test(c, poly.normal, c.y + L / 2):
            poly.material_index = idx

def glass_regions(ob, spec):
    st = sorted(spec['stations'], key=lambda d: d['s'])
    g = spec['glass']  # cowl, roof front, roof rear, rear glass end, side start, side end

    def side(c, n, s):
        if not (g['side0'] <= s <= g['side1']) or abs(n.x) < 0.3:
            return False
        p = interp(st, s)
        return p['zb'] + 0.035 < c.z < p['zr'] - 0.05

    def screen(c, n, s):
        return g['cowl'] + 0.05 <= s <= g['roofF'] - 0.04 and n.z > 0.15 and n.y < -0.2 and abs(c.x) < interp(st, s)['wr'] * 0.98

    def rear(c, n, s):
        return g['roofR'] + 0.04 <= s <= g['rearEnd'] and n.z > 0.15 and n.y > 0.15 and abs(c.x) < interp(st, s)['wr'] * 0.95

    assign(ob, 'glass', lambda c, n, s: side(c, n, s) or screen(c, n, s) or rear(c, n, s))

def box(name, coll, size, loc, matname, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    for c in ob.users_collection:
        c.objects.unlink(ob)
    link(ob, coll)
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = ob.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 2
        apply_mods(ob)
    ob.data.materials.append(mat(matname))
    return ob

def cyl(name, coll, r, depth, loc, matname, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    for c in ob.users_collection:
        c.objects.unlink(ob)
    link(ob, coll)
    ob.name = name
    ob.data.materials.append(mat(matname))
    return ob

def wheel(name, coll, r, width, loc, spokes=5, side=1):
    """Tyre + spoked rim, origin at the hub, as one object (named wheel_* so the game can spin it)."""
    bm = bmesh.new()
    # tyre: tube with rounded shoulders
    seg = 36
    prof = [(r * 0.70, -width / 2), (r * 0.93, -width / 2), (r, -width / 2 + 0.04), (r, width / 2 - 0.04), (r * 0.93, width / 2), (r * 0.70, width / 2)]
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        rings.append([bm.verts.new((x, math.cos(a) * rr, math.sin(a) * rr)) for rr, x in prof])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for k in range(len(prof) - 1):
            bm.faces.new((A[k], A[k + 1], B[k + 1], B[k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    me.materials.append(mat('tyre'))
    me.materials.append(mat('rim'))
    for poly in me.polygons:
        poly.use_smooth = True
    # rim: dished disc + spokes, slightly inset from the outer face
    face_x = side * (width / 2 - 0.03)
    parts = []
    d = cyl(name + '_rimdisc', coll, r * 0.70, 0.04, (face_x - side * 0.03, 0, 0), 'rim', rot=(0, math.pi / 2, 0), verts=32)
    parts.append(d)
    hub = cyl(name + '_hub', coll, r * 0.16, 0.06, (face_x, 0, 0), 'rim', rot=(0, math.pi / 2, 0), verts=16)
    parts.append(hub)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        for off in (-0.13, 0.13):
            aa = a + off * 0.5
            sp = box(name + '_sp', coll, (0.03, 0.045, r * 0.56), (face_x, math.cos(aa) * r * 0.40, math.sin(aa) * r * 0.40), 'rim', rot=(-aa + math.pi / 2, 0, 0))
            parts.append(sp)
    # tyre inner wall + dark barrel so you can't see through
    barrel = cyl(name + '_barrel', coll, r * 0.70, width * 0.9, (0, 0, 0), 'trim', rot=(0, math.pi / 2, 0), verts=24)
    parts.append(barrel)
    join(ob, parts)
    ob.location = loc
    return ob

def join(target, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target

def build_car(name, spec):
    clear_car(name)
    coll = collection('car_' + name)
    body = build_body(name, spec, coll)
    body['len'] = spec['len']
    body.data.materials.append(mat('paint'))
    cut_arches(body, spec)
    glass_regions(body, spec)
    for matname, test in spec.get('regions', []):
        assign(body, matname, test)
    L = spec['len']
    tw = spec['track'] / 2
    for tag, s_ax, r in (('FL', spec['axleF'], spec['wrF']), ('FR', spec['axleF'], spec['wrF']), ('RL', spec['axleR'], spec['wrR']), ('RR', spec['axleR'], spec['wrR'])):
        side = 1 if tag[1] == 'L' else -1
        wheel(name + '_wheel_' + tag, coll, r, spec.get('tyreW', 0.27), (side * tw, s_ax - L / 2, r), spokes=spec.get('spokes', 5), side=side)
    # spec shorthand: decals (tag, w, h, x, s, z, normal, mat, opts), boxes, exhaust pipes, door mirrors
    for d in spec.get('decals', []):
        tag, w, h, x, s, z, nrm, m = d[:8]
        o = d[8] if len(d) > 8 else {}
        for xx in ((x, -x) if x != 0 else (0,)):
            n = list(nrm)
            if xx < 0:
                n[0] = -n[0]
            decal(name + '_' + tag, coll, body, w, h, (xx, s - L / 2, z), n, m, round_=o.get('r', 0.5),
                  ref=o.get('ref', (0, 0, 1)), offset=o.get('off', 0.006), res=o.get('res', 10))
    for b in spec.get('boxes', []):
        tag, size, x, s, z, m = b[:6]
        rx = b[6] if len(b) > 6 else 0
        for xx in ((x, -x) if x != 0 else (0,)):
            box(name + '_' + tag, coll, size, (xx, s - L / 2, z), m, rot=(math.radians(rx), 0, 0), bevel=0.01)
    for x, z, r in spec.get('pipes', []):
        cyl(name + '_exhaust', coll, r, 0.16, (x, L / 2 + 0.02, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=20)
    if 'mirror' in spec:
        ms, mz, mx = spec['mirror']
        for sx in (-1, 1):
            mo = cyl(name + '_mirror', coll, 0.075, 0.17, (sx * mx, ms - L / 2, mz), 'paint', rot=(0, math.pi / 2, 0), verts=16)
            mo.scale = (1.0, 1.0, 0.72)
    for fn in spec.get('extras', []):
        fn(name, coll, spec)
    return coll

def export_glb(name, path):
    coll = bpy.data.collections['car_' + name]
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_materials='EXPORT', export_texcoords=False,
                              export_normals=True)

def decal(name, coll, body, w, h, center, normal, matname, round_=0.6, ref=(0, 0, 1), offset=0.006, res=10, limit=0.9):
    """Rounded-rectangle patch wrapped onto the body surface. normal = outward direction of the patch;
    ref = which world direction the patch's height axis should point along."""
    from mathutils import Matrix
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=1.0)
    for v in bm.verts:
        x, y = v.co.x, v.co.y          # -1..1
        k = round_
        v.co.x = x * (1 - k + k * math.sqrt(max(0.0, 1 - y * y / 2))) * w / 2
        v.co.y = y * (1 - k + k * math.sqrt(max(0.0, 1 - x * x / 2))) * h / 2
        v.co.z = 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    Z = Vector(normal).normalized()
    Y = Vector(ref) - Z * Vector(ref).dot(Z)
    Y.normalize()
    X = Y.cross(Z)
    M = Matrix((X, Y, Z)).transposed().to_4x4()
    M.translation = Vector(center) + Z * 0.45
    ob.matrix_world = M
    sw = ob.modifiers.new('wrap', 'SHRINKWRAP')
    sw.target = body
    sw.wrap_method = 'PROJECT'
    sw.use_project_z = True
    sw.use_negative_direction = True
    sw.use_positive_direction = False
    sw.project_limit = limit
    sw.offset = offset
    apply_mods(ob)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    ob.data.materials.append(mat(matname))
    return ob
