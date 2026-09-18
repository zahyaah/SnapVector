// Pinned to an explicit commit, not `main` — see docs/model-signature.md. If Acly's
// repository is ever renamed or removed, this URL fails predictably (a 404 the retry UI
// can react to) rather than silently serving a different, unverified artifact.
const MOBILESAM_REVISION = '0d3b403339b4674a82493d5e97964dd78089ddc8';
const MOBILESAM_BASE = `https://huggingface.co/Acly/MobileSAM/resolve/${MOBILESAM_REVISION}`;

export const ENCODER_MODEL_URL = `${MOBILESAM_BASE}/mobile_sam_image_encoder.onnx`;
export const DECODER_MODEL_URL = `${MOBILESAM_BASE}/sam_mask_decoder_single.onnx`;
