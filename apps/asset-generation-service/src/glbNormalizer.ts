import type { AssetGenerationRequest, NormalizedAssetTransform } from '@spatial-intelligence/contracts';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

interface GlbJson {
  accessors?: Array<{ min?: number[]; max?: number[]; type?: string }>;
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }>;
  materials?: unknown[];
}

export interface GlbInspection {
  transform: NormalizedAssetTransform;
  sourceBytes: Buffer;
  diagnostics: { byteLength: number; materialCount: number; hasPbrMaterial: boolean };
}

export function inspectAndNormalizeGlb(
  sourceBytes: Buffer,
  targetSize: AssetGenerationRequest['targetSizeMeters'],
): GlbInspection {
  if (sourceBytes.byteLength < 20 || sourceBytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw assetError('invalid_glb', 'Lux3D 输出不是有效 GLB 文件');
  }
  if (sourceBytes.readUInt32LE(4) !== 2) throw assetError('unsupported_glb_version', '仅支持 GLB 2.0');
  if (sourceBytes.readUInt32LE(8) !== sourceBytes.byteLength) {
    throw assetError('invalid_glb_length', 'GLB 声明长度与实际文件不一致');
  }
  let offset = 12;
  let json: GlbJson | null = null;
  while (offset + 8 <= sourceBytes.byteLength) {
    const chunkLength = sourceBytes.readUInt32LE(offset);
    const chunkType = sourceBytes.readUInt32LE(offset + 4);
    const end = offset + 8 + chunkLength;
    if (end > sourceBytes.byteLength) throw assetError('invalid_glb_chunk', 'GLB chunk 越界');
    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(sourceBytes.subarray(offset + 8, end).toString('utf8').trim()) as GlbJson;
      break;
    }
    offset = end;
  }
  if (!json) throw assetError('invalid_glb_json', 'GLB 缺少 JSON chunk');
  const indices = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (typeof primitive.attributes?.POSITION === 'number') indices.add(primitive.attributes.POSITION);
    }
  }
  const bounds = [...indices].reduce<{ min: number[]; max: number[] } | null>((result, index) => {
    const accessor = json!.accessors?.[index];
    if (accessor?.type !== 'VEC3' || accessor.min?.length !== 3 || accessor.max?.length !== 3) return result;
    if (!result) return { min: [...accessor.min], max: [...accessor.max] };
    return {
      min: result.min.map((value, axis) => Math.min(value, accessor.min![axis]!)),
      max: result.max.map((value, axis) => Math.max(value, accessor.max![axis]!)),
    };
  }, null);
  if (!bounds) throw assetError('glb_bounds_missing', 'GLB POSITION accessor 缺少 min/max，无法归一化');
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]!);
  if (size.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw assetError('glb_bounds_invalid', 'GLB 包围盒无效');
  }
  const requested = [targetSize.width, targetSize.height, targetSize.depth];
  const ratios = requested.flatMap((value, axis) => value ? [value / size[axis]!] : []);
  const uniformScale = ratios.length > 0 ? Math.min(...ratios) : 1;
  const centerX = (bounds.min[0]! + bounds.max[0]!) / 2;
  const centerZ = (bounds.min[2]! + bounds.max[2]!) / 2;
  const translation: [number, number, number] = [
    -centerX * uniformScale,
    -bounds.min[1]! * uniformScale,
    -centerZ * uniformScale,
  ];
  const normalizedMin = bounds.min.map((value, axis) => value * uniformScale + translation[axis]!) as [number, number, number];
  const normalizedMax = bounds.max.map((value, axis) => value * uniformScale + translation[axis]!) as [number, number, number];
  return {
    sourceBytes,
    transform: {
      coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
      sourceBoundsMeters: { min: tuple(bounds.min), max: tuple(bounds.max) },
      normalizedBoundsMeters: { min: normalizedMin, max: normalizedMax },
      scale: [uniformScale, uniformScale, uniformScale],
      rotationQuaternion: [0, 0, 0, 1],
      translationMeters: translation,
      pivot: 'floor-center',
    },
    diagnostics: {
      byteLength: sourceBytes.byteLength,
      materialCount: json.materials?.length ?? 0,
      hasPbrMaterial: (json.materials?.length ?? 0) > 0,
    },
  };
}

function tuple(value: number[]): [number, number, number] {
  return [value[0]!, value[1]!, value[2]!];
}

function assetError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: false });
}
