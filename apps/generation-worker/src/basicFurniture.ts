import {
  floorPlacementIssue, isStairRoom, pointInPlanPolygon,
  type BasicFurnitureKind, type PlanFootprint, type SceneManifest, type StructuredFloorPlan,
} from '@spatial-intelligence/contracts';

type Point = [number, number];
type Room = StructuredFloorPlan['rooms'][number];
type Entity = SceneManifest['entities'][number];
type FurnitureHint = NonNullable<StructuredFloorPlan['furnitureHints']>[number];
type Size = [number, number, number];

const furniture: Record<BasicFurnitureKind, { label: string; size: Size }> = {
  sofa: { label: '沙发', size: [2, 0.82, 0.83] },
  'coffee-table': { label: '茶几', size: [1, 0.39, 0.52] },
  bed: { label: '床', size: [1.55, 0.94, 2.06] },
  wardrobe: { label: '衣柜', size: [1.16, 2.04, 0.58] },
  desk: { label: '书桌', size: [1.15, 0.74, 0.56] },
  chair: { label: '椅子', size: [0.48, 0.82, 0.48] },
  'dining-table': { label: '餐桌', size: [1.4, 0.75, 0.78] },
};

function suggestedFurniture(room: Room): BasicFurnitureKind[] {
  const name = `${room.kind} ${room.label}`.toLowerCase();
  if (isStairRoom(room) || /bath|kitchen|corridor|hallway|balcony|卫|厨|过道|走廊|阳台/.test(name)) return [];
  if (/bed|卧/.test(name)) return ['bed', 'wardrobe'];
  if (/study|office|书房/.test(name)) return ['desk', 'chair'];
  if (/living|studio|residential-space|客厅|客餐|起居/.test(name)) return ['sofa', 'coffee-table'];
  if (/dining|餐厅/.test(name)) return ['dining-table', 'chair'];
  return [];
}

export function buildBasicFurniture(plan: StructuredFloorPlan): Entity[] {
  const built: Entity[] = [];
  const occupied: PlanFootprint[] = [];
  const rooms = plan.rooms.filter((room) => !isStairRoom(room) && room.confidence >= 0.3);

  for (const room of rooms) {
    const hints = (plan.furnitureHints ?? [])
      .filter((hint) => rooms.find((candidate) => pointInPlanPolygon(hint.position, candidate.polygon)) === room)
      .sort((a, b) => b.confidence - a.confidence);
    const kinds = new Set([...hints.map((hint) => hint.kind), ...suggestedFurniture(room)]);
    for (const kind of kinds) {
      if (built.length >= 36) return built;
      const hint = hints.find((entry) => entry.kind === kind);
      const item = furniture[kind];
      const placement = placeFurniture(plan, room, item.size, occupied, hint);
      if (!placement) continue;
      occupied.push(placement.bounds);
      const [width, height, depth] = item.size;
      built.push({
        id: `basic-${room.id}-${kind}`,
        label: item.label,
        kind: `furniture:${kind}`,
        parentId: null,
        assetRefs: [],
        transform: {
          position: [placement.position[0] - plan.width / 2, 0, placement.position[1] - plan.depth / 2],
          rotation: [0, Math.sin(placement.yaw / 2), 0, Math.cos(placement.yaw / 2)],
          scale: [1, 1, 1],
        },
        components: {
          basicFurniture: { kind, size: item.size, roomId: room.id, source: placement.usedHint ? 'image' : 'room-default' },
          collider: { type: 'aabb', bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] } },
        },
        tags: ['furniture', 'basic-furniture', 'selectable'],
        interactive: true,
      });
    }
  }
  return built;
}

function placeFurniture(
  plan: StructuredFloorPlan, room: Room, size: Size, occupied: PlanFootprint[],
  hint: FurnitureHint | undefined,
) {
  const minX = Math.min(...room.polygon.map(([x]) => x));
  const minZ = Math.min(...room.polygon.map(([, z]) => z));
  const maxX = Math.max(...room.polygon.map(([x]) => x));
  const maxZ = Math.max(...room.polygon.map(([, z]) => z));
  const points: Point[] = [];
  for (let x = minX + 0.28; x < maxX; x += 0.28) {
    for (let z = minZ + 0.28; z < maxZ; z += 0.28) points.push([x, z]);
  }
  if (hint) {
    points.sort((a, b) => Math.hypot(a[0] - hint.position[0], a[1] - hint.position[1])
      - Math.hypot(b[0] - hint.position[0], b[1] - hint.position[1]));
    points.unshift(hint.position);
  }

  const orientations = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let fallback: { position: Point; yaw: number; bounds: PlanFootprint; usedHint: boolean } | null = null;
  const fits = (bounds: PlanFootprint) => {
    const { min, max } = bounds;
    if (min[0] < 0 || min[1] < 0 || max[0] > plan.width || max[1] > plan.depth) return false;
    const corners: Point[] = [min, [max[0], min[1]], max, [min[0], max[1]]];
    return corners.every((corner) => pointInPlanPolygon(corner, room.polygon))
      && !floorPlacementIssue(plan, bounds, size[1])
      && !occupied.some((other) => overlaps(bounds, other));
  };
  for (const position of points) {
    const [x, z] = position;
    const preferredYaw = hint ? Math.atan2(...hint.direction) : wallFacing(x, z, minX, minZ, maxX, maxZ);
    for (const yaw of [preferredYaw, ...orientations.filter((angle) => angle !== preferredYaw)]) {
      const dx = (Math.abs(Math.cos(yaw)) * size[0] + Math.abs(Math.sin(yaw)) * size[2]) / 2;
      const dz = (Math.abs(Math.sin(yaw)) * size[0] + Math.abs(Math.cos(yaw)) * size[2]) / 2;
      const bounds: PlanFootprint = { min: [x - dx, z - dz], max: [x + dx, z + dz] };
      if (!fits(bounds)) continue;
      const placed = { position, yaw, bounds, usedHint: Boolean(hint && Math.hypot(x - hint.position[0], z - hint.position[1]) <= 0.5) };
      if (hint || fits({ min: [x - dz, z - dx], max: [x + dz, z + dx] })) return placed;
      fallback ??= placed;
    }
  }
  return fallback;
}

function wallFacing(x: number, z: number, minX: number, minZ: number, maxX: number, maxZ: number) {
  const sides = [
    { distance: x - minX, yaw: Math.PI / 2 }, { distance: z - minZ, yaw: 0 },
    { distance: maxX - x, yaw: -Math.PI / 2 }, { distance: maxZ - z, yaw: Math.PI },
  ];
  return sides.reduce((closest, side) => side.distance < closest.distance ? side : closest).yaw;
}

function overlaps(a: PlanFootprint, b: PlanFootprint): boolean {
  return ([0, 1] as const).every((axis) => a.min[axis] < b.max[axis] + 0.12 && a.max[axis] > b.min[axis] - 0.12);
}
