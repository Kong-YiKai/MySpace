import { describe, expect, it } from 'vitest';
import { GenerationPipeline } from './GenerationPipeline.js';
import { ProviderRegistry } from './ProviderRegistry.js';

describe('GenerationPipeline', () => {
  it.each([
    { id: 'text', type: 'text', content: 'A world that reacts to sound' },
    { id: 'image', type: 'image', uri: 'memory://reference.png' },
    { id: 'video', type: 'video', uri: 'memory://capture.mp4' },
  ])('accepts $type as a first-class generation source', async (source) => {
    const providers = new ProviderRegistry();
    providers.register({
      id: 'fake-provider',
      supports: () => true,
      generate: async (request) => ({
        schemaVersion: '1.0',
        sceneId: `scene-from-${request.sources[0].type}`,
        sourceRefs: request.sources.map((item) => item.id),
      }),
    });

    const pipeline = new GenerationPipeline({ providers });
    const result = await pipeline.generate({ requestId: `request-${source.id}`, sources: [source] });
    expect(result.sceneId).toBe(`scene-from-${source.type}`);
  });
});
