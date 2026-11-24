import sharp from 'sharp';
import type { AssetGenerationRequest } from '@spatial-intelligence/contracts';

const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
const OUTPUT_SIZE = 1_024;

export async function prepareObjectReference(
  url: string,
  box: NonNullable<AssetGenerationRequest['referenceBoundingBox']>,
): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw assetError('reference_download_failed', `参考图下载失败：HTTP ${response.status}`, true);
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REFERENCE_BYTES) throw assetError('reference_too_large', '参考图超过 30 MB', false);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw assetError('reference_too_large', '参考图超过 30 MB', false);
  const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'error' }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw assetError('reference_decode_failed', '参考图缺少有效尺寸', false);
  const left = Math.max(0, Math.floor(box.x * metadata.width));
  const top = Math.max(0, Math.floor(box.y * metadata.height));
  const width = Math.max(1, Math.min(metadata.width - left, Math.ceil(box.width * metadata.width)));
  const height = Math.max(1, Math.min(metadata.height - top, Math.ceil(box.height * metadata.height)));
  const crop = await image
    .extract({ left, top, width, height })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'contain',
      background: { r: 245, g: 245, b: 245, alpha: 1 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${crop.toString('base64')}`;
}

function assetError(code: string, message: string, retryable: boolean): Error {
  return Object.assign(new Error(message), { code, retryable });
}
