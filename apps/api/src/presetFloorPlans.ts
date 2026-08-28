import { structuredFloorPlanSchema, type StructuredFloorPlan } from '@spatial-intelligence/contracts';

const outerWalls = (width: number, depth: number) => [
  { id: 'wall-north', start: [0, 0], end: [width, 0], thickness: 0.16, height: 2.8 },
  { id: 'wall-east', start: [width, 0], end: [width, depth], thickness: 0.16, height: 2.8 },
  { id: 'wall-south', start: [width, depth], end: [0, depth], thickness: 0.16, height: 2.8 },
  { id: 'wall-west', start: [0, depth], end: [0, 0], thickness: 0.16, height: 2.8 },
] as const;

export function presetFloorPlan(preset: 'studio' | 'one-bedroom'): StructuredFloorPlan {
  if (preset === 'studio') {
    return structuredFloorPlanSchema.parse({
      schemaVersion: '1.0',
      width: 8,
      depth: 6,
      scaleMetersPerPixel: null,
      scaleEstimated: false,
      walls: outerWalls(8, 6),
      openings: [
        { id: 'entrance', kind: 'door', wallId: 'wall-south', offset: 0.5, width: 1, height: 2.15 },
        { id: 'main-window', kind: 'window', wallId: 'wall-north', offset: 0.62, width: 2.2, height: 1.25, sillHeight: 0.9 },
      ],
      rooms: [{
        id: 'room-main',
        kind: 'studio',
        label: '开放式起居空间',
        polygon: [[0, 0], [8, 0], [8, 6], [0, 6]],
        confidence: 1,
      }],
      entrance: { position: [4, 6], direction: [0, -1] },
      confidence: 1,
      diagnostics: { source: 'preset' },
    });
  }

  return structuredFloorPlanSchema.parse({
    schemaVersion: '1.0',
    width: 8,
    depth: 6,
    scaleMetersPerPixel: null,
    scaleEstimated: false,
    walls: [
      ...outerWalls(8, 6),
      { id: 'wall-bedroom', start: [5.5, 0], end: [5.5, 3.9], thickness: 0.14, height: 2.8 },
    ],
    openings: [
      { id: 'entrance', kind: 'door', wallId: 'wall-south', offset: 0.5, width: 1, height: 2.15 },
      { id: 'bedroom-door', kind: 'door', wallId: 'wall-bedroom', offset: 0.78, width: 0.86, height: 2.1 },
      { id: 'main-window', kind: 'window', wallId: 'wall-north', offset: 0.34, width: 2.1, height: 1.25, sillHeight: 0.9 },
    ],
    rooms: [
      { id: 'room-living', kind: 'living-room', label: '客餐厅', polygon: [[0, 0], [5.5, 0], [5.5, 6], [0, 6]], confidence: 1 },
      { id: 'room-bedroom', kind: 'bedroom', label: '卧室', polygon: [[5.5, 0], [8, 0], [8, 3.9], [5.5, 3.9]], confidence: 1 },
    ],
    entrance: { position: [4, 6], direction: [0, -1] },
    confidence: 1,
    diagnostics: { source: 'preset' },
  });
}
