import type {
  FloorPlanJob,
  AssetGenerationJob,
  AssetGenerationRequest,
  DecorationAnalysisJob,
  DecorationAnalysis,
  GenerationJob,
  GenerationRequest,
  GenerationRequestedEvent,
  HousingLayoutSource,
  HousingSession,
  PlatformEvent,
  StructuredFloorPlan,
  SpatialAnchorSet,
  UploadIntentRequest,
} from '@spatial-intelligence/contracts';

export interface CreateGenerationJobInput {
  jobId: string;
  request: GenerationRequest;
  idempotencyKey: string;
  now: string;
  purpose?: 'generic' | 'shell' | 'decoration';
  housingSessionId?: string;
}

export interface CreateGenerationJobResult {
  job: GenerationJob;
  created: boolean;
}

export interface AssetRecord {
  assetId: string;
  storageKey: string;
  kind: UploadIntentRequest['kind'];
  status: 'pending_upload' | 'uploaded' | 'validated' | 'rejected';
  originalFileName: string;
  expectedMediaType: UploadIntentRequest['mediaType'];
  sizeBytes: number;
}

export interface CreateAssetInput extends AssetRecord {
  createdAt: string;
}

export interface CreateFloorPlanJobInput {
  jobId: string;
  asset: AssetRecord;
  now: string;
  event: PlatformEvent;
}

export interface CreateHousingSessionInput {
  sessionId: string;
  source: HousingLayoutSource;
  plan?: StructuredFloorPlan;
  job: CreateGenerationJobInput;
  event: GenerationRequestedEvent;
}

export interface CreateDecorationAnalysisJobInput {
  jobId: string;
  analysisId: string;
  sessionId: string;
  asset?: AssetRecord;
  brief: string;
  now: string;
  event: PlatformEvent;
}

export interface CreateAssetGenerationJobInput {
  jobId: string;
  retryOfJobId?: string;
  attempt?: number;
  request: AssetGenerationRequest;
  now: string;
  event: PlatformEvent;
}

export interface AppliedEventResult {
  jobId?: string;
  sessionId?: string;
}

export interface OutboxRecord {
  eventId: string;
  event: PlatformEvent;
}

export interface EphemeralStateCleanup {
  storageKeys: string[];
  deletedRecords: number;
}

export interface PlatformRepository {
  createAsset(input: CreateAssetInput): Promise<AssetRecord>;
  findAsset(assetId: string): Promise<AssetRecord | null>;
  createFloorPlanJob(input: CreateFloorPlanJobInput): Promise<FloorPlanJob>;
  findFloorPlanJob(jobId: string): Promise<FloorPlanJob | null>;
  findValidatedPlan(assetId: string): Promise<StructuredFloorPlan | null>;
  createHousingSession(input: CreateHousingSessionInput): Promise<HousingSession>;
  findHousingSession(sessionId: string): Promise<HousingSession | null>;
  lockHousingSession(
    sessionId: string,
    anchors: SpatialAnchorSet,
    lockedAt: string,
    event?: PlatformEvent,
  ): Promise<HousingSession | null>;
  createDecorationAnalysisJob(input: CreateDecorationAnalysisJobInput): Promise<DecorationAnalysisJob>;
  findDecorationAnalysisJob(jobId: string): Promise<DecorationAnalysisJob | null>;
  findLatestDecorationAnalysis(sessionId: string): Promise<DecorationAnalysis | null>;
  createAssetGenerationJob(input: CreateAssetGenerationJobInput): Promise<AssetGenerationJob>;
  findAssetGenerationJob(jobId: string): Promise<AssetGenerationJob | null>;
  createGenerationJob(
    input: CreateGenerationJobInput,
    event: GenerationRequestedEvent,
  ): Promise<CreateGenerationJobResult>;
  findGenerationJob(jobId: string): Promise<GenerationJob | null>;
  findGenerationJobByIdempotencyKey(idempotencyKey: string): Promise<GenerationJob | null>;
  findLatestSourceVisualJob(sessionId: string): Promise<GenerationJob | null>;
  apply(event: PlatformEvent): Promise<AppliedEventResult>;
  takeOutboxBatch(limit: number): Promise<OutboxRecord[]>;
  markOutboxPublished(eventId: string, publishedAt: string): Promise<void>;
  markOutboxFailed(eventId: string, message: string): Promise<void>;
  clearEphemeralState(): Promise<EphemeralStateCleanup>;
  close?(): Promise<void>;
}

export interface ObjectStorage {
  createUploadUrl(asset: AssetRecord, expiresInSeconds: number): Promise<string>;
  createDownloadUrl(asset: AssetRecord, expiresInSeconds: number): Promise<string>;
  verifyUploadedObject(asset: AssetRecord): Promise<void>;
  deleteObjects(storageKeys: string[]): Promise<void>;
}

export interface EventPublisher {
  publish(event: PlatformEvent): Promise<void>;
  close?(): Promise<void>;
}

export interface JobEventListener {
  publish(event: PlatformEvent): void;
  subscribe(jobId: string, listener: (event: PlatformEvent) => void): () => void;
}
