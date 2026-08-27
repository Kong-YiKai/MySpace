import { describe, expect, it } from 'vitest';
import type { PlatformEvent } from '@spatial-intelligence/contracts';
import { GenerationPipeline, ProviderRegistry } from '@spatial-intelligence/core';
import { GenerationProcessor, type WorkerEventPublisher } from './processor.js';

class RecordingPublisher implements WorkerEventPublisher {
  readonly events: PlatformEvent[] = [];
  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(event);
  }
}

const requestedEvent = {
  eventId: '7b1f5b4a-34ca-4b55-9e32-dc22f1139399',
  eventType: 'generation.requested' as const,
  version: 1 as const,
  occurredAt: '2026-08-27T00:00:00.000Z',
  traceId: '5817113d-af75-4204-8054-e66077641497',
  correlationId: 'a2609f84-6325-4622-9cb9-4f0bde206460',
  causationId: null,
  payload: {
    jobId: 'b9614261-b9c6-405d-8072-4e91bdb83377',
    idempotencyKey: 'request-001',
    request: {
      requestId: 'request-001',
      sources: [{ id: 'prompt', type: 'text' as const, content: 'Generate a world' }],
    },
  },
};

describe('GenerationProcessor', () => {
  it('closes the fake-provider generation loop with progress and completion events', async () => {
    const providers = new ProviderRegistry();
    providers.register({
      id: 'fake-provider',
      generate: async () => ({
        schemaVersion: '1.0',
        sceneId: 'generated-scene-001',
      }),
    });
    const publisher = new RecordingPublisher();
    const processor = new GenerationProcessor({
      pipeline: new GenerationPipeline({ providers }),
      publisher,
      now: () => '2026-08-27T00:00:00.000Z',
      createId: () => crypto.randomUUID(),
    });

    await processor.process(requestedEvent);

    expect(publisher.events.map((event) => event.eventType)).toEqual([
      'generation.progressed',
      'generation.progressed',
      'generation.completed',
    ]);
    expect(publisher.events.at(-1)?.eventType).toBe('generation.completed');
  });
});
