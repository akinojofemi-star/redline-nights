# Shrink finished models for download: weld duplicate vertices, store them compactly (glTF KHR_mesh_quantization) and
# write binary .glb (GitHub Pages gzips it; base64 inside .json compresses about 30% worse). The .json is removed.
# Positions become 16-bit (dequantized by a child node's translation and uniform scale, under 0.1 mm off on a car),
# normals 8-bit, colours 16-bit, indices 16-bit where they fit. Data the game never shows is dropped: texture coordinates
# (the models have no textures) and, on cars, baked colours on anything but trim and chrome (see swapInModel; traffic,
# bus, train and plane show theirs). Each mesh moves to an unnamed child node, so the named nodes (wheels, T_ traffic)
# keep their pivots. Run it last: darktrim.py and turnaround.py work on the .json from newcar.py (the unshrunk .json of
# an existing car is in git history, before 2026-11-07).
#   python3 ../tools/blender/shrink.py models/c8.json ...   (from app/)
import json, base64, struct, sys, os, re

CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read(js, buf, ai):
    a = js['accessors'][ai]; bv = js['bufferViews'][a['bufferView']]
    fmt, n = CT[a['componentType']], NC[a['type']]
    sz = struct.calcsize(fmt); stride = bv.get('byteStride', sz * n)
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = [struct.unpack_from('<%d%s' % (n, fmt), buf, base + i * stride) for i in range(a['count'])]
    if a.get('normalized'):
        mx = {'b': 127, 'B': 255, 'h': 32767, 'H': 65535}[fmt]
        out = [tuple(max(-1, v / mx) for v in t) for t in out]
    return out, a

def shrink(path):
    js = json.load(open(path))
    car = any(re.search(r'_wheel_(FL|FR|RL|RR)$', n.get('name', '')) for n in js['nodes'])
    if car:   # (the game gives a car its own materials, so any textures it came with are never shown)
        for k in ('images', 'textures', 'samplers'): js.pop(k, None)
        for m in js.get('materials', []):
            for d in (m, m.get('pbrMetallicRoughness', {})):
                for k in [k for k in d if k.endswith('Texture')]: del d[k]
    tex = bool(js.get('images'))   # (textured models, the bus, keep their texture coordinates and images)
    buf = base64.b64decode(js['buffers'][0]['uri'].split(',', 1)[1])
    out = bytearray(); views = []; accs = []
    def add(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    def acc(view, ctype, typ, count, norm=False, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': ctype, 'type': typ, 'count': count}
        if norm: a['normalized'] = True
        if mn is not None: a['min'], a['max'] = mn, mx
        accs.append(a); return len(accs) - 1
    before = after = 0
    for mesh in js['meshes']:
        prims = [(p, read(js, buf, p['attributes']['POSITION'])[0]) for p in mesh['primitives']]
        pts = [q for _, ps in prims for q in ps]
        lo = [min(q[k] for q in pts) for k in range(3)]; hi = [max(q[k] for q in pts) for k in range(3)]
        c = [(lo[k] + hi[k]) / 2 for k in range(3)]; s = max(max((hi[k] - lo[k]) / 2 for k in range(3)), 1e-6)
        mesh['_q'] = (c, s)
        for p, ps in prims:
            nor = read(js, buf, p['attributes']['NORMAL'])[0] if 'NORMAL' in p['attributes'] else None
            col = None
            mat = js['materials'][p['material']]['name'].split('.')[0] if 'material' in p else ''
            if 'COLOR_0' in p['attributes'] and (mat in ('trim', 'chrome') or not car):   # (the game shows baked colour only there)
                cv, ca = read(js, buf, p['attributes']['COLOR_0'])
                col = [tuple(int(round(min(1, max(0, x)) * 65535)) for x in (t if len(t) == 4 else t + (1.0,))) for t in cv]
            uv = read(js, buf, p['attributes']['TEXCOORD_0'])[0] if tex and 'TEXCOORD_0' in p['attributes'] else None
            idx = [t[0] for t in read(js, buf, p['indices'])[0]] if 'indices' in p else list(range(len(ps)))
            before += len(ps)
            # quantize, then weld vertices that came out identical
            key_of = {}; P = []; N = []; C = []; U = []; remap = []
            for i, q in enumerate(ps):
                pq = tuple(int(round((q[k] - c[k]) / s * 32767)) for k in range(3))
                nq = tuple(int(round(max(-1, min(1, x)) * 127)) for x in nor[i]) if nor else ()
                cq = col[i] if col else ()
                uq = uv[i] if uv else ()
                key = (pq, nq, cq, uq)
                j = key_of.get(key)
                if j is None:
                    j = key_of[key] = len(P); P.append(pq); N.append(nq); C.append(cq); U.append(uq)
                remap.append(j)
            idx = [remap[i] for i in idx]
            after += len(P)
            att = {}
            pv = add(b''.join(struct.pack('<3hxx', *v) for v in P), 34962, 8)
            att['POSITION'] = acc(pv, 5122, 'VEC3', len(P), True,
                                  [min(v[k] for v in P) for k in range(3)], [max(v[k] for v in P) for k in range(3)])
            if nor:
                nv = add(b''.join(struct.pack('<3bx', *v) for v in N), 34962, 4)
                att['NORMAL'] = acc(nv, 5120, 'VEC3', len(N), True)
            if col:
                cvw = add(b''.join(struct.pack('<4H', *v) for v in C), 34962, 8)
                att['COLOR_0'] = acc(cvw, 5123, 'VEC4', len(C), True)
            if uv:
                uvw = add(b''.join(struct.pack('<2f', *v) for v in U), 34962)
                att['TEXCOORD_0'] = acc(uvw, 5126, 'VEC2', len(U))
            big = len(P) > 65535
            iv = add(b''.join(struct.pack('<I' if big else '<H', i) for i in idx), 34963)
            p['attributes'] = att
            p['indices'] = acc(iv, 5125 if big else 5123, 'SCALAR', len(idx))
    for im in js.get('images', []):
        if 'bufferView' in im:
            bv = js['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
            im['bufferView'] = add(buf[o:o + bv['byteLength']])
    # each mesh moves to an unnamed child node holding its dequantization
    for n in list(js['nodes']):
        if 'mesh' not in n: continue
        c, s = js['meshes'][n['mesh']]['_q']
        js['nodes'].append({'mesh': n.pop('mesh'), 'translation': c, 'scale': [s, s, s]})
        n.setdefault('children', []).append(len(js['nodes']) - 1)
    for m in js['meshes']: m.pop('_q')
    js['accessors'], js['bufferViews'] = accs, views
    while len(out) % 4: out.append(0)
    js['buffers'] = [{'byteLength': len(out)}]
    for k in ('extensionsUsed', 'extensionsRequired'):
        js[k] = sorted(set(js.get(k, [])) | {'KHR_mesh_quantization'})
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * (-len(jb) % 4)
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(out)) + struct.pack('<I4s', len(jb), b'JSON') + jb + struct.pack('<I4s', len(out), b'BIN\0') + bytes(out)
    dst = path[:-5] + '.glb'
    open(dst, 'wb').write(glb)
    old = os.path.getsize(path); os.remove(path)
    print('%s: %d -> %d vertices, %d -> %d KB' % (dst, before, after, old // 1024, len(glb) // 1024))

for f in sys.argv[1:]:
    shrink(f)
