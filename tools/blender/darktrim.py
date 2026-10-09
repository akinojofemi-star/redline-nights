# Darken the baked trim colours of models whose source textures put light grey on parts that are black or carbon on
# the real car (lower sills, diffusers, carbon roofs). The trim's mean colour is scaled down to TARGET, keeping the
# detail inside it. Only trim brighter than LIMIT on average is touched (most cars sit at 0.5-5%).
#   python3 ../tools/blender/darktrim.py models/mc20.json models/f296.json ...   (from app/)
import json, base64, struct, sys

LIMIT, TARGET = .15, .035
CT = {5121: ('B', 255), 5123: ('H', 65535), 5126: ('f', 1)}

for path in sys.argv[1:]:
    js = json.load(open(path))
    head, b64 = js['buffers'][0]['uri'].split(',', 1)
    buf = bytearray(base64.b64decode(b64))
    mats = [m.get('name', '') for m in js.get('materials', [])]
    done = set()
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            if 'COLOR_0' not in pr['attributes'] or not mats[pr.get('material', 0)].split('.')[0] == 'trim':
                continue
            ai = pr['attributes']['COLOR_0']
            if ai in done:
                continue
            done.add(ai)
            a = js['accessors'][ai]
            bv = js['bufferViews'][a['bufferView']]
            fmt, mx = CT[a['componentType']]
            n = {'VEC3': 3, 'VEC4': 4}[a['type']]
            sz = struct.calcsize(fmt)
            stride = bv.get('byteStride', sz * n)
            base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            offs = [base + i * stride for i in range(a['count'])]
            rgb = [struct.unpack_from('<3' + fmt, buf, o) for o in offs]
            mean = sum(sum(c) for c in rgb) / (3 * len(rgb) * mx)
            if mean <= LIMIT:
                print(path, 'trim mean %.3f, left as is' % mean)
                continue
            k = TARGET / mean
            for o, c in zip(offs, rgb):
                v = [min(mx, x * k) for x in c]
                struct.pack_into('<3' + fmt, buf, o, *([int(round(x)) for x in v] if fmt != 'f' else v))
            print(path, 'trim mean %.3f -> %.3f' % (mean, TARGET))
    js['buffers'][0]['uri'] = head + ',' + base64.b64encode(bytes(buf)).decode()
    open(path, 'w').write(json.dumps(js, separators=(',', ':')))
