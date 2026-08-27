import {
  generationJobSchema,
  type GenerationJob,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import type {
  CreateGenerationJobInput,
  CreateGenerationJobResult,
  GenerationJobRepository,
} from './ports.js';

export class InMemoryGenerationJobRepository implements GenerationJobRepository {
  readonly #byId = new Map<string, GenerationJob>();
  readonly #idByIdempotencyKey = new Map<string, string>();

  async create(input: CreateGenerationJobInput): Promise<CreateGenerationJobResult> {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return { job: existing, created: false };

    const job = generationJobSchema.parse({
      jobId: input.jobId,
      requestId: input.request.requestId,
      idempotencyKey: input.idempotencyKey,
      status: 'accepted',
      progress: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });

    this.#byId.set(job.jobId, job);
    this.#idByIdempotencyKey.set(job.idempotencyKey, job.jobId);
    return { job, created: true };
  }

  async findById(jobId: string): Promise<GenerationJob | null> {
    return this.#byId.get(jobId) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<GenerationJob | null> {
    const jobId = this.#idByIdempotencyKey.get(idempotencyKey);
    return jobId ? this.findById(jobId) : null;
  }

  async apply(event: PlatformEvent): Promise<GenerationJob | null> {
    if (event.eventType === 'generation.requested' || event.eventType === 'scene.revision-created') {
      return null;
    }

    const current = await this.findById(event.payload.jobId);
    if (!current) return null;

    let next: GenerationJob;
    switch (event.eventType) {
      case 'generation.progressed':
        next = generationJobSchema.parse({
          ...current,
          status: event.payload.status,
          progress: event.payload.progress,
          updatedAt: event.occurredAt,
        });
        break;
      case 'generation.completed':
        next = generationJobSchema.parse({
          ...current,
          status: 'complete',
          progress: 1,
          sceneId: event.payload.manifest.sceneId,
          updatedAt: event.occurredAt,
        });
        break;
      case 'generation.failed':
        next = generationJobSchema.parse({
          ...current,
          status: 'failed',
          errorCode: event.payload.errorCode,
          errorMessage: event.payload.errorMessage,
          updatedAt: event.occurredAt,
        });
        break;
    }

    this.#byId.set(next.jobId, next);
    return next;
  }
}
