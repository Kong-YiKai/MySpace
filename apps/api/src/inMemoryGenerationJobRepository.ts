import {
  floorPlanJobSchema,
  generationJobSchema,
  housingSessionSchema,
  structuredFloorPlanSchema,
  type FloorPlanJob,
  type GenerationJob,
  type HousingSession,
  type PlatformEvent,
  type StructuredFloorPlan,
} from '@spatial-intelligence/contracts';
import type {
  AppliedEventResult,
  AssetRecord,
  CreateAssetInput,
  CreateFloorPlanJobInput,
  CreateGenerationJobInput,
  CreateGenerationJobResult,
  CreateHousingSessionInput,
  OutboxRecord,
  PlatformRepository,
} from './ports.js';

type FloorPlanEvent = Extract<PlatformEvent, {
  eventType: 'floor-plan.validation-requested' | 'floor-plan.progressed' | 'floor-plan.validated' | 'floor-plan.rejected';
}>;

export class InMemoryPlatformRepository implements PlatformRepository {
  readonly #assets = new Map<string, AssetRecord>();
  readonly #floorPlanJobs = new Map<string, FloorPlanJob>();
  readonly #generationJobs = new Map<string, GenerationJob>();
  readonly #generationJobIdsByKey = new Map<string, string>();
  readonly #sessions = new Map<string, HousingSession>();
  readonly #outbox = new Map<string, OutboxRecord>();

  async createAsset(input: CreateAssetInput): Promise<AssetRecord> {
    const asset: AssetRecord = { ...input };
    this.#assets.set(asset.assetId, asset);
    return asset;
  }

  async findAsset(assetId: string): Promise<AssetRecord | null> {
    return this.#assets.get(assetId) ?? null;
  }

  async createFloorPlanJob(input: CreateFloorPlanJobInput): Promise<FloorPlanJob> {
    const job = floorPlanJobSchema.parse({
      jobId: input.jobId,
      assetId: input.asset.assetId,
      status: 'accepted',
      progress: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.#floorPlanJobs.set(job.jobId, job);
    this.#outbox.set(input.event.eventId, { eventId: input.event.eventId, event: input.event });
    return job;
  }

  async findFloorPlanJob(jobId: string): Promise<FloorPlanJob | null> {
    return this.#floorPlanJobs.get(jobId) ?? null;
  }

  async findValidatedPlan(assetId: string): Promise<StructuredFloorPlan | null> {
    const completed = [...this.#floorPlanJobs.values()]
      .filter((job) => job.assetId === assetId && job.status === 'complete' && job.plan)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return completed?.plan ?? null;
  }

  async createHousingSession(input: CreateHousingSessionInput): Promise<HousingSession> {
    const result = await this.createGenerationJob(input.job, input.event);
    const session = housingSessionSchema.parse({
      sessionId: input.sessionId,
      source: input.source,
      status: 'shell-generating',
      shellJobId: result.job.jobId,
      createdAt: input.job.now,
      updatedAt: input.job.now,
    });
    this.#sessions.set(session.sessionId, session);
    return session;
  }

  async findHousingSession(sessionId: string): Promise<HousingSession | null> {
    return this.#sessions.get(sessionId) ?? null;
  }

  async createGenerationJob(
    input: CreateGenerationJobInput,
    event: Extract<PlatformEvent, { eventType: 'generation.requested' }>,
  ): Promise<CreateGenerationJobResult> {
    const existing = await this.findGenerationJobByIdempotencyKey(input.idempotencyKey);
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
    this.#generationJobs.set(job.jobId, job);
    this.#generationJobIdsByKey.set(job.idempotencyKey, job.jobId);
    this.#outbox.set(event.eventId, { eventId: event.eventId, event });
    return { job, created: true };
  }

  async findGenerationJob(jobId: string): Promise<GenerationJob | null> {
    return this.#generationJobs.get(jobId) ?? null;
  }

  async findGenerationJobByIdempotencyKey(idempotencyKey: string): Promise<GenerationJob | null> {
    const jobId = this.#generationJobIdsByKey.get(idempotencyKey);
    return jobId ? this.findGenerationJob(jobId) : null;
  }

  async apply(event: PlatformEvent): Promise<AppliedEventResult> {
    if (event.eventType.startsWith('floor-plan.')) return this.#applyFloorPlanEvent(event as FloorPlanEvent);
    if (event.eventType === 'generation.requested' || event.eventType === 'scene.revision-created') return {};

    const current = await this.findGenerationJob(event.payload.jobId);
    if (!current) return {};
    let next = current;
    if (event.eventType === 'generation.progressed') {
      next = generationJobSchema.parse({ ...current, status: event.payload.status, progress: event.payload.progress, updatedAt: event.occurredAt });
    } else if (event.eventType === 'generation.completed') {
      next = generationJobSchema.parse({ ...current, status: 'complete', progress: 1, sceneId: event.payload.manifest.sceneId, updatedAt: event.occurredAt });
    } else if (event.eventType === 'generation.failed') {
      next = generationJobSchema.parse({ ...current, status: 'failed', errorCode: event.payload.errorCode, errorMessage: event.payload.errorMessage, updatedAt: event.occurredAt });
    }
    this.#generationJobs.set(next.jobId, next);

    const session = [...this.#sessions.values()].find((candidate) => candidate.shellJobId === next.jobId);
    if (session && event.eventType === 'generation.completed') {
      this.#sessions.set(session.sessionId, housingSessionSchema.parse({
        ...session,
        status: 'shell-ready',
        sceneId: event.payload.manifest.sceneId,
        manifest: event.payload.manifest,
        updatedAt: event.occurredAt,
      }));
    } else if (session && event.eventType === 'generation.failed') {
      this.#sessions.set(session.sessionId, housingSessionSchema.parse({
        ...session,
        status: 'failed',
        errorCode: event.payload.errorCode,
        errorMessage: event.payload.errorMessage,
        updatedAt: event.occurredAt,
      }));
    }
    return { jobId: next.jobId, sessionId: session?.sessionId };
  }

  async takeOutboxBatch(limit: number): Promise<OutboxRecord[]> {
    return [...this.#outbox.values()].slice(0, limit);
  }

  async markOutboxPublished(eventId: string): Promise<void> {
    this.#outbox.delete(eventId);
  }

  async markOutboxFailed(): Promise<void> {}

  async #applyFloorPlanEvent(event: FloorPlanEvent): Promise<AppliedEventResult> {
    if (event.eventType === 'floor-plan.validation-requested') return { jobId: event.payload.jobId };
    const current = this.#floorPlanJobs.get(event.payload.jobId);
    if (!current) return {};
    if (event.eventType === 'floor-plan.progressed') {
      this.#floorPlanJobs.set(current.jobId, floorPlanJobSchema.parse({
        ...current,
        status: event.payload.status,
        progress: event.payload.progress,
        updatedAt: event.occurredAt,
      }));
    } else if (event.eventType === 'floor-plan.validated') {
      this.#floorPlanJobs.set(current.jobId, floorPlanJobSchema.parse({
        ...current,
        status: 'complete',
        progress: 1,
        confidence: event.payload.confidence,
        plan: structuredFloorPlanSchema.parse(event.payload.plan),
        updatedAt: event.occurredAt,
      }));
      const asset = this.#assets.get(event.payload.assetId);
      if (asset) this.#assets.set(asset.assetId, { ...asset, status: 'validated' });
    } else if (event.eventType === 'floor-plan.rejected') {
      this.#floorPlanJobs.set(current.jobId, floorPlanJobSchema.parse({
        ...current,
        status: 'failed',
        progress: 1,
        confidence: event.payload.confidence,
        errorCode: event.payload.errorCode,
        errorMessage: event.payload.errorMessage,
        updatedAt: event.occurredAt,
      }));
      const asset = this.#assets.get(event.payload.assetId);
      if (asset) this.#assets.set(asset.assetId, { ...asset, status: 'rejected' });
    }
    return { jobId: current.jobId };
  }
}

// Compatibility name for earlier unit tests and imports.
export class InMemoryGenerationJobRepository extends InMemoryPlatformRepository {}
