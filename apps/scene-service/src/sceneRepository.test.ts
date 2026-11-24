import { describe, expect, it } from 'vitest';
import { sceneManifestSchema } from '@spatial-intelligence/contracts';
import { mergeVisualLayerManifest } from './sceneRepository.js';

const base = sceneManifestSchema.parse({
  schemaVersion: '1.0',
  sceneId: 'scene-1',
  revision: 4,
  coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
  sourceRefs: ['floor-plan'],
  assets: [
    { id: 'shell', kind: 'mesh', uri: '/shell.glb', format: 'glb', metadata: { role: 'shell-mesh' } },
    { id: 'chair', kind: 'mesh', uri: '/chair.glb', format: 'glb', metadata: { role: 'lux3d-interactive-object' } },
  ],
  entities: [
    { id: 'wall', label: 'wall', kind: 'wall', assetRefs: ['shell'], components: {}, tags: ['structural'], interactive: false },
    { id: 'chair', label: 'chair', kind: 'furniture:chair', assetRefs: ['chair'], components: {}, tags: ['furniture', 'lux3d'], interactive: true },
  ],
  metadata: { shellLockHash: 'lock-1' },
});

const visual = sceneManifestSchema.parse({
  ...base,
  revision: 1,
  sourceRefs: ['aholo-source'],
  assets: [
    ...base.assets.filter((asset) => asset.id === 'shell'),
    { id: 'splat', kind: 'splat', uri: 'https://example.com/world.spz', format: 'spz', metadata: { role: 'shell-splat', visualLayer: 'aholo-3dgs' } },
  ],
  entities: [
    base.entities[0],
    { id: 'splat-shell', label: 'Aholo', kind: 'splat-shell', assetRefs: ['splat'], components: {}, tags: ['aholo-visual-layer'], interactive: false },
  ],
  metadata: { visualLayer: { providerId: 'aholo-world', assetId: 'splat' } },
});

describe('mergeVisualLayerManifest', () => {
  it('adds a late visual layer without overwriting assembled Lux3D entities', () => {
    const merged = mergeVisualLayerManifest(base, visual);

    expect(merged.revision).toBe(5);
    expect(merged.assets.map((asset) => asset.id)).toEqual(['shell', 'chair', 'splat']);
    expect(merged.entities.map((entity) => entity.id)).toEqual(['wall', 'chair', 'splat-shell']);
    expect(merged.metadata.shellLockHash).toBe('lock-1');
    expect(merged.metadata.visualLayer).toEqual({ providerId: 'aholo-world', assetId: 'splat' });
  });
});
