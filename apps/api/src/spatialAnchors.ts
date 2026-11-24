import { createHash } from 'node:crypto';
import {
  spatialAnchorSetSchema,
  type SceneManifest,
  type SpatialAnchorSet,
} from '@spatial-intelligence/contracts';

type Point3 = [number, number, number];

export function deriveSpatialAnchorSet(manifest: SceneManifest): SpatialAnchorSet {
  if (manifest.coordinateSystem.unit !== 'meter') {
    throw anchorError('unsupported_scene_unit', '空间锁定只接受已归一化为米制的场景');
  }

  const metadataBounds = readBounds(manifest.metadata.spatialBounds);
  const entityBounds = manifest.entities
    .map((entity) => boundsForEntity(entity))
    .filter((bounds): bounds is { min: Point3; max: Point3 } => bounds !== null);
  const bounds = metadataBounds ?? unionBounds(entityBounds);
  if (!bounds) throw anchorError('spatial_bounds_missing', '场景缺少可锁定的空间边界');

  const entranceEntity = manifest.entities.find((entity) => (
    entity.tags.includes('entrance') || entity.kind === 'entrance-anchor'
  ));
  const metadataEntrance = readEntrance(manifest.metadata.entrance);
  const entrance = metadataEntrance ?? (entranceEntity ? {
    position: entranceEntity.transform.position,
    direction: readDirection(entranceEntity.components.direction),
    cameraHeight: 1.65,
  } : null);
  if (!entrance) throw anchorError('entrance_anchor_missing', '场景缺少真实入口锚点，不能锁定');

  const floorBounds = entityBoundsForKinds(manifest, ['floor']);
  const walkableBounds = readBounds(manifest.metadata.walkableBounds)
    ?? unionBounds(floorBounds)
    ?? bounds;
  const surfaces: SpatialAnchorSet['surfaces'] = manifest.entities.flatMap((entity) => {
    const kind = surfaceKind(entity.kind);
    const surfaceBounds = boundsForEntity(entity);
    return kind && surfaceBounds ? [{
      anchorId: `surface:${entity.id}`,
      kind,
      entityId: entity.id,
      bounds: surfaceBounds,
    }] : [];
  });
  if (surfaces.length === 0) {
    surfaces.push({ anchorId: 'surface:boundary', kind: 'boundary', bounds });
  }

  const providerMetadata = asRecord(manifest.metadata.providerEvidence);
  const providerId = stringValue(providerMetadata?.providerId)
    ?? stringValue(manifest.metadata.providerId)
    ?? 'shell-provider';
  const externalProjectId = stringValue(providerMetadata?.externalProjectId)
    ?? stringValue(manifest.metadata.externalProjectId);
  const colliderAsset = manifest.assets.find((asset) => asset.metadata.role === 'collider');
  const sourceAssetIds = manifest.sourceRefs.filter((source) => source.startsWith('asset-'));

  const withoutHash = {
    schemaVersion: '1.0' as const,
    sceneId: manifest.sceneId,
    shellRevision: manifest.revision,
    coordinateSystem: manifest.coordinateSystem,
    bounds,
    entrance,
    surfaces,
    walkableBounds,
    colliderAssetId: colliderAsset?.id,
    provider: { providerId, externalProjectId, sourceAssetIds },
    diagnostics: {
      surfaceCount: surfaces.length,
      boundsSource: metadataBounds ? 'provider-metadata' : 'manifest-entities',
      entranceSource: metadataEntrance ? 'provider-metadata' : 'manifest-entity',
    },
  };
  return spatialAnchorSetSchema.parse({
    ...withoutHash,
    lockHash: createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex'),
  });
}

function entityBoundsForKinds(manifest: SceneManifest, kinds: string[]) {
  return manifest.entities
    .filter((entity) => kinds.includes(entity.kind))
    .map((entity) => boundsForEntity(entity))
    .filter((bounds): bounds is { min: Point3; max: Point3 } => bounds !== null);
}

function boundsForEntity(entity: SceneManifest['entities'][number]): { min: Point3; max: Point3 } | null {
  const primitive = asRecord(entity.components.primitive);
  const size = primitive?.shape === 'box' ? point3(primitive.size) : null;
  if (!size) return null;
  const half: Point3 = [
    Math.abs(size[0] * entity.transform.scale[0]) / 2,
    Math.abs(size[1] * entity.transform.scale[1]) / 2,
    Math.abs(size[2] * entity.transform.scale[2]) / 2,
  ];
  const position = entity.transform.position;
  return {
    min: [position[0] - half[0], position[1] - half[1], position[2] - half[2]],
    max: [position[0] + half[0], position[1] + half[1], position[2] + half[2]],
  };
}

function unionBounds(items: Array<{ min: Point3; max: Point3 }>): { min: Point3; max: Point3 } | null {
  if (items.length === 0) return null;
  return items.reduce((result, current) => ({
    min: result.min.map((value, index) => Math.min(value, current.min[index])) as Point3,
    max: result.max.map((value, index) => Math.max(value, current.max[index])) as Point3,
  }));
}

function readBounds(value: unknown): { min: Point3; max: Point3 } | null {
  const record = asRecord(value);
  const min = point3(record?.min);
  const max = point3(record?.max);
  if (!min || !max || min.some((value, index) => value >= max[index])) return null;
  return { min, max };
}

function readEntrance(value: unknown): { position: Point3; direction: Point3; cameraHeight: number } | null {
  const record = asRecord(value);
  const position = point3(record?.position);
  const direction = point3(record?.direction);
  if (!position || !direction) return null;
  return {
    position,
    direction: normalize(direction),
    cameraHeight: typeof record?.cameraHeight === 'number' ? record.cameraHeight : 1.65,
  };
}

function readDirection(value: unknown): Point3 {
  const record = asRecord(value);
  const direction3 = point3(record?.value);
  if (direction3) return normalize(direction3);
  const direction2 = Array.isArray(record?.value) && record.value.length === 2
    ? record.value.map(Number) : null;
  if (direction2?.every(Number.isFinite)) return normalize([direction2[0], 0, direction2[1]]);
  throw anchorError('entrance_direction_missing', '入口锚点缺少有效方向');
}

function normalize(value: Point3): Point3 {
  const length = Math.hypot(...value);
  if (length < 0.0001) throw anchorError('entrance_direction_invalid', '入口方向不能为零向量');
  return value.map((component) => component / length) as Point3;
}

function surfaceKind(kind: string): 'floor' | 'wall' | 'ceiling' | 'door' | 'window' | null {
  return ['floor', 'wall', 'ceiling', 'door', 'window'].includes(kind)
    ? kind as 'floor' | 'wall' | 'ceiling' | 'door' | 'window'
    : null;
}

function point3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? parsed as Point3 : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function anchorError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
