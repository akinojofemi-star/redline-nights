# Turn a finished model round when prepare_car's nose='auto' picked the wrong end (the car then drives tail first):
# rotate every mesh 180 degrees about the vertical axis (x and z negated in positions and normals), move the wheels
# with it and swap their names front<->rear, and swap the head and tail light materials (they were assigned by end).
# Rotating the geometry rather than adding a root rotation keeps the wheels spinning the right way.
#   python3 ../tools/blender/turnaround.py models/valhalla.json ...   (from app/)
# For a rebuild in Blender instead, pass prepare_car(..., nose='-y') or nose='+y'.
import json, base64, struct, sys, re

SWAP = {'FL': 'RR', 'FR': 'RL', 'RL': 'FR', 'RR': 'FL'}

for path in sys.argv[1:]:
    js = json.load(open(path))
    head, b64 = js['buffers'][0]['uri'].split(',', 1)
    buf = bytearray(base64.b64decode(b64))
    done = set()
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            for att in ('POSITION', 'NORMAL'):
                ai = pr['attributes'].get(att)
                if ai is None or ai in done:
                    continue
                done.add(ai)
                a = js['accessors'][ai]
                assert a['componentType'] == 5126 and a['type'] == 'VEC3'
                bv = js['bufferViews'][a['bufferView']]
                stride = bv.get('byteStride', 12)
                base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
                for i in range(a['count']):
                    o = base + i * stride
                    x, y, z = struct.unpack_from('<3f', buf, o)
                    struct.pack_into('<3f', buf, o, -x, y, -z)
                if 'min' in a:
                    lo, hi = a['min'], a['max']
                    a['min'], a['max'] = [-hi[0], lo[1], -hi[2]], [-lo[0], hi[1], -lo[2]]
    for n in js['nodes']:
        m = re.search(r'_wheel_(FL|FR|RL|RR)$', n['name'])
        if m:
            n['name'] = n['name'][:m.start(1)] + SWAP[m.group(1)]
        if 'translation' in n:
            t = n['translation']
            n['translation'] = [-t[0], t[1], -t[2]]
    for mt in js.get('materials', []):
        b = mt.get('name', '')
        if b.startswith('light_head'):
            mt['name'] = 'light_tail' + b[len('light_head'):]
        elif b.startswith('light_tail'):
            mt['name'] = 'light_head' + b[len('light_tail'):]
    js['buffers'][0]['uri'] = head + ',' + base64.b64encode(bytes(buf)).decode()
    open(path, 'w').write(json.dumps(js, separators=(',', ':')))
    print(path, 'turned round')
