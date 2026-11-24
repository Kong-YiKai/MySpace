import { describe, expect, it } from 'vitest';
import { BehaviorRegistry } from '../behavior/BehaviorRegistry.js';
import { SpatialRuntime } from './SpatialRuntime.js';

const manifest = {
  schemaVersion: '1.0',
  sceneId: 'scene-any-domain',
  assets: [{ id: 'asset-1', kind: 'mesh', uri: 'memory://asset.glb' }],
  entities: [{ id: 'entity-1', kind: 'generated-object', assetRefs: ['asset-1'], interactive: true }],
  behaviors: [{
    id: 'behavior-1',
    handler: 'set-state',
    targetEntityIds: ['entity-1'],
    trigger: { eventType: 'activate' },
  }],
  interactions: [{ id: 'binding-1', inputType: 'pointer', eventType: 'activate', behaviorId: 'behavior-1' }],
};

describe('SpatialRuntime', () => {
  it('applies generic scene changes transactionally and can undo', async () => {
    const runtime = new SpatialRuntime({ manifest });
    await runtime.execute({
      commandId: 'change-1',
      baseRevision: 0,
      commands: [{ type: 'SET_COMPONENT', entityId: 'entity-1', component: 'customState', value: { active: true } }],
    });

    expect(runtime.revision).toBe(1);
    expect(runtime.getManifest().entities[0].components.customState).toEqual({ active: true });
    await runtime.undo();
    expect(runtime.getManifest().entities[0].components.customState).toBeUndefined();
  });

  it('maps an external interaction to a registered user behavior', async () => {
    const behaviors = new BehaviorRegistry();
    behaviors.register('set-state', ({ behavior, payload }) => [{
      type: 'SET_COMPONENT',
      entityId: behavior.targetEntityIds[0],
      component: 'interactionState',
      value: payload,
    }]);
    const runtime = new SpatialRuntime({ manifest, behaviors });
    await runtime.dispatchInteraction({ inputType: 'pointer', eventType: 'activate', payload: { value: 7 } });
    expect(runtime.getManifest().entities[0].components.interactionState).toEqual({ value: 7 });
  });

  it('adds a normalized provider asset and an entity in one atomic command envelope', async () => {
    const runtime = new SpatialRuntime({ manifest });
    await runtime.execute({
      commandId: 'add-provider-furniture',
      baseRevision: 0,
      commands: [
        {
          type: 'ADD_ASSET',
          asset: {
            id: 'lux-sofa',
            kind: 'mesh',
            uri: 's3://spatial-assets/normalized/sofa.glb',
            format: 'glb',
            metadata: { providerId: 'lux3d', normalized: true },
          },
        },
        {
          type: 'ADD_ENTITY',
          entity: { id: 'sofa', kind: 'furniture', assetRefs: ['lux-sofa'] },
        },
      ],
    });

    expect(runtime.getManifest().assets.at(-1)?.id).toBe('lux-sofa');
    expect(runtime.getManifest().entities.at(-1)?.assetRefs).toEqual(['lux-sofa']);
  });

  it('refuses to remove an asset while an entity still references it', async () => {
    const runtime = new SpatialRuntime({ manifest });
    await expect(runtime.execute({
      commandId: 'remove-in-use-asset',
      baseRevision: 0,
      commands: [{ type: 'REMOVE_ASSET', assetId: 'asset-1' }],
    })).rejects.toMatchObject({ code: 'asset_in_use' });
  });
});
