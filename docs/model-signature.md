# MobileSAM ONNX Model Signature

> Research output for T11. Every fact below is verified against the actual ONNX graph or
> an authoritative source, not assumed from memory or documentation prose, per
> `/source-driven-development`. See citations inline.

## Pinned artifacts

| Artifact | Repository | Revision | File | Size |
|---|---|---|---|---|
| Encoder | [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM) | `0d3b403339b4674a82493d5e97964dd78089ddc8` | `mobile_sam_image_encoder.onnx` | 28,157,093 bytes (26.9 MiB) |
| Decoder | [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM) | `0d3b403339b4674a82493d5e97964dd78089ddc8` | `sam_mask_decoder_single.onnx` | 16,501,323 bytes (15.7 MiB) |

**Why this repository.** MIT-licensed, MobileSAM-specific (the encoder is genuinely the
distilled TinyViT, not full SAM), and its own export scripts are checked into the repo,
which is what made verifying the exact preprocessing contract below possible rather than
having to guess it. A `sam_mask_decoder_multi.onnx` (four candidate masks, also 16.5 MiB)
exists in the same repo and was not selected — SPEC calls for one mask per prompt, and
the multi-mask variant would need a selection heuristic we don't need.

**Pinned by commit, not branch.** Per [ADR-0004](adr/0004-model-delivery-and-caching.md),
the URL embeds the exact revision so the artifact cannot change under us:

```
https://huggingface.co/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/mobile_sam_image_encoder.onnx
https://huggingface.co/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/sam_mask_decoder_single.onnx
```

**Quantization.** Only fp32 weights exist in this repository. No int8 variant is
available to compare against without quantizing it ourselves. This narrows T16's
quantization question from "fp32 vs int8, pick one" to "is fp32 fast enough; if not,
quantize `mobile_sam_image_encoder.onnx` ourselves with
`onnxruntime.quantization.quantize_dynamic`" — the export script in this repo already
shows that exact call. Recorded as a T16 input, not decided here.

## CORS and range-request support

Verified with a real GET request (not HEAD — HEAD and GET can differ on a signed-URL CDN)
including an `Origin` header, following the redirect to the final CDN response:

```
$ curl -sL "https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx" \
    -H "Origin: https://example.com" -H "Range: bytes=0-0" -D - -o /dev/null
...
HTTP/2 206
access-control-allow-origin: *
accept-ranges: bytes
content-range: bytes 0-0/28157093
```

`access-control-allow-origin: *` and `accept-ranges: bytes` are both present on the final
CDN response (`*.cloudfront.net`, fronting Hugging Face's Xet storage backend). A browser
`fetch()` from our origin can read the response body, and range requests are available if
resumable download is ever added. This confirms [ADR-0004](adr/0004-model-delivery-and-caching.md)'s
delivery plan is actually viable, not just assumed viable.

## Encoder: `mobile_sam_image_encoder.onnx`

Read directly from the ONNX graph (`onnx.load(..., load_external_data=False)`, IR version
8, opset `ai.onnx=17`), not from the export script's argument defaults, because the export
script (`export_image_encoder.py`, same repository) supports two mutually exclusive input
conventions depending on a `--use-preprocess` flag and the README doesn't say which one
this repo's file used:

| | Name | Shape | Dtype |
|---|---|---|---|
| Input | `input_image` | `[image_height, image_width, 3]` (dynamic H/W) | `float32` |
| Output | `image_embeddings` | `[1, 256, 64, 64]` | `float32` |

**This confirms `--use-preprocess` was used.** The input is raw HWC pixels (no batch
dimension, channels last), and per the export script's `ImageEncoderOnnxModel.preprocess`
(quoted below, from `mobile_sam_encoder_onnx/onnx_image_encoder.py` in the same repo),
normalization, HWC→CHW permutation, zero-padding to a square, and the batch dimension are
**all applied inside the graph**:

```python
def preprocess(self, x: torch.Tensor) -> torch.Tensor:
    x = (x - self.pixel_mean) / self.pixel_std      # pixel_mean=[123.675,116.28,103.53]
    x = torch.permute(x, (2, 0, 1))                  # pixel_std=[58.395,57.12,57.375]
    h, w = x.shape[-2:]
    padh = self.image_encoder.img_size - h           # img_size = 1024
    padw = self.image_encoder.img_size - w
    x = F.pad(x, (0, padw, 0, padh))                 # pad bottom/right only
    x = torch.unsqueeze(x, 0)
    return x
```

**Consequence for T12 (`src/lib/sam/preprocess.ts`):** we must NOT normalize, permute, or
pad in JavaScript — the graph already does it, and doing it twice would be wrong. Our job
is exactly one step: **resize the image so its longest side is 1024px**, preserving aspect
ratio, and hand the graph that resized image as `[h, w, 3]` HWC float32 (raw 0-255 pixel
values). The graph pads the short side to 1024 with zeros on the bottom/right only (not
centered), which fixes the letterbox convention our coordinate math has to match: padding
is always bottom-right, never centered.

## Decoder: `sam_mask_decoder_single.onnx`

| | Name | Shape | Dtype |
|---|---|---|---|
| Input | `image_embeddings` | `[1, 256, 64, 64]` | `float32` |
| Input | `point_coords` | `[1, num_points, 2]` (dynamic) | `float32` |
| Input | `point_labels` | `[1, num_points]` (dynamic) | `float32` |
| Input | `mask_input` | `[1, 1, 256, 256]` | `float32` |
| Input | `has_mask_input` | `[1]` | `float32` |
| Input | `orig_im_size` | `[2]` | `float32` |
| Output | `masks` | dynamic, resized to `orig_im_size` | `float32` |
| Output | `iou_predictions` | dynamic | `float32` |
| Output | `low_res_masks` | dynamic (256×256-ish) | `float32` |

This is Meta's standard SAM ONNX decoder contract verified directly against the official
export script
([`facebookresearch/segment-anything/scripts/export_onnx_model.py`](https://github.com/facebookresearch/segment-anything/blob/main/scripts/export_onnx_model.py))
and its worked example
([`notebooks/onnx_model_example.ipynb`](https://github.com/facebookresearch/segment-anything/blob/main/notebooks/onnx_model_example.ipynb)),
which is exactly the SAM-compatibility [ADR-0003](adr/0003-mobilesam-over-sam-vit-h.md) predicted.

**`point_coords` are in resized-to-1024 space, not original-image pixels and not
normalized 0-1.** Quoting the official notebook directly:

```python
onnx_coord = predictor.transform.apply_coords(onnx_coord, image.shape[:2]).astype(np.float32)
```

`apply_coords` multiplies each coordinate by the same scale factor used to resize the
image's longest side to 1024. **Consequence:** T12's coordinate transform is shared logic
— the exact same scale factor that resizes the image for the encoder also rescales every
prompt point (loop anchor, interior samples, background point, bbox corners) before they
reach the decoder. Getting this wrong silently misplaces every point the same way T6
worried about at the polygon level, just one layer further down the pipeline.

**`point_labels` encode point *kind*, not just foreground/background** — this changes how
T14 builds the decoder call from a `SamPrompt`:

| Label | Meaning |
|---|---|
| `1` | foreground point |
| `0` | background point |
| `2` | box top-left corner |
| `3` | box bottom-right corner |
| `-1` | padding point (see below) |

**The box is not a separate tensor.** `loopToSamPrompt`'s `box` gets encoded as two more
entries appended to `point_coords`/`point_labels` (labels `2` and `3`), concatenated with
the foreground/background points from T6 — one combined array, not a separate SAM "box"
input. This is simpler than what SPEC's task list implied (a distinct box parameter) and
means T14's job is largely a data-shape transform: `SamPrompt` → one flat `point_coords` /
`point_labels` pair.

**Padding point convention (may not apply to us).** The official notebook appends a
`(0, 0)` point labeled `-1` only for point-only prompts with no box, because the model
was trained expecting a box unless a dummy pad point stands in for one. Since
`loopToSamPrompt` always returns a box, T14 most likely never needs this — flagged here
rather than silently assumed, to be confirmed once real inference is running in T14.

**`orig_im_size` is the pre-resize original image size**, not the 1024-letterboxed size —
the graph uses it to upscale `masks` back to the caller's original resolution
automatically. T14 does not need to resize the output mask itself.

**`mask_input` / `has_mask_input`** support an iterative refinement flow (feed a previous
mask back in) that SPEC does not call for in v1. T14 always passes `has_mask_input = 0`
and an all-zero `[1,1,256,256]` `mask_input` tensor.

## Sources

- [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM) — model repository, license, file listing
- [`mobile_sam_encoder_onnx/export_image_encoder.py`](https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_encoder_onnx/export_image_encoder.py) — encoder export script (this repo)
- [`mobile_sam_encoder_onnx/onnx_image_encoder.py`](https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_encoder_onnx/onnx_image_encoder.py) — encoder preprocessing wrapper, quoted above (this repo)
- [`facebookresearch/segment-anything/scripts/export_onnx_model.py`](https://github.com/facebookresearch/segment-anything/blob/main/scripts/export_onnx_model.py) — decoder tensor contract (official Meta repository)
- [`facebookresearch/segment-anything/notebooks/onnx_model_example.ipynb`](https://github.com/facebookresearch/segment-anything/blob/main/notebooks/onnx_model_example.ipynb) — point-coordinate scaling and label convention, quoted above (official Meta repository)
- Direct graph inspection: `python3 -c "import onnx; onnx.load(path, load_external_data=False)"` against both downloaded files (IR version 8, opset `ai.onnx=17` for both)
- CORS/range verification: `curl` against the live CDN response, quoted above
