import { describe, expect, it } from 'vitest';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { getPanoramaDescriptor } from './panorama-source.js';
import { gardenSupplyShopScene } from './scenes/garden-supply-shop.scene.js';
import { graveGateScene } from './scenes/grave-gate.scene.js';

describe('getPanoramaDescriptor', () => {
  it('keeps the formal shop on the 2:1 equirectangular adapter', () => {
    const descriptor = getPanoramaDescriptor(parseSceneManifest(gardenSupplyShopScene));
    expect(descriptor).toEqual({
      projection: 'equirectangular',
      source: '/assets/garden-supply-shop-empty-panorama-v1.png',
    });
  });

  it('keeps the grave-gate entry on the same 2:1 adapter', () => {
    const descriptor = getPanoramaDescriptor(parseSceneManifest(graveGateScene));
    expect(descriptor).toEqual({
      projection: 'equirectangular',
      source: '/assets/grave-gate-panorama-v1.png',
    });
  });
});
