import {
  floorPlacementIssue,
  structuredFloorPlanSchema,
  type CommandEnvelope,
  type SceneManifest,
  type SpatialAnchorSet,
} from '@spatial-intelligence/contracts';

type Point3 = [number, number, number];
interface Bounds { min: Point3; max: Point3 }

const STRUCTURAL_KINDS = new Set([
  'floor', 'wall', 'ceiling', 'door', 'window', 'boundary', 'entrance-anchor',
]);
const PROTECTED_COMPONENTS = new Set(['primitive', 'collider', 'direction', 'spatialAnchor']);

export interface SpatialValidationDiagnostics {
  colliderCount: number;
  pairChecks: number;
  restrictedSurfaceChecks: number;
  mainPathChecks: number;
}

export function validateSceneMutation(
  previous: SceneManifest,
  next: SceneManifest,
  envelope: CommandEnvelope,
  anchors: SpatialAnchorSet,
): SpatialValidationDiagnostics {
  assertStructuralCommands(previous, envelope);
  assertStructuralEntitiesUnchanged(previous, next);
  const colliders = next.entities.flatMap((entity) => {
    if (isStructural(entity)) return [];
    const local = readColliderBounds(entity.components.collider);
    return local ? [{ entityId: entity.id, tags: entity.tags, bounds: transformBounds(local, entity.transform) }] : [];
  });
  const plan = structuredFloorPlanSchema.safeParse(next.metadata.floorPlan).data;
  for (const collider of colliders) {
    if (!contains(anchors.bounds, collider.bounds, 0.01)) {
      throw sceneError('outside_locked_space', `对象 ${collider.entityId} 超出已锁定空间边界`);
    }
    if (plan) {
      const { min, max } = collider.bounds;
      const obstacle = floorPlacementIssue(plan, {
        min: [min[0] + plan.width / 2, min[2] + plan.depth / 2],
        max: [max[0] + plan.width / 2, max[2] + plan.depth / 2],
      }, max[1]);
      if (obstacle) {
        const errors = {
          door: ['door_clearance_blocked', '家具挡住门洞，请留出通行空间。'],
          window: ['window_clearance_blocked', '家具挡住窗户，请换一个位置。'],
          wall: ['wall_collision', '家具与墙体相交，请调整位置或角度。'],
          stairs: ['stairs_blocked', '家具进入楼梯区域，请留出平台。'],
          entry: ['main_path_blocked', '家具挡住入口通道，请换一个位置。'],
        };
        throw sceneError(errors[obstacle][0]!, errors[obstacle][1]!);
      }
    }
  }
  let pairChecks = 0;
  for (let left = 0; left < colliders.length; left += 1) {
    for (let right = left + 1; right < colliders.length; right += 1) {
      pairChecks += 1;
      const a = colliders[left]!;
      const b = colliders[right]!;
      if (a.tags.includes('allow-overlap') || b.tags.includes('allow-overlap')) continue;
      if (intersects(a.bounds, b.bounds, 0.025)) {
        throw sceneError('object_collision', `对象 ${a.entityId} 与 ${b.entityId} 发生碰撞`);
      }
    }
  }
  if (plan) return { colliderCount: colliders.length, pairChecks, restrictedSurfaceChecks: 0, mainPathChecks: colliders.length };
  const restricted = anchors.surfaces.filter((surface) => surface.kind === 'door' || surface.kind === 'window');
  let restrictedSurfaceChecks = 0;
  for (const collider of colliders) {
    for (const surface of restricted) {
      restrictedSurfaceChecks += 1;
      const clearance = surface.kind === 'door' ? 0.6 : 0.3;
      if (intersects(collider.bounds, inflate(surface.bounds, clearance, 0.05), 0)) {
        throw sceneError(
          surface.kind === 'door' ? 'door_clearance_blocked' : 'window_clearance_blocked',
          `对象 ${collider.entityId} 侵入${surface.kind === 'door' ? '门洞净空' : '窗前净空'}`,
        );
      }
    }
  }
  const entranceEnd: Point3 = [
    anchors.entrance.position[0] + anchors.entrance.direction[0] * 1.5,
    anchors.entrance.position[1],
    anchors.entrance.position[2] + anchors.entrance.direction[2] * 1.5,
  ];
  const roomCenter: Point3 = [
    (anchors.walkableBounds.min[0] + anchors.walkableBounds.max[0]) / 2,
    0,
    (anchors.walkableBounds.min[2] + anchors.walkableBounds.max[2]) / 2,
  ];
  let mainPathChecks = 0;
  for (const collider of colliders) {
    mainPathChecks += 1;
    if (segmentIntersectsExpandedBox(entranceEnd, roomCenter, collider.bounds, 0.42)) {
      throw sceneError('main_path_blocked', `对象 ${collider.entityId} 阻断入口到房间中心的主要动线`);
    }
  }
  return { colliderCount: colliders.length, pairChecks, restrictedSurfaceChecks, mainPathChecks };
}

function assertStructuralCommands(manifest: SceneManifest, envelope: CommandEnvelope): void {
  for (const command of envelope.commands) {
    if (!('entityId' in command)) continue;
    const entity = manifest.entities.find((item) => item.id === command.entityId);
    if (!entity || !isStructural(entity)) continue;
    if (command.type === 'REMOVE_ENTITY' || command.type === 'SET_TRANSFORM') {
      throw sceneError('locked_structure_mutation', `不能移动或删除已锁定结构 ${entity.id}`);
    }
    if ((command.type === 'SET_COMPONENT' || command.type === 'REMOVE_COMPONENT')
      && PROTECTED_COMPONENTS.has(command.component)) {
      throw sceneError('locked_structure_mutation', `不能修改已锁定结构 ${entity.id} 的 ${command.component}`);
    }
  }
}

function assertStructuralEntitiesUnchanged(previous: SceneManifest, next: SceneManifest): void {
  for (const before of previous.entities.filter(isStructural)) {
    const after = next.entities.find((entity) => entity.id === before.id);
    if (!after) throw sceneError('locked_structure_mutation', `已锁定结构 ${before.id} 被删除`);
    if (JSON.stringify(before.transform) !== JSON.stringify(after.transform)) {
      throw sceneError('locked_structure_mutation', `已锁定结构 ${before.id} 的变换发生变化`);
    }
  }
}

function isStructural(entity: SceneManifest['entities'][number]): boolean {
  return STRUCTURAL_KINDS.has(entity.kind) || entity.tags.includes('structural') || entity.tags.includes('shell');
}

function readColliderBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const bounds = record.bounds;
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return null;
  const min = point3((bounds as Record<string, unknown>).min);
  const max = point3((bounds as Record<string, unknown>).max);
  if (!min || !max || min.some((item, index) => item >= max[index]!)) return null;
  return { min, max };
}

function transformBounds(bounds: Bounds, transform: SceneManifest['entities'][number]['transform']): Bounds {
  const corners: Point3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const scaled: Point3 = [x * transform.scale[0], y * transform.scale[1], z * transform.scale[2]];
        const rotated = rotateByQuaternion(scaled, transform.rotation);
        corners.push([
          rotated[0] + transform.position[0],
          rotated[1] + transform.position[1],
          rotated[2] + transform.position[2],
        ]);
      }
    }
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]!))) as Point3,
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]!))) as Point3,
  };
}

function rotateByQuaternion(point: Point3, rotation: [number, number, number, number]): Point3 {
  const [x, y, z, w] = rotation;
  const [px, py, pz] = point;
  const ix = w * px + y * pz - z * py;
  const iy = w * py + z * px - x * pz;
  const iz = w * pz + x * py - y * px;
  const iw = -x * px - y * py - z * pz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

function contains(outer: Bounds, inner: Bounds, tolerance: number): boolean {
  return inner.min.every((value, axis) => value >= outer.min[axis]! - tolerance)
    && inner.max.every((value, axis) => value <= outer.max[axis]! + tolerance);
}

function intersects(left: Bounds, right: Bounds, clearance: number): boolean {
  return [0, 1, 2].every((axis) => (
    left.min[axis]! < right.max[axis]! + clearance
    && left.max[axis]! > right.min[axis]! - clearance
  ));
}

function inflate(bounds: Bounds, horizontal: number, vertical: number): Bounds {
  return {
    min: [bounds.min[0] - horizontal, bounds.min[1] - vertical, bounds.min[2] - horizontal],
    max: [bounds.max[0] + horizontal, bounds.max[1] + vertical, bounds.max[2] + horizontal],
  };
}

function segmentIntersectsExpandedBox(start: Point3, end: Point3, box: Bounds, radius: number): boolean {
  const minX = box.min[0] - radius;
  const maxX = box.max[0] + radius;
  const minZ = box.min[2] - radius;
  const maxZ = box.max[2] + radius;
  let low = 0;
  let high = 1;
  for (const [origin, delta, minimum, maximum] of [
    [start[0], end[0] - start[0], minX, maxX],
    [start[2], end[2] - start[2], minZ, maxZ],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}

function point3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  return value as Point3;
}

function sceneError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
