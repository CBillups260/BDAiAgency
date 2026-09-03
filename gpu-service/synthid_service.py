"""
SynthID / invisible-watermark removal service (GPU).

Wraps the `remove-ai-watermarks` diffusion engine (SDXL + canny ControlNet
img2img) as a Modal serverless-GPU web endpoint. The BDAi backend calls this for
the "remove invisible watermark" path — it is the ONLY part of the watermark
pipeline that needs a GPU, so it lives outside Firebase Functions and is reached
over HTTP.

What it does: encodes the image to latent space, injects controlled noise, and
re-denoises through SDXL with a canny ControlNet that holds text/face structure —
which destroys the SynthID pattern while keeping the picture recognizable. The
output is a fresh PNG (so C2PA/EXIF/XMP are gone as a side effect too).

Caveats (be honest with users):
  * Diffusion REGENERATES every pixel — fine detail/faces drift, and it can warp
    text. This is inherent to invisible-watermark removal, not a bug.
  * Defeating the SynthID verifier is not the same as being forensically
    undetectable; a "was-this-processed" classifier can still flag the output.

Deploy:  modal deploy synthid_service.py
Then set SYNTHID_SERVICE_URL (the printed endpoint URL) and SYNTHID_SERVICE_TOKEN
in the Firebase Functions env. See README.md in this folder.
"""

import base64
import io
import os
import tempfile
from pathlib import Path

import modal

# ── Image: the reference package + its GPU extras, with SDXL + ControlNet baked in ──

MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"
CONTROLNET_ID = "xinsir/controlnet-canny-sdxl-1.0"
HF_CACHE = "/cache/huggingface"


def _download_models() -> None:
    """Pre-fetch the SDXL base + canny ControlNet weights into the image layer so
    cold starts don't re-download ~10 GB. Runs once at image build time."""
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_ID)
    snapshot_download(CONTROLNET_ID)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")  # opencv runtime libs
    .env({"HF_HOME": HF_CACHE, "TRANSFORMERS_VERBOSITY": "error", "DIFFUSERS_VERBOSITY": "error"})
    # The published package + GPU extras (torch, diffusers, transformers, accelerate).
    .pip_install("remove-ai-watermarks[gpu]==0.10.1", "huggingface_hub>=0.20.0")
    .run_function(_download_models)
)

app = modal.App("bdai-synthid-remover", image=image)

# Shared-secret auth: the Firebase backend sends this in `Authorization: Bearer`.
# Create with:  modal secret create synthid-auth SYNTHID_SERVICE_TOKEN=<random>
auth_secret = modal.Secret.from_name("synthid-auth")


@app.cls(gpu="A10G", scaledown_window=300, timeout=600, secrets=[auth_secret])
class SynthIDRemover:
    @modal.enter()
    def load(self) -> None:
        """Load the diffusion pipeline once per container (warm across requests)."""
        from remove_ai_watermarks.invisible_engine import InvisibleEngine

        # controlnet pipeline preserves text/face structure through the scrub.
        self.engine = InvisibleEngine(device="cuda", pipeline="controlnet")
        self.engine.preload()

    @modal.fastapi_endpoint(method="POST")
    def remove(self, payload: dict) -> dict:
        """Remove the invisible watermark from a base64 image.

        Request JSON:
          { image_base64, vendor?="google", strength?=null, steps?=100,
            pipeline?="controlnet", max_resolution?=1536 }
        Response JSON:
          { image_base64, width, height, method } | { error }
        """
        from fastapi import HTTPException
        from PIL import Image

        # ── Auth ── shared secret passed in the request body (over HTTPS). Set the
        # same value as SYNTHID_SERVICE_TOKEN in the Firebase Functions env.
        expected = os.environ.get("SYNTHID_SERVICE_TOKEN")
        if expected and (payload.get("token") or "") != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")

        b64 = payload.get("image_base64")
        if not b64:
            raise HTTPException(status_code=400, detail="image_base64 is required")

        # Vendor-adaptive strength: Google's SynthID is ~3x more robust, so the
        # engine uses 0.30 for google, 0.20 for openai. Our composer is Gemini, so
        # default to google; allow override.
        vendor = payload.get("vendor", "google")
        strength = payload.get("strength")  # None -> vendor-adaptive default
        steps = int(payload.get("steps", 100))
        pipeline = payload.get("pipeline", "controlnet")
        max_resolution = int(payload.get("max_resolution", 1536))

        raw = base64.b64decode(b64)
        with tempfile.TemporaryDirectory() as d:
            in_path = os.path.join(d, "in.png")
            out_path = os.path.join(d, "out.png")
            Image.open(io.BytesIO(raw)).convert("RGB").save(in_path)

            if pipeline != "controlnet":
                # Rebuild the engine if a different pipeline was requested (rare).
                from remove_ai_watermarks.invisible_engine import InvisibleEngine

                engine = InvisibleEngine(device="cuda", pipeline=pipeline)
                engine.preload()
            else:
                engine = self.engine

            engine.remove_watermark(
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
            return {
                "image_base64": base64.b64encode(buf.getvalue()).decode(),
                "width": out.width,
                "height": out.height,
                "method": f"diffusion:{pipeline}",
            }
