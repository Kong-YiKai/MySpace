import { describe, expect, it } from 'vitest';
import { generationCompletedEventSchema } from '@spatial-intelligence/contracts';
import { InMemoryGenerationJobRepository } from './inMemoryGenerationJobRepository.js';

describe('InMemoryGenerationJobRepository projection', () => {
  it('projects a completed event into queryable job state', async () => {
    const jobs = new InMemoryGenerationJobRepository();
    const jobId = 'b9614261-b9c6-405d-8072-4e91bdb83377';
    await jobs.create({
      jobId,
      idempotencyKey: 'request-001',
      now: '2026-08-27T00:00:00.000Z',
      request: {
        requestId: 'request-001',
        sources: [{ id: 'prompt', type: 'text', content: 'Generate a world', metadata: {} }],
        quality: 'standard',
        requirements: {},
        metadata: {},
      },
    });

    await jobs.apply(generationCompletedEventSchema.parse({
      eventId: '7b1f5b4a-34ca-4b55-9e32-dc22f1139399',
      eventType: 'generation.completed',
      version: 1,
      occurredAt: '2026-08-27T00:01:00.000Z',
      traceId: '5817113d-af75-4204-8054-e66077641497',
      correlationId: 'a2609f84-6325-4622-9cb9-4f0bde206460',
      causationId: null,
      payload: {
        jobId,
        manifest: { schemaVersion: '1.0', sceneId: 'generated-scene-001' },
      },
    }));

    expect(await jobs.findById(jobId)).toMatchObject({
      status: 'complete',
      progress: 1,
      sceneId: 'generated-scene-001',
    });
  });
});
