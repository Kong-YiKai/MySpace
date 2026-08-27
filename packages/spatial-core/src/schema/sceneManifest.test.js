import { describe, expect, it } from 'vitest';
import { parseSceneManifest } from './sceneManifest.schema.js';

const emptyScene = {
  schemaVersion: '1.0',
  sceneId: 'generated-scene',
};

describe('SceneManifest', () => {
  it('accepts a scene without assuming a domain or renderer', () => {
    const manifest = parseSceneManifest(emptyScene);
    expect(manifest.entities).toEqual([]);
    expect(manifest.coordinateSystem.upAxis).toBe('Y');
  });

  it('rejects an entity that references an unknown generated asset', () => {
    expect(() => parseSceneManifest({
      ...emptyScene,
      entities: [{ id: 'entity-1', kind: 'arbitrary-object', assetRefs: ['missing'] }],
    })).toThrow(/missing asset/i);
  });
});
