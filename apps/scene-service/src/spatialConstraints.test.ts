import { describe, expect, it } from 'vitest';
import {
  commandEnvelopeSchema,
  sceneManifestSchema,
  spatialAnchorSetSchema,
} from '@spatial-intelligence/contracts';
import { SpatialRuntime } from '@spatial-intelligence/core';
import { validateSceneMutation } from './spatialConstraints.js';

const manifest = sceneManifestSchema.parse({
  schemaVersion: '1.0',
  sceneId: 'scene-constraints',
  revision: 0,
  entities: [
    {
      id: 'floor', kind: 'floor', tags: ['shell', 'structural'],
      transform: { position: [0, -0.05, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: { primitive: { shape: 'box', size: [10, 0.1, 8] } },
    },
  ],
});

const anchors = spatialAnchorSetSchema.parse({
  schemaVersion: '1.0',
  sceneId: manifest.sceneId,
  shellRevision: 0,
  coordinateSystem: manifest.coordinateSystem,
  bounds: { min: [-5, -0.1, -4], max: [5, 3, 4] },
  walkableBounds: { min: [-4.8, 0, -3.8], max: [4.8, 0.1, 3.8] },
  entrance: { position: [0, 0, 3.8], direction: [0, 0, -1], cameraHeight: 1.65 },
  surfaces: [
    { anchorId: 'door-main', kind: 'door', bounds: { min: [-0.5, 0, 3.7], max: [0.5, 2.2, 3.9] } },
    { anchorId: 'window-east', kind: 'window', bounds: { min: [4.9, 0.8, -1], max: [5, 2.2, 1] } },
  ],
  provider: { providerId: 'test-shell', sourceAssetIds: [] },
  lockHash: 'a'.repeat(64),
});

const furniture = (id: string, position: [number, number, number]) => ({
  id,
  label: id,
  kind: 'furniture',
  parentId: null,
  transform: { position, rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] },
  assetRefs: [],
  components: { collider: { bounds: { min: [-0.8, 0, -0.4], max: [0.8, 1, 0.4] } } },
  tags: [],
  interactive: true,
});

async function mutate(commands: unknown[]) {
  const envelope = commandEnvelopeSchema.parse({ commandId: crypto.randomUUID(), baseRevision: 0, commands });
  const result = await new SpatialRuntime({ manifest }).execute(envelope);
  return { envelope, next: sceneManifestSchema.parse(result.manifest) };
}

describe('locked scene spatial constraints', () => {
  it('accepts furniture inside the room and away from the main path', async () => {
    const { envelope, next } = await mutate([{ type: 'ADD_ENTITY', entity: furniture('sofa', [3, 0, 0]) }]);
    expect(validateSceneMutation(manifest, next, envelope, anchors)).toMatchObject({ colliderCount: 1 });
  });

  it('rejects collisions between furniture assets', async () => {
    const { envelope, next } = await mutate([
      { type: 'ADD_ENTITY', entity: furniture('sofa', [3, 0, 0]) },
      { type: 'ADD_ENTITY', entity: furniture('chair', [3.5, 0, 0]) },
    ]);
    expect(() => validateSceneMutation(manifest, next, envelope, anchors))
      .toThrow(expect.objectContaining({ code: 'object_collision' }));
  });

  it('rejects furniture in the entrance door clearance', async () => {
    const { envelope, next } = await mutate([{ type: 'ADD_ENTITY', entity: furniture('cabinet', [0, 0, 3.2]) }]);
    expect(() => validateSceneMutation(manifest, next, envelope, anchors))
      .toThrow(expect.objectContaining({ code: 'door_clearance_blocked' }));
  });

  it('rejects transforms of locked shell entities', async () => {
    const { envelope, next } = await mutate([{
      type: 'SET_TRANSFORM', entityId: 'floor',
      transform: { position: [1, -0.05, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    }]);
    expect(() => validateSceneMutation(manifest, next, envelope, anchors))
      .toThrow(expect.objectContaining({ code: 'locked_structure_mutation' }));
  });
});
