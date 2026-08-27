import { generationRequestSchema } from '../schema/generation.schema.js';
import { parseSceneManifest } from '../schema/sceneManifest.schema.js';

export class GenerationPipeline {
  /**
   * @param {{ providers?: any, persistence?: any }} [dependencies]
   */
  constructor({ providers, persistence = null } = {}) {
    this.providers = providers;
    this.persistence = persistence;
  }

  /**
   * @param {unknown} rawRequest
   * @param {{ signal?: AbortSignal, onProgress?: (event: Record<string, unknown>) => void }} [options]
   */
  async generate(rawRequest, { signal, onProgress = () => {} } = {}) {
    const request = generationRequestSchema.parse(rawRequest);
    const provider = this.providers.resolve(request);
    onProgress({ stage: 'accepted', progress: 0, providerId: provider.id });

    const result = await provider.generate(request, {
      signal,
      onProgress: (event) => onProgress({ ...event, providerId: provider.id }),
    });

    onProgress({ stage: 'normalizing', progress: 0.9, providerId: provider.id });
    const manifest = parseSceneManifest(result.manifest ?? result);

    if (this.persistence) {
      await this.persistence.saveManifest(manifest, { request, providerId: provider.id });
    }

    onProgress({ stage: 'complete', progress: 1, providerId: provider.id, sceneId: manifest.sceneId });
    return manifest;
  }
}
