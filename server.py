import http.server
import socketserver

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    # Guarantee the correct MIME type for .wasm regardless of the host OS
    # mimetypes database; wrong type disables WebAssembly streaming compilation.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.wasm': 'application/wasm',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
    }

    def end_headers(self):
        # Required for SharedArrayBuffer and WASM pthreads
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        # Dev server: never serve stale artifacts after a WASM rebuild
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with Server(("", PORT), Handler) as httpd:
    print(f"Serving with COOP/COEP headers at http://localhost:{PORT}")
    httpd.serve_forever()
