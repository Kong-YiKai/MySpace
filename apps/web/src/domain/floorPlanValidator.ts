export interface FloorPlanScore {
  accepted: boolean;
  confidence: number;
  reason?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function validateFloorPlanFile(file: File): Promise<FloorPlanScore> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return { accepted: false, confidence: 0, reason: '请上传 PNG、JPG 或 WebP 户型图。' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { accepted: false, confidence: 0, reason: '图片不能超过 10 MB。' };
  }

  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width < 240 || bitmap.height < 180) {
      bitmap.close();
      return { accepted: false, confidence: 0.08, reason: '图片分辨率过低，无法识别户型结构。' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas context unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return scoreFloorPlanPixels(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
  } catch {
    return { accepted: false, confidence: 0, reason: '图片无法读取，请检查文件是否损坏。' };
  }
}

export function scoreFloorPlanPixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): FloorPlanScore {
  let bright = 0;
  let dark = 0;
  let transitions = 0;
  let samples = 0;

  const luminanceAt = (pixelIndex: number) => (
    Number(pixels[pixelIndex]) * 0.2126
      + Number(pixels[pixelIndex + 1]) * 0.7152
      + Number(pixels[pixelIndex + 2]) * 0.0722
  );

  for (let y = 1; y < height; y += 2) {
    for (let x = 1; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const luminance = luminanceAt(index);
      if (luminance > 220) bright += 1;
      if (luminance < 92) dark += 1;

      const left = luminanceAt((y * width + x - 1) * 4);
      const above = luminanceAt(((y - 1) * width + x) * 4);
      if (Math.abs(luminance - left) > 54 || Math.abs(luminance - above) > 54) {
        transitions += 1;
      }
      samples += 1;
    }
  }

  if (samples === 0) return { accepted: false, confidence: 0, reason: '图片没有可分析内容。' };

  const brightRatio = bright / samples;
  const darkRatio = dark / samples;
  const edgeRatio = transitions / samples;
  const confidence = Math.min(0.98, Math.max(0, (
    brightRatio * 0.42 + Math.min(edgeRatio * 3.2, 0.36) + Math.min(darkRatio * 1.4, 0.2)
  )));
  const accepted = brightRatio >= 0.28 && edgeRatio >= 0.018 && darkRatio >= 0.006;

  return accepted
    ? { accepted: true, confidence }
    : {
        accepted: false,
        confidence,
        reason: '未识别到清晰的墙线与平面结构，请上传完整户型图。',
      };
}
