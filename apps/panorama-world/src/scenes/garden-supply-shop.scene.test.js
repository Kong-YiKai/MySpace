import { describe, expect, it } from 'vitest';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { gardenSupplyShopScene } from './garden-supply-shop.scene.js';

describe('gardenSupplyShopScene', () => {
  it('keeps the panorama background and truck interface as separate assets', () => {
    const scene = parseSceneManifest(gardenSupplyShopScene);
    const truck = scene.entities.find((entity) => entity.id === 'garden-supply-truck');

    expect(scene.assets).toContainEqual(expect.objectContaining({
      id: 'garden-supply-shop-empty-panorama-v1',
      metadata: expect.objectContaining({ projection: 'equirectangular' }),
    }));
    expect(truck.assetRefs).toEqual(['garden-supply-truck-interactive-v1']);
    expect(truck.components.panoramaSprite.assetId).toBe('garden-supply-truck-interactive-v1');
    expect(scene.entities.some((entity) => entity.kind === 'character')).toBe(false);
  });
});
