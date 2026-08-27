import {
  BehaviorRegistry,
  ProviderRegistry,
  GenerationPipeline,
  SpatialRuntime,
} from '../src/index.js';

const providers = new ProviderRegistry();
providers.register({
  id: 'contract-check',
  generate: async (request) => ({
    schemaVersion: '1.0',
    sceneId: 'contract-check-scene',
    sourceRefs: request.sources.map((source) => source.id),
  }),
});

const manifest = await new GenerationPipeline({ providers }).generate({
  requestId: 'contract-check',
  sources: [{ id: 'prompt', type: 'text', content: 'A generated interactive scene' }],
});

const runtime = new SpatialRuntime({ manifest, behaviors: new BehaviorRegistry() });
await runtime.execute({
  commandId: 'contract-check-command',
  commands: [{ type: 'SET_ENVIRONMENT_PROPERTY', key: 'frameworkReady', value: true }],
});

if (runtime.getManifest().environment.frameworkReady !== true) {
  throw new Error('Framework contract check failed');
}

console.log('Spatial Intelligence Core contract check passed.');

