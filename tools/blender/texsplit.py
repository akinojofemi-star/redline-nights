# Run after carlib.py + sfab.py (needs classify). Texture-aware pre-pass for prepare_car, so the game model keeps what
# the Sketchfab textures painted on:
#  * every face gets its texture colour as a face-corner colour attribute 'Col' (exported as COLOR_0; the game shows it on
#    trim/chrome/black parts, never on the paint, which the player recolours)
#  * body faces whose texture is black (a two-tone roof/rear, painted-black trim) move to a material that classifies as
#    'black' (gloss black), and silver-grey ones (chrome strips painted into an atlas) to 'chrome'
import bpy, numpy as np, colorsys

def _img(m):
    """How the material's Base Color is made, as (image or None, vertex colour layer or None, constant factor), or
    (None, None) when it can't be read simply. Handles a texture or vertex colour wired straight in, and the glTF
    importer's multiply of texture x vertex colour x constant."""
    if not m or not m.node_tree:
        return None, None
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return None, None
    bc = bsdf.inputs['Base Color']
    if not bc.is_linked:
        return None, (None, np.array(bc.default_value[:3]))
    n = bc.links[0].from_node
    while n.type == 'REROUTE' and n.inputs[0].links:
        n = n.inputs[0].links[0].from_node
    def leaf(node):
        if node.type == 'TEX_IMAGE' and node.image:
            return ('img', node.image)
        if node.type in ('VERTEX_COLOR', 'ATTRIBUTE'):
            return ('vc', getattr(node, 'layer_name', '') or getattr(node, 'attribute_name', ''))
        return None
    l = leaf(n)
    if l:
        return (l[1], (None, np.ones(3))) if l[0] == 'img' else (None, (l[1] or '*', np.ones(3)))
    if n.type == 'MIX' and n.blend_type == 'MULTIPLY' and n.data_type == 'RGBA':
        img, vc, fac = None, None, np.ones(3)
        for inp in [x for x in n.inputs if x.enabled and x.type == 'RGBA']:
            if inp.links:
                l = leaf(inp.links[0].from_node)
                if not l:
                    return None, None
                if l[0] == 'img':
                    img = l[1]
                else:
                    vc = l[1] or '*'
            else:
                fac = fac * np.array(inp.default_value[:3])
        return img, (vc, fac)
    return None, None

# the game's own trim and chrome colours (linear), for parts with no colour of their own
GAME_COL = {'trim': (0.0052, 0.0052, 0.007), 'chrome': (0.69, 0.70, 0.76)}

_cache = {}
def _px(img):
    if img.name not in _cache:
        W, H = img.size
        if W == 0:
            _cache[img.name] = None
        else:
            _cache[img.name] = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, img.channels)[:, :, :3]
    return _cache[img.name]

def _srgb2lin(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))

def _lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)

def texsplit(rules, split=('paint', 'trim', 'chrome'), black_v=0.16, chrome_v=0.55, chrome_s=0.14):
    """Bake texture colour per face and split two-tone/atlas materials. Returns counts."""
    stats = {}
    new_mats = {}
    def sub(m, kind):
        key = (m.name, kind)
        if key not in new_mats:
            nm = m.copy()
            nm.name = m.name + '__' + kind      # classify(): rules ('__black$','black'), ('__chrome$','chrome') go first
            new_mats[key] = nm
        return new_mats[key]
    from collections import defaultdict
    cand = []                                   # (object, polygon index, class, hsv) over the whole car
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        me = o.data
        src_vc = {ca.name: ca.data for ca in me.color_attributes if ca.domain == 'CORNER' and ca.name != 'Col'}
        if 'Col' not in me.color_attributes:
            me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        col = me.color_attributes['Col'].data
        uvl = me.uv_layers.active.data if me.uv_layers else None
        slots = list(o.material_slots)
        info = [(_img(s.material) if s.material else (None, None)) for s in slots]
        cls = [classify(s.material.name if s.material else 'None', rules) for s in slots]
        for p in me.polygons:
            if p.material_index >= len(slots):
                continue
            img, rec = info[p.material_index]
            c = None
            if rec is not None:
                vcn, fac = rec
                c = np.array(fac, dtype=float)
                if img is not None and uvl is not None and _px(img) is not None:
                    px = _px(img); H, W = px.shape[:2]
                    acc = np.zeros(3); n = 0
                    for li in p.loop_indices:
                        u, v = uvl[li].uv
                        acc += px[int((v % 1) * (H - 1)), int((u % 1) * (W - 1))]; n += 1
                    t = acc / max(n, 1)
                    if not img.is_float and img.colorspace_settings.name.lower().startswith('srgb'):
                        t = _srgb2lin(t)    # byte images hand back their stored sRGB values; vertex colours are linear
                    c = c * t
                if vcn is not None:
                    ca = src_vc.get(vcn) if vcn != '*' else (next(iter(src_vc.values())) if src_vc else None)
                    if ca is not None:
                        c = c * np.mean([ca[li].color[:3] for li in p.loop_indices], axis=0)
                if img is None and vcn is None and colorsys.rgb_to_hsv(*_lin2srgb(c))[1] <= 0.35:
                    # a plain grey or white base with no texture is usually a tint for a texture this model doesn't
                    # have: the part gets the game's colour; a real flat colour (red calipers) is kept
                    c = None
            own = c is not None
            k = cls[p.material_index]
            if not own:                 # no colour of its own: bake the game's colour for its class
                c = np.array(GAME_COL[k]) if k in GAME_COL else np.ones(3)
            for li in p.loop_indices:
                col[li].color = (c[0], c[1], c[2], 1.0)
            if k in split and img is not None and own:
                cand.append((o, p.index, k, slots[p.material_index].material.name, colorsys.rgb_to_hsv(*_lin2srgb(c))))
    # share of dark and of silver faces in each material across the whole car: a minority is a second tone or a strip;
    # most of the material is just its own colour (a light grey paint or a silver trim sheet stays as it is)
    sh = defaultdict(lambda: [0, 0, 0])
    for o, pi, k, mn, (h, s_, v) in cand:
        e = sh[mn]; e[0] += 1; e[1] += v < black_v; e[2] += v > chrome_v and s_ < chrome_s
    for o, pi, k, mn, (h, s_, v) in cand:
        n, nd, nc = sh[mn]
        shiny = v > chrome_v and s_ < chrome_s and nc / n < 0.45
        dark = v < black_v and nd / n < 0.6
        kind = (('black' if dark else 'chrome' if shiny else None) if k == 'paint' else
                ('chrome' if shiny else None) if k == 'trim' else ('trim' if dark else None))
        if not kind:
            continue
        stats[(k, kind)] = stats.get((k, kind), 0) + 1
        me = o.data; p = me.polygons[pi]
        m = sub(o.material_slots[p.material_index].material, kind)
        names = [x.name if x else '' for x in me.materials]
        if m.name not in names:
            me.materials.append(m); names.append(m.name)
        p.material_index = names.index(m.name)
    return stats

SPLIT_RULES = [(r'__black$', 'black'), (r'__chrome$', 'chrome'), (r'__trim$', 'trim')]
