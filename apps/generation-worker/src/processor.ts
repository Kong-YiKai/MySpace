import { randomUUID } from 'node:crypto';
import {
  generationCompletedEventSchema,
  generationFailedEventSchema,
  generationProgressedEventSchema,
  generationRequestedEventSchema,
  type GenerationRequestedEvent,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import { GenerationPipeline } from '@spatial-intelligence/core';

export interface WorkerEventPublisher {
  publish(event: PlatformEvent): Promise<void>;
}

interface GenerationProcessorDependencies {
  pipeline: GenerationPipeline;
  publisher: WorkerEventPublisher;
  now?: () => string;
  createId?: () => string;
}

export class GenerationProcessor {
  readonly #pipeline: GenerationPipeline;
  readonly #publisher: WorkerEventPublisher;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor({
    pipeline,
    publisher,
    now = () => new Date().toISOString(),
    createId = randomUUID,
  }: GenerationProcessorDependencies) {
    this.#pipeline = pipeline;
    this.#publisher = publisher;
    this.#now = now;
    this.#createId = createId;
  }

  async process(rawEvent: unknown): Promise<void> {
    const event = generationRequestedEventSchema.parse(rawEvent);
    const progressPublishes: Promise<void>[] = [];

    try {
      const manifest = await this.#pipeline.generate(event.payload.request, {
        onProgress: (progress: Record<string, unknown>) => {
          const status = progress.stage;
          if (status !== 'accepted' && status !== 'generating' && status !== 'normalizing') return;
          const progressEvent = generationProgressedEventSchema.parse({
            ...this.#metadata(event, 'generation.progressed'),
            payload: {
              jobId: event.payload.jobId,
              status,
              progress: typeof progress.progress === 'number' ? progress.progress : 0,
              providerId: typeof progress.providerId === 'string' ? progress.providerId : undefined,
              message: typeof progress.message === 'string' ? progress.message : undefined,
            },
          });
          progressPublishes.push(this.#publisher.publish(progressEvent));
        },
      });

      await Promise.all(progressPublishes);
      await this.#publisher.publish(generationCompletedEventSchema.parse({
        ...this.#metadata(event, 'generation.completed'),
        payload: { jobId: event.payload.jobId, manifest },
      }));
    } catch (error) {
      await Promise.allSettled(progressPublishes);
      await this.#publisher.publish(generationFailedEventSchema.parse({
        ...this.#metadata(event, 'generation.failed'),
        payload: {
          jobId: event.payload.jobId,
          errorCode: errorCode(error),
          errorMessage: error instanceof Error ? error.message : 'Unknown generation failure',
          retryable: false,
        },
      }));
    }
  }

  #metadata(
    source: GenerationRequestedEvent,
    eventType: PlatformEvent['eventType'],
  ): Record<string, unknown> {
    return {
      eventId: this.#createId(),
      eventType,
      version: 1,
      occurredAt: this.#now(),
      traceId: source.traceId,
      correlationId: source.correlationId,
      causationId: source.eventId,
    };
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'generation_failed';
}
