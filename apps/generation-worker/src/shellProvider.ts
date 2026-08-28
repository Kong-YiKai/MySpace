import { structuredFloorPlanSchema, type StructuredFloorPlan } from '@spatial-intelligence/contracts';

interface Entity {
  id: string;
  label: string;
  kind: string;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  components: Record<string, unknown>;
  tags: string[];
}

export const shellProvider = {
  id: 'shell-provider',
  supports: (request: { providerId?: string; requirements?: Record<string, unknown> }) => (
    request.providerId === 'shell-provider' || request.requirements?.kind === 'housing-shell'
  ),
  generate: async (
    request: { requestId: string; sources: Array<{ id: string }>; requirements: Record<string, unknown> },
    context: { onProgress: (event: Record<string, unknown>) => void },
  ) => {
    const plan = structuredFloorPlanSchema.parse(request.requirements.floorPlan);
    context.onProgress({ stage: 'generating', progress: 0.36, message: '正在建立地面与房间边界…' });
    const entities = buildShellEntities(plan);
    context.onProgress({ stage: 'generating', progress: 0.72, message: '正在生成墙体、门窗与入口锚点…' });

    return {
      schemaVersion: '1.0',
      sceneId: `scene-${request.requestId}`,
      revision: 0,
      sourceRefs: request.sources.map((source) => source.id),
      entities,
      environment: {
        background: '#f8f5ef',
        ambientLight: { color: '#fff8ee', intensity: 1.08 },
      },
      metadata: {
        kind: 'housing-shell',
        floorPlan: plan,
        entrance: plan.entrance,
      },
    };
  },
};

export function buildShellEntities(plan: StructuredFloorPlan): Entity[] {
  const centerX = plan.width / 2;
  const centerZ = plan.depth / 2;
  const entities: Entity[] = [{
    id: 'floor',
    label: '毛坯地面',
    kind: 'floor',
    transform: identity([0, -0.06, 0]),
    components: {
      primitive: { shape: 'box', size: [plan.width, 0.12, plan.depth] },
      appearance: { color: '#e9e4da', roughness: 0.96 },
    },
    tags: ['shell', 'floor'],
  }];

  for (const wall of plan.walls) {
    const openings = plan.openings
      .filter((opening) => opening.wallId === wall.id)
      .sort((left, right) => left.offset - right.offset);
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const rotation: [number, number, number, number] = [0, -Math.sin(angle / 2), 0, Math.cos(angle / 2)];
    const ux = dx / length;
    const uz = dz / length;
    let cursor = 0;
    let spanIndex = 0;

    const addSpan = (from: number, to: number, bottom: number, height: number, suffix: string) => {
      if (to - from < 0.02 || height < 0.02) return;
      const along = (from + to) / 2;
      entities.push({
        id: `${wall.id}-${suffix}-${spanIndex++}`,
        label: wall.id,
        kind: 'wall',
        transform: {
          position: [wall.start[0] + ux * along - centerX, bottom + height / 2, wall.start[1] + uz * along - centerZ],
          rotation,
          scale: [1, 1, 1],
        },
        components: {
          primitive: { shape: 'box', size: [to - from, height, wall.thickness] },
          appearance: { color: '#f1eee6', roughness: 0.92 },
        },
        tags: ['shell', 'wall'],
      });
    };

    for (const opening of openings) {
      const middle = opening.offset * length;
      const from = Math.max(cursor, middle - opening.width / 2);
      const to = Math.min(length, middle + opening.width / 2);
      addSpan(cursor, from, 0, wall.height, 'span');
      if (opening.sillHeight > 0) addSpan(from, to, 0, opening.sillHeight, 'sill');
      const top = opening.sillHeight + opening.height;
      if (top < wall.height) addSpan(from, to, top, wall.height - top, 'lintel');
      if (opening.kind === 'window') {
        const along = (from + to) / 2;
        entities.push({
          id: opening.id,
          label: '窗',
          kind: 'window',
          transform: {
            position: [wall.start[0] + ux * along - centerX, opening.sillHeight + opening.height / 2, wall.start[1] + uz * along - centerZ],
            rotation,
            scale: [1, 1, 1],
          },
          components: {
            primitive: { shape: 'box', size: [to - from, opening.height, 0.045] },
            appearance: { color: '#dfe9e8', roughness: 0.2, transparent: true, opacity: 0.7 },
          },
          tags: ['shell', 'window'],
        });
      }
      cursor = to;
    }
    addSpan(cursor, length, 0, wall.height, 'span');
  }

  entities.push({
    id: 'entrance-anchor',
    label: '户型入口',
    kind: 'anchor',
    transform: identity([plan.entrance.position[0] - centerX, 0, plan.entrance.position[1] - centerZ]),
    components: { direction: { value: plan.entrance.direction } },
    tags: ['entrance'],
  });
  return entities;
}

function identity(position: [number, number, number]): Entity['transform'] {
  return { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
}
