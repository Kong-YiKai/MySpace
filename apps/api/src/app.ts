import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  generationRequestSchema,
  generationRequestedEventSchema,
} from '@spatial-intelligence/contracts';
import type { EventPublisher, GenerationJobRepository } from './ports.js';

interface AppDependencies {
  jobs: GenerationJobRepository;
  publisher: EventPublisher;
  now?: () => string;
  createId?: () => string;
}

export function createApp({
  jobs,
  publisher,
  now = () => new Date().toISOString(),
  createId = randomUUID,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  app.get('/ready', async () => ({ status: 'ready', service: 'api' }));

  app.post('/v1/generation-jobs', async (request, reply) => {
    const parsed = generationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_generation_request',
        issues: parsed.error.issues,
      });
    }

    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string'
      ? idempotencyHeader
      : parsed.data.requestId;
    const jobId = createId();
    const timestamp = now();
    const result = await jobs.create({
      jobId,
      request: parsed.data,
      idempotencyKey,
      now: timestamp,
    });

    if (result.created) {
      const traceId = headerUuid(request.headers['x-trace-id']) ?? createId();
      const correlationId = headerUuid(request.headers['x-correlation-id']) ?? createId();
      const event = generationRequestedEventSchema.parse({
        eventId: createId(),
        eventType: 'generation.requested',
        version: 1,
        occurredAt: timestamp,
        traceId,
        correlationId,
        causationId: null,
        payload: {
          jobId: result.job.jobId,
          idempotencyKey,
          request: parsed.data,
        },
      });
      await publisher.publish(event);
    }

    return reply.code(result.created ? 202 : 200).send(result.job);
  });

  app.get<{ Params: { jobId: string } }>('/v1/generation-jobs/:jobId', async (request, reply) => {
    const job = await jobs.findById(request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'generation_job_not_found' });
    return job;
  });

  return app;
}

function headerUuid(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
