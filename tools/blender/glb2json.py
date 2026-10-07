import json, struct, base64, glob, os, re, sys
for p in sorted(glob.glob((sys.argv[1] if len(sys.argv)>1 else 'glb2')+'/*.glb')):
    b=open(p,'rb').read(); off=12; js=bin_=None
    while off<len(b):
        ln,typ=struct.unpack('<I4s',b[off:off+8]); chunk=b[off+8:off+8+ln]; off+=8+ln
        if typ==b'JSON': js=json.loads(chunk)
        elif typ==b'BIN\x00': bin_=chunk
    js['buffers'][0]['uri']='data:application/octet-stream;base64,'+base64.b64encode(bin_).decode()
    k=os.path.basename(p)[:-4]
    open('models/'+k+'.json','w').write(json.dumps(js,separators=(',',':')))
    print(k, os.path.getsize('models/'+k+'.json')//1024,'KB', sum(1 for n in js['nodes'] if re.search(r'_wheel_(FL|FR|RL|RR)$',n['name'])),'wheels')
