#!/usr/bin/env python3
"""
Tiny static dev server for the Glass Railing Designer.

Adds two dev conveniences over `python3 -m http.server`:
  • `Cache-Control: no-store` so edits show up on a plain reload.
  • Correct MIME types for ES modules (.js) and the web app manifest.

Usage:  python3 devserver.py [port]
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else '.'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def guess_type(self, path):
        p = str(path)
        if p.endswith('.webmanifest'):
            return 'application/manifest+json'
        if p.endswith('.js') or p.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'Glass Designer dev server: http://127.0.0.1:{PORT}  (serving {DIRECTORY})')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
