import { describe, expect, it } from 'vitest';
import type { PlatformEvent } from '@spatial-intelligence/contracts';
import { createApp } from './app.js';
import { InMemoryGenerationJobRepository } from './inMemoryGenerationJobRepository.js';
import type { EventPublisher } from './ports.js';

class RecordingPublisher implements EventPublisher {
  readonly events: PlatformEvent[] = [];
  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(event);
  }
}

describe('generation jobs API', () => {
  it('creates one asynchronous job and publishes one request event', async () => {
    const publisher = new RecordingPublisher();
    const ids = [
      'b9614261-b9c6-405d-8072-4e91bdb83377',
      '5817113d-af75-4204-8054-e66077641497',
      'a2609f84-6325-4622-9cb9-4f0bde206460',
      '7b1f5b4a-34ca-4b55-9e32-dc22f1139399',
    ];
    const app = createApp({
      jobs: new InMemoryGenerationJobRepository(),
      publisher,
      now: () => '2026-08-27T00:00:00.000Z',
      createId: () => ids.shift()!,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/generation-jobs',
      headers: { 'idempotency-key': 'client-request-001' },
      payload: {
        requestId: 'request-001',
        sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.eventType).toBe('generation.requested');
    await app.close();
  });

  it('deduplicates requests by idempotency key', async () => {
    const publisher = new RecordingPublisher();
    const app = createApp({
      jobs: new InMemoryGenerationJobRepository(),
      publisher,
      createId: () => crypto.randomUUID(),
    });
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
    expect(publisher.events).toHaveLength(1);
    await app.close();
  });
});
