import { describe, expect, it } from 'vitest';
import {
  generationCompletedEventSchema,
  generationRequestedEventSchema,
} from '@spatial-intelligence/contracts';
import { InMemoryPlatformRepository } from './inMemoryGenerationJobRepository.js';

describe('InMemoryPlatformRepository projection', () => {
  it('projects a completed event into queryable generation job state', async () => {
    const repository = new InMemoryPlatformRepository();
    const jobId = 'b9614261-b9c6-405d-8072-4e91bdb83377';
    const requested = generationRequestedEventSchema.parse({
      eventId: '7b1f5b4a-34ca-4b55-9e32-dc22f1139399',
      eventType: 'generation.requested',
      version: 1,
      occurredAt: '2026-08-27T00:00:00.000Z',
      traceId: '5817113d-af75-4204-8054-e66077641497',
      correlationId: 'a2609f84-6325-4622-9cb9-4f0bde206460',
      causationId: null,
      payload: {
        jobId,
        idempotencyKey: 'request-001',
        request: {
          requestId: 'request-001',
          sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
        },
      },
    });
    await repository.createGenerationJob({
      jobId,
      idempotencyKey: 'request-001',
      now: '2026-08-27T00:00:00.000Z',
      request: requested.payload.request,
    }, requested);

    await repository.apply(generationCompletedEventSchema.parse({
      eventId: '93af5da9-45a3-4a73-ab77-136d83880a81',
      eventType: 'generation.completed',
      version: 1,
      occurredAt: '2026-08-27T00:01:00.000Z',
      traceId: requested.traceId,
      correlationId: requested.correlationId,
      causationId: requested.eventId,
      payload: {
        jobId,
        manifest: { schemaVersion: '1.0', sceneId: 'generated-scene-001' },
      },
    }));
    expect(await repository.findGenerationJob(jobId)).toMatchObject({
      status: 'complete',
      progress: 1,
      sceneId: 'generated-scene-001',
    });
  });
});
