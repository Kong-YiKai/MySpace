import { describe, expect, it } from 'vitest';
import { sceneManifestSchema } from '@spatial-intelligence/contracts';
import { deriveSpatialAnchorSet } from './spatialAnchors.js';

describe('spatial anchor locking', () => {
  it('derives deterministic bounds and entrance from a normalized shell manifest', () => {
    const manifest = sceneManifestSchema.parse({
      schemaVersion: '1.0',
      sceneId: 'scene-1',
      revision: 3,
      entities: [
        {
          id: 'floor', label: 'floor', kind: 'floor', tags: ['shell'],
          transform: { position: [0, -0.05, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          components: { primitive: { shape: 'box', size: [8, 0.1, 6] } },
        },
        {
          id: 'entrance', label: 'entrance', kind: 'anchor', tags: ['entrance'],
          transform: { position: [0, 0, 2.8], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          components: { direction: { value: [0, -1] } },
        },
      ],
    });
    const first = deriveSpatialAnchorSet(manifest);
    const second = deriveSpatialAnchorSet(manifest);
    expect(first.bounds).toEqual({ min: [-4, -0.1, -3], max: [4, 0, 3] });
    expect(first.entrance.direction).toEqual([0, 0, -1]);
    expect(first.shellRevision).toBe(3);
    expect(first.lockHash).toBe(second.lockHash);
  });

  it('refuses to lock a scene without a real entrance anchor', () => {
    const manifest = sceneManifestSchema.parse({
      schemaVersion: '1.0',
      sceneId: 'scene-1',
      entities: [{
        id: 'floor', label: 'floor', kind: 'floor', tags: [],
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: { primitive: { shape: 'box', size: [8, 0.1, 6] } },
      }],
    });
    expect(() => deriveSpatialAnchorSet(manifest)).toThrow(/入口/);
  });
});
