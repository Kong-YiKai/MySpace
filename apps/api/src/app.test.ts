import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InMemoryPlatformRepository } from './inMemoryGenerationJobRepository.js';
import { JobEventBroker } from './jobEventBroker.js';
import type { AssetRecord, ObjectStorage } from './ports.js';

class FakeStorage implements ObjectStorage {
  async createUploadUrl(asset: AssetRecord): Promise<string> {
    return `https://storage.example.test/${asset.storageKey}`;
  }
  async verifyUploadedObject(): Promise<void> {}
}

const dependencies = () => ({
  repository: new InMemoryPlatformRepository(),
  storage: new FakeStorage(),
  events: new JobEventBroker(),
  now: () => '2026-08-27T00:00:00.000Z',
  createId: () => crypto.randomUUID(),
});

describe('Iteration 2 housing API', () => {
  it('creates a signed upload intent and an asynchronous validation job in the outbox', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/assets/upload-intents',
      payload: {
        kind: 'floor-plan',
        fileName: 'home.png',
        mediaType: 'image/png',
        sizeBytes: 2048,
      },
    });
    expect(intent.statusCode).toBe(201);
    expect(intent.json().uploadUrl).toContain('storage.example.test');

    const validation = await app.inject({
      method: 'POST',
      url: '/v1/floor-plans/validate',
      payload: { assetId: intent.json().assetId },
    });
    expect(validation.statusCode).toBe(202);
    expect(validation.json().status).toBe('accepted');
    const outbox = await deps.repository.takeOutboxBatch(10);
    expect(outbox[0]?.event.eventType).toBe('floor-plan.validation-requested');
    await app.close();
  });

  it('creates preset housing sessions through the same shell generation provider', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/housing-sessions',
      payload: { source: { kind: 'preset', preset: 'studio' } },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'shell-generating' });
    const outbox = await deps.repository.takeOutboxBatch(10);
    expect(outbox[0]?.event.eventType).toBe('generation.requested');
    if (outbox[0]?.event.eventType === 'generation.requested') {
      expect(outbox[0].event.payload.request.providerId).toBe('shell-provider');
      expect(outbox[0].event.payload.request.requirements).toHaveProperty('floorPlan');
    }
    await app.close();
  });

  it('deduplicates generic generation jobs by idempotency key', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const request = {
      method: 'POST' as const,
      url: '/v1/generation-jobs',
      headers: { 'idempotency-key': 'same-request' },
      payload: {
        requestId: 'request-001',
        sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
      },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().jobId).toBe(first.json().jobId);
    expect(await deps.repository.takeOutboxBatch(10)).toHaveLength(1);
    await app.close();
  });
});
