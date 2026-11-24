import type { StructuredFloorPlan } from './index.js';

type Point = [number, number];
export interface PlanFootprint { min: Point; max: Point }

export function isStairRoom(room: StructuredFloorPlan['rooms'][number]): boolean {
  return /stair|楼梯|梯间|梯井/.test(`${room.kind} ${room.label}`.toLowerCase());
}

export function pointInPlanPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, z] = polygon[index]!;
    const [px, pz] = polygon[previous]!;
    if ((z > point[1]) !== (pz > point[1])
      && point[0] < x + (px - x) * (point[1] - z) / (pz - z)) inside = !inside;
  }
  return inside;
}

function touchesSegment(box: PlanFootprint, start: Point, end: Point, margin: number): boolean {
  let low = 0;
  let high = 1;
  for (const axis of [0, 1] as const) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    const min = box.min[axis] - margin;
    const max = box.max[axis] + margin;
    if (Math.abs(delta) < 1e-8) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}

function touchesPolygon(box: PlanFootprint, polygon: Point[]): boolean {
  if (pointInPlanPolygon(box.min, polygon)) return true;
  return polygon.some((point, index) =>
    touchesSegment(box, point, polygon[(index + 1) % polygon.length]!, 0.1));
}

export function floorPlacementIssue(plan: StructuredFloorPlan, box: PlanFootprint, height: number) {
  for (const opening of plan.openings) {
    if (opening.kind === 'window' && height < opening.sillHeight - 0.05) continue;
    const wall = plan.walls.find((entry) => entry.id === opening.wallId);
    if (!wall) continue;
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const along = (meters: number): Point => [wall.start[0] + dx * meters / length, wall.start[1] + dz * meters / length];
    const center = length * opening.offset;
    if (touchesSegment(box, along(Math.max(0, center - opening.width / 2)),
      along(Math.min(length, center + opening.width / 2)), opening.kind === 'door' ? 0.6 : 0.3)) return opening.kind;
  }
  if (plan.rooms.some((room) => isStairRoom(room) && touchesPolygon(box, room.polygon))) return 'stairs' as const;
  if (plan.walls.some((wall) => touchesSegment(box, wall.start, wall.end, wall.thickness / 2 + 0.015))) return 'wall' as const;
  const start = plan.entrance.position;
  const end: Point = [start[0] + plan.entrance.direction[0] * 1.5, start[1] + plan.entrance.direction[1] * 1.5];
  if (touchesSegment(box, start, end, 0.42)) return 'entry' as const;
  return null;
}
