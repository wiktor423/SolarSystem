import http.server
import socketserver

PORT = 8000

class SecureHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # These two headers are strictly required to unlock SharedArrayBuffer
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

# Start the server
with socketserver.TCPServer(("", PORT), SecureHandler) as httpd:
    print(f"Server running on http://localhost:{PORT}")
    httpd.serve_forever()
