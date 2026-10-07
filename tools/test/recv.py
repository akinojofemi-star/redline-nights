import http.server, base64, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*'); self.end_headers()
    def do_POST(self):
        n=int(self.headers['Content-Length']); d=self.rfile.read(n).decode()
        name=self.path.strip('/') or 'shot'
        open(name+'.jpg','wb').write(base64.b64decode(d.split(',',1)[1]))
        self.send_response(200); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1',8791),H).serve_forever()
