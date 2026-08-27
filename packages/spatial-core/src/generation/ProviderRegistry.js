import { FrameworkError } from '../errors/FrameworkError.js';

export class ProviderRegistry {
  #providers = new Map();

  register(provider) {
    if (!provider?.id || typeof provider.generate !== 'function') {
      throw new FrameworkError('invalid_provider', 'Provider requires id and generate(request, context)');
    }
    this.#providers.set(provider.id, provider);
    return () => this.#providers.delete(provider.id);
  }

  resolve(request) {
    if (request.providerId) {
      const provider = this.#providers.get(request.providerId);
      if (!provider) throw new FrameworkError('provider_missing', `Generation provider not found: ${request.providerId}`);
      return provider;
    }

    const provider = [...this.#providers.values()].find((candidate) => (
      typeof candidate.supports !== 'function' || candidate.supports(request)
    ));
    if (!provider) throw new FrameworkError('provider_unavailable', 'No generation provider supports this request');
    return provider;
  }
}
