"""
Receives the Corner Shop's fixtures for baking: the app (in development) posts each place to
/<place>, and it's written to <out dir>/<place>.json for corner_shop_bake.py.

  python3 scripts/blender/corner_shop_bake_server.py <out dir> [port]

Then, from the debugger: cornerShop.bakeOut('http://localhost:8765')
"""

import http.server
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'output/corner-shop-bake'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
os.makedirs(OUT, exist_ok=True)


class Take(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        place = os.path.basename(self.path.strip('/')) or 'place'
        body = self.rfile.read(int(self.headers['Content-Length']))
        with open(os.path.join(OUT, f'{place}.json'), 'wb') as f:
            f.write(body)
        print(f'{place}: {len(body)} bytes', flush=True)
        self.send_response(200)
        self.end_headers()


http.server.HTTPServer(('127.0.0.1', PORT), Take).serve_forever()
