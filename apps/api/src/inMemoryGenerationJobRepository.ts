import {
  decorationAnalysisJobSchema,
  assetGenerationJobSchema,
  floorPlanJobSchema,
  generationJobSchema,
  housingSessionSchema,
  structuredFloorPlanSchema,
  type FloorPlanJob,
  type DecorationAnalysis,
  type DecorationAnalysisJob,
  type AssetGenerationJob,
  type GenerationJob,
  type HousingSession,
  type PlatformEvent,
  type StructuredFloorPlan,
  type SpatialAnchorSet,
} from '@spatial-intelligence/contracts';
import {
  type AppliedEventResult,
  type AssetRecord,
  type CreateAssetInput,
  type CreateFloorPlanJobInput,
  type CreateGenerationJobInput,
  type CreateGenerationJobResult,
  type CreateHousingSessionInput,
  type CreateDecorationAnalysisJobInput,
  type CreateAssetGenerationJobInput,
  type OutboxRecord,
  type PlatformRepository,
} from './ports.js';

type FloorPlanEvent = Extract<PlatformEvent, {
  eventType: 'floor-plan.validation-requested' | 'floor-plan.progressed' | 'floor-plan.validated' | 'floor-plan.rejected';
}>;

type DecorationAnalysisEvent = Extract<PlatformEvent, {
  eventType: 'decoration-analysis.requested' | 'decoration-analysis.progressed'
    | 'decoration-analysis.completed' | 'decoration-analysis.failed';
}>;

type AssetGenerationEvent = Extract<PlatformEvent, {
  eventType: 'asset-generation.requested' | 'asset-generation.progressed'
    | 'asset-generation.completed' | 'asset-generation.failed';
}>;

export class InMemoryPlatformRepository implements PlatformRepository {
  readonly #assets = new Map<string, AssetRecord>();
  readonly #floorPlanJobs = new Map<string, FloorPlanJob>();
  readonly #generationJobs = new Map<string, GenerationJob>();
  readonly #generationJobIdsByKey = new Map<string, string>();
  readonly #housingSessionIdsByJob = new Map<string, string>();
  readonly #generationPurposeByJob = new Map<string, string>();
  readonly #sessions = new Map<string, HousingSession>();
  readonly #decorationAnalysisJobs = new Map<string, DecorationAnalysisJob>();
  readonly #assetGenerationJobs = new Map<string, AssetGenerationJob>();
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
      assetId: input.asset?.assetId,
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

  async lockHousingSession(
    sessionId: string,
    anchors: SpatialAnchorSet,
    lockedAt: string,
    event?: PlatformEvent,
  ): Promise<HousingSession | null> {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;
    const locked = housingSessionSchema.parse({
      ...session,
      shellRevision: anchors.shellRevision,
      shellLocked: true,
      spatialAnchors: anchors,
      lockedAt,
      updatedAt: lockedAt,
    });
    this.#sessions.set(sessionId, locked);
    if (event) this.#outbox.set(event.eventId, { eventId: event.eventId, event });
    return locked;
  }

  async createDecorationAnalysisJob(
    input: CreateDecorationAnalysisJobInput,
  ): Promise<DecorationAnalysisJob> {
    const job = decorationAnalysisJobSchema.parse({
      jobId: input.jobId,
      sessionId: input.sessionId,
      assetId: input.asset?.assetId,
      status: 'accepted',
      progress: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.#decorationAnalysisJobs.set(job.jobId, job);
    this.#outbox.set(input.event.eventId, { eventId: input.event.eventId, event: input.event });
    return job;
  }

  async findDecorationAnalysisJob(jobId: string): Promise<DecorationAnalysisJob | null> {
    return this.#decorationAnalysisJobs.get(jobId) ?? null;
  }

  async findLatestDecorationAnalysis(sessionId: string): Promise<DecorationAnalysis | null> {
    const completed = [...this.#decorationAnalysisJobs.values()]
      .filter((job) => job.sessionId === sessionId && job.status === 'complete' && job.analysis)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return completed?.analysis ?? null;
  }

  async createAssetGenerationJob(input: CreateAssetGenerationJobInput): Promise<AssetGenerationJob> {
    const job = assetGenerationJobSchema.parse({
      jobId: input.jobId,
      retryOfJobId: input.retryOfJobId,
      request: input.request,
      status: 'accepted',
      progress: 0,
      attempts: input.attempt ?? 1,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.#assetGenerationJobs.set(job.jobId, job);
    this.#outbox.set(input.event.eventId, { eventId: input.event.eventId, event: input.event });
    return job;
  }

  async findAssetGenerationJob(jobId: string): Promise<AssetGenerationJob | null> {
    return this.#assetGenerationJobs.get(jobId) ?? null;
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
    if (input.housingSessionId) this.#housingSessionIdsByJob.set(job.jobId, input.housingSessionId);
    this.#generationPurposeByJob.set(job.jobId, input.purpose ?? 'generic');
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

  async findLatestSourceVisualJob(sessionId: string): Promise<GenerationJob | null> {
    const prefix = `source-visual:${sessionId}`;
    let latest: GenerationJob | null = null;
    for (const [key, jobId] of this.#generationJobIdsByKey) {
      if (key === prefix || key.startsWith(`${prefix}:retry:`)) latest = this.#generationJobs.get(jobId) ?? latest;
    }
    return latest;
  }

  async apply(event: PlatformEvent): Promise<AppliedEventResult> {
    if (event.eventType.startsWith('floor-plan.')) return this.#applyFloorPlanEvent(event as FloorPlanEvent);
    if (event.eventType.startsWith('decoration-analysis.')) {
      return this.#applyDecorationAnalysisEvent(event as DecorationAnalysisEvent);
    }
    if (event.eventType.startsWith('asset-generation.')) {
      return this.#applyAssetGenerationEvent(event as AssetGenerationEvent);
    }
    if (event.eventType === 'generation.requested'
      || event.eventType === 'scene.revision-created'
      || event.eventType === 'scene.constraints-locked') return {};

    const current = await this.findGenerationJob(event.payload.jobId);
    if (!current) return {};
    let next = current;
    if (event.eventType === 'generation.progressed') {
      next = generationJobSchema.parse({
        ...current,
        status: event.payload.status,
        progress: event.payload.progress,
        providerEvidence: event.payload.providerEvidence ?? current.providerEvidence,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === 'generation.completed') {
      next = generationJobSchema.parse({
        ...current,
        status: 'complete',
        progress: 1,
        sceneId: event.payload.manifest.sceneId,
        providerEvidence: event.payload.manifest.metadata.providerEvidence ?? current.providerEvidence,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === 'generation.failed') {
      next = generationJobSchema.parse({
        ...current,
        status: 'failed',
        errorCode: event.payload.errorCode,
        errorMessage: event.payload.errorMessage,
        providerEvidence: event.payload.providerEvidence ?? current.providerEvidence,
        updatedAt: event.occurredAt,
      });
    }
    this.#generationJobs.set(next.jobId, next);

    const linkedSessionId = this.#housingSessionIdsByJob.get(next.jobId);
    const session = linkedSessionId
      ? this.#sessions.get(linkedSessionId)
      : [...this.#sessions.values()].find((candidate) => candidate.shellJobId === next.jobId);
    if (session && event.eventType === 'generation.completed') {
      this.#sessions.set(session.sessionId, housingSessionSchema.parse({
        ...session,
        status: 'shell-ready',
        sceneId: event.payload.manifest.sceneId,
        manifest: event.payload.manifest,
        updatedAt: event.occurredAt,
      }));
    } else if (session && event.eventType === 'generation.failed'
      && (this.#generationPurposeByJob.get(next.jobId) ?? 'shell') === 'shell') {
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

  async clearEphemeralState() {
    const storageKeys = [...this.#assets.values()].map((asset) => asset.storageKey);
    const deletedRecords = this.#assets.size + this.#floorPlanJobs.size + this.#generationJobs.size
      + this.#sessions.size + this.#decorationAnalysisJobs.size + this.#assetGenerationJobs.size
      + this.#outbox.size;
    this.#assets.clear();
    this.#floorPlanJobs.clear();
    this.#generationJobs.clear();
    this.#generationJobIdsByKey.clear();
    this.#housingSessionIdsByJob.clear();
    this.#generationPurposeByJob.clear();
    this.#sessions.clear();
    this.#decorationAnalysisJobs.clear();
    this.#assetGenerationJobs.clear();
    this.#outbox.clear();
    return { storageKeys, deletedRecords };
  }

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

  async #applyDecorationAnalysisEvent(event: DecorationAnalysisEvent): Promise<AppliedEventResult> {
    if (event.eventType === 'decoration-analysis.requested') return { jobId: event.payload.jobId };
    const current = this.#decorationAnalysisJobs.get(event.payload.jobId);
    if (!current) return {};
    let next = current;
    if (event.eventType === 'decoration-analysis.progressed') {
      next = decorationAnalysisJobSchema.parse({
        ...current,
        status: event.payload.status,
        progress: event.payload.progress,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === 'decoration-analysis.completed') {
      next = decorationAnalysisJobSchema.parse({
        ...current,
        status: 'complete',
        progress: 1,
        analysis: event.payload.analysis,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === 'decoration-analysis.failed') {
      next = decorationAnalysisJobSchema.parse({
        ...current,
        status: 'failed',
        progress: 1,
        errorCode: event.payload.errorCode,
        errorMessage: event.payload.errorMessage,
        updatedAt: event.occurredAt,
      });
    }
    this.#decorationAnalysisJobs.set(next.jobId, next);
    return { jobId: next.jobId, sessionId: next.sessionId };
  }

  async #applyAssetGenerationEvent(event: AssetGenerationEvent): Promise<AppliedEventResult> {
    if (event.eventType === 'asset-generation.requested') return { jobId: event.payload.jobId };
    const current = this.#assetGenerationJobs.get(event.payload.jobId);
    if (!current) return {};
    let next: AssetGenerationJob;
    if (event.eventType === 'asset-generation.progressed') {
      next = assetGenerationJobSchema.parse({
        ...current,
        status: event.payload.status,
        progress: event.payload.progress,
        externalTaskId: event.payload.externalTaskId ?? current.externalTaskId,
        providerEvidence: event.payload.providerEvidence ?? current.providerEvidence,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === 'asset-generation.completed') {
      next = assetGenerationJobSchema.parse({
        ...current,
        status: 'complete',
        progress: 1,
        externalTaskId: event.payload.externalTaskId,
        sourceGlbAssetId: event.payload.sourceGlbAssetId,
        normalizedGlbAssetId: event.payload.normalizedGlbAssetId,
        transform: event.payload.transform,
        providerEvidence: event.payload.providerEvidence,
        updatedAt: event.occurredAt,
      });
    } else {
      next = assetGenerationJobSchema.parse({
        ...current,
        status: 'failed',
        progress: 1,
        externalTaskId: event.payload.externalTaskId ?? current.externalTaskId,
        errorCode: event.payload.errorCode,
        errorMessage: event.payload.errorMessage,
        retryable: event.payload.retryable,
        providerEvidence: event.payload.providerEvidence,
        updatedAt: event.occurredAt,
      });
    }
    this.#assetGenerationJobs.set(next.jobId, next);
    return { jobId: next.jobId, sessionId: next.request.sessionId };
  }
}

// Compatibility name for earlier unit tests and imports.
export class InMemoryGenerationJobRepository extends InMemoryPlatformRepository {}
