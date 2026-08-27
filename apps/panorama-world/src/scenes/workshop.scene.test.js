import { describe, expect, it } from 'vitest';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { workshopScene } from './workshop.scene.js';

describe('workshopScene', () => {
  it('keeps the panorama experience inside the shared SceneManifest contract', () => {
    const scene = parseSceneManifest(workshopScene);

    expect(scene.assets).toContainEqual(expect.objectContaining({
      id: 'workshop-panorama',
      kind: 'texture',
      format: 'jpeg',
    }));
    expect(scene.entities.filter((entity) => entity.interactive)).toHaveLength(3);
    expect(scene.entities.every((entity) => entity.components.panoramaMarker)).toBe(true);
  });
});
