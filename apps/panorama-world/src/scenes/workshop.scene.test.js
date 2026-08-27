import { describe, expect, it } from 'vitest';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { brightApartmentScene } from './bright-apartment.scene.js';
import { workshopScene } from './workshop.scene.js';

describe('workshopScene', () => {
  it('keeps the panorama experience inside the shared SceneManifest contract', () => {
    const scene = parseSceneManifest(workshopScene);

    expect(scene.assets).toContainEqual(expect.objectContaining({
      id: 'workshop-panorama',
      kind: 'texture',
      format: 'jpeg',
    }));
    expect(scene.entities.filter((entity) => entity.interactive)).toHaveLength(4);
    expect(scene.entities.every((entity) => entity.components.panoramaMarker)).toBe(true);
    expect(scene.entities).toContainEqual(expect.objectContaining({
      id: 'workshop-caretaker',
      kind: 'character',
      components: expect.objectContaining({
        character: expect.objectContaining({
          sprites: expect.objectContaining({
            idle: '/characters/workshop-caretaker-idle-v2.png',
            speaking: '/characters/workshop-caretaker-speaking-v2.png',
            surprised: '/characters/workshop-caretaker-surprised-v2.png',
            listening: '/characters/workshop-caretaker-listening-v2.png',
          }),
        }),
      }),
    }));
  });

  it('keeps both scene exits inside the available prebuilt scene graph', () => {
    const scenes = [workshopScene, brightApartmentScene].map(parseSceneManifest);
    const sceneIds = new Set(scenes.map((scene) => scene.sceneId));

    for (const scene of scenes) {
      for (const entity of scene.entities) {
        const targetSceneId = entity.components.interaction?.targetSceneId;
        if (targetSceneId) expect(sceneIds.has(targetSceneId)).toBe(true);
      }
    }
  });
});
