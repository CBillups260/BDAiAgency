# SynthID / invisible-watermark removal service (GPU)

This is the GPU half of the AI Watermark Remover. The visible-sparkle + metadata
removal runs locally in Firebase Functions; **invisible (SynthID) removal needs a
GPU**, so it lives here as a [Modal](https://modal.com) serverless-GPU endpoint and
is called over HTTP by the backend.

It wraps the [`remove-ai-watermarks`](https://pypi.org/project/remove-ai-watermarks/)
diffusion engine (SDXL + canny ControlNet img2img). Diffusion regenerates the whole
image to destroy the SynthID pattern, so **expect fine detail / faces / text to drift**
— that tradeoff is inherent to invisible-watermark removal, not a bug.

## One-time deploy

```bash
pip install modal
modal token new                       # authenticate (opens browser)

# A shared secret the backend uses to call this service. Use any long random string.
modal secret create synthid-auth SYNTHID_SERVICE_TOKEN="$(openssl rand -hex 24)"

modal deploy synthid_service.py       # builds image (~10 GB models baked in), deploys
```

`modal deploy` prints the endpoint URL, e.g.
`https://<you>--bdai-synthid-remover-synthidremover-remove.modal.run`.

First build downloads SDXL (~6.9 GB) + the canny ControlNet (~2.5 GB) into the
image, so it takes a few minutes; after that, cold starts are fast.

## Wire it into the app

Set these in the Firebase Functions environment (and your local `functions/.env`
for dev):

```
SYNTHID_SERVICE_URL=https://<...>.modal.run      # the URL modal printed
SYNTHID_SERVICE_TOKEN=<the same value you put in the synthid-auth secret>
```

The backend's `/api/content/remove-watermark` endpoint reads these. If they're
unset, the "remove invisible watermark" toggle returns a clear "not configured"
error and the visible + metadata path keeps working.

## Cost / latency

- GPU: A10G (24 GB). One image ≈ **10–40 s** depending on size and steps.
- Modal bills per-second of GPU time; the container scales to zero after 5 min idle
  (`scaledown_window=300`), so you only pay while removing.
- To trade cost for throughput, change `gpu="A10G"` (e.g. `"L40S"`) and
  `scaledown_window` in `synthid_service.py`.

## Swapping hosts

The backend only needs an HTTPS endpoint that accepts
`{ image_base64, vendor?, strength?, steps? }` and returns `{ image_base64 }`.
To move off Modal (e.g. Cloud Run + GPU, or Replicate), stand up any service with
that contract and repoint `SYNTHID_SERVICE_URL` — no app code changes.

## Request contract

`POST <SYNTHID_SERVICE_URL>`
```json
{
  "image_base64": "<png/jpeg bytes, base64>",
  "token": "<SYNTHID_SERVICE_TOKEN>",
  "vendor": "google",        // optional; google=0.30 strength, openai=0.20
  "strength": null,          // optional; overrides vendor-adaptive default
  "steps": 100,              // optional
  "max_resolution": 1536     // optional; caps GPU memory
}
```
→ `{ "image_base64": "...", "width": N, "height": N, "method": "diffusion:controlnet" }`
