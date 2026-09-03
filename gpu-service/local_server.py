"""
Local SynthID-removal server (development / proof).

Runs the same diffusion engine as the Modal service, but on THIS machine's GPU
(Apple Metal / MPS) instead of a cloud GPU. Use it to develop and verify the
invisible-removal path without a cloud account or per-image cost. It is NOT a
production server (single-threaded, runs SDXL fp32 on MPS — ~1–3 min/image).

For production, deploy synthid_service.py to Modal instead (see README.md).

Run:
    .venv/bin/python local_server.py            # serves http://127.0.0.1:8765
Then point the backend at it:
    functions/.env →  SYNTHID_SERVICE_URL=http://127.0.0.1:8765
and restart the functions dev server.

Same request/response contract as the Modal endpoint:
    POST /   { image_base64, vendor?="google", strength?, steps?, max_resolution? }
         ->  { image_base64, width, height, method }
"""

import base64
import io
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from remove_ai_watermarks.invisible_engine import InvisibleEngine

HOST = os.environ.get("SYNTHID_HOST", "127.0.0.1")
PORT = int(os.environ.get("SYNTHID_PORT", "8765"))
TOKEN = os.environ.get("SYNTHID_SERVICE_TOKEN")  # optional shared secret
DEVICE = os.environ.get("SYNTHID_DEVICE", "mps")  # mps on Apple Silicon, else cpu

# Local MPS defaults tuned for SPEED so a request reliably finishes well under the
# backend's timeout. SDXL is fine at ~50 steps, and capping the long side at 1024
# keeps MPS fast — both trade a little quality for a usable local turnaround
# (~1–1.5 min/image vs 3–5+ at 100 steps / 1536). The cloud (Modal) path uses the
# full 100 steps / 1536. Bump these env vars if you want max quality locally.
DEFAULT_STEPS = int(os.environ.get("SYNTHID_STEPS", "50"))
DEFAULT_MAX_RESOLUTION = int(os.environ.get("SYNTHID_MAX_RESOLUTION", "1024"))

print(f"Loading SDXL + canny ControlNet on {DEVICE} (first run downloads ~10GB)…", flush=True)
ENGINE = InvisibleEngine(device=DEVICE, pipeline="controlnet")
ENGINE.preload()
print(f"Ready. Listening on http://{HOST}:{PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — http.server API
        # Simple health check.
        self._send(200, {"status": "ok", "device": DEVICE})

    def do_POST(self) -> None:  # noqa: N802 — http.server API
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")

            if TOKEN and payload.get("token") != TOKEN:
                self._send(401, {"error": "Unauthorized"})
                return

            b64 = payload.get("image_base64")
            if not b64:
                self._send(400, {"error": "image_base64 is required"})
                return

            vendor = payload.get("vendor", "google")
            strength = payload.get("strength")
            steps = int(payload.get("steps", DEFAULT_STEPS))
            max_resolution = int(payload.get("max_resolution", DEFAULT_MAX_RESOLUTION))

            raw = base64.b64decode(b64)
            with tempfile.TemporaryDirectory() as d:
                in_path = os.path.join(d, "in.png")
                out_path = os.path.join(d, "out.png")
                Image.open(io.BytesIO(raw)).convert("RGB").save(in_path)

                print(f"→ removing SynthID (vendor={vendor}, steps={steps})…", flush=True)
                ENGINE.remove_watermark(
                    image_path=Path(in_path),
                    output_path=Path(out_path),
                    strength=strength,
                    num_inference_steps=steps,
                    vendor=vendor,
                    max_resolution=max_resolution,
                )
                out = Image.open(out_path).convert("RGB")
                buf = io.BytesIO()
                out.save(buf, format="PNG")
                print("✓ done", flush=True)
                self._send(200, {
                    "image_base64": base64.b64encode(buf.getvalue()).decode(),
                    "width": out.width,
                    "height": out.height,
                    "method": "diffusion:controlnet",
                })
        except Exception as e:  # noqa: BLE001 — return any failure as JSON
            self._send(500, {"error": str(e)})

    def log_message(self, *args) -> None:  # quieter logs
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
