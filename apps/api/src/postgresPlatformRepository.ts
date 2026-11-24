import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import {
  decorationAnalysisJobSchema,
  decorationAnalysisSchema,
  assetGenerationJobSchema,
  floorPlanJobSchema,
  generationJobSchema,
  housingSessionSchema,
  platformEventSchema,
  providerEvidenceSchema,
  structuredFloorPlanSchema,
  type FloorPlanJob,
  type DecorationAnalysis,
  type DecorationAnalysisJob,
  type AssetGenerationJob,
  type GenerationJob,
  type GenerationRequestedEvent,
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

export class PostgresPlatformRepository implements PlatformRepository {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max: 12 });
    this.#pool.on('error', (error) => {
      console.error(JSON.stringify({ event: 'postgres-pool-error', message: error.message }));
    });
  }

  async createAsset(input: CreateAssetInput): Promise<AssetRecord> {
    const result = await this.#pool.query(
      `INSERT INTO asset.assets (
        asset_id, storage_key, kind, media_type, size_bytes, original_file_name,
        expected_media_type, status, source_lineage, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb,$9)
      RETURNING *`,
      [input.assetId, input.storageKey, input.kind, input.expectedMediaType, input.sizeBytes,
        input.originalFileName, input.expectedMediaType, input.status, input.createdAt],
    );
    return assetFromRow(result.rows[0]);
  }

  async findAsset(assetId: string): Promise<AssetRecord | null> {
    const result = await this.#pool.query('SELECT * FROM asset.assets WHERE asset_id = $1', [assetId]);
    return result.rowCount ? assetFromRow(result.rows[0]) : null;
  }

  async createFloorPlanJob(input: CreateFloorPlanJobInput): Promise<FloorPlanJob> {
    return this.#transaction(async (client) => {
      await client.query("UPDATE asset.assets SET status = 'uploaded' WHERE asset_id = $1", [input.asset.assetId]);
      const result = await client.query(
        `INSERT INTO floor_plan.validation_jobs (job_id, asset_id, status, progress, created_at, updated_at)
         VALUES ($1,$2,'accepted',0,$3,$3) RETURNING *`,
        [input.jobId, input.asset.assetId, input.now],
      );
      await insertOutbox(client, input.event);
      return floorPlanJobFromRow(result.rows[0]);
    });
  }

  async findFloorPlanJob(jobId: string): Promise<FloorPlanJob | null> {
    const result = await this.#pool.query('SELECT * FROM floor_plan.validation_jobs WHERE job_id = $1', [jobId]);
    return result.rowCount ? floorPlanJobFromRow(result.rows[0]) : null;
  }

  async findValidatedPlan(assetId: string): Promise<StructuredFloorPlan | null> {
    const result = await this.#pool.query(
      `SELECT structured_plan FROM floor_plan.validation_jobs
       WHERE asset_id = $1 AND status = 'complete'
       ORDER BY updated_at DESC LIMIT 1`,
      [assetId],
    );
    return result.rowCount ? structuredFloorPlanSchema.parse(result.rows[0].structured_plan) : null;
  }

  async createHousingSession(input: CreateHousingSessionInput): Promise<HousingSession> {
    return this.#transaction(async (client) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await insertGenerationJob(client, input.job);
      await insertOutbox(client, input.event);
      const result = await client.query(
        `INSERT INTO housing.sessions (
          session_id, source, status, shell_job_id, created_at, updated_at
        ) VALUES ($1,$2::jsonb,'shell-generating',$3,$4,$4) RETURNING *`,
        [input.sessionId, JSON.stringify(input.source), input.job.jobId, input.job.now],
      );
      return housingSessionFromRow(result.rows[0]);
    });
  }

  async findHousingSession(sessionId: string): Promise<HousingSession | null> {
    const result = await this.#pool.query(
      `SELECT s.*, r.manifest
       FROM housing.sessions s
       LEFT JOIN scene.scenes sc ON sc.scene_id = s.scene_id
       LEFT JOIN scene.revisions r ON r.scene_id = sc.scene_id AND r.revision = sc.current_revision
       WHERE s.session_id = $1`,
      [sessionId],
    );
    return result.rowCount ? housingSessionFromRow(result.rows[0]) : null;
  }

  async lockHousingSession(
    sessionId: string,
    anchors: SpatialAnchorSet,
    lockedAt: string,
    event?: PlatformEvent,
  ): Promise<HousingSession | null> {
    const updated = await this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE housing.sessions
         SET shell_revision=$2, spatial_anchors=$3::jsonb, locked_at=$4, updated_at=$4
         WHERE session_id=$1 AND status='shell-ready'
         RETURNING *`,
        [sessionId, anchors.shellRevision, JSON.stringify(anchors), lockedAt],
      );
      if (result.rowCount && event) await insertOutbox(client, event);
      return result.rowCount;
    });
    if (!updated) return null;
    const session = await this.findHousingSession(sessionId);
    return session;
  }

  async createDecorationAnalysisJob(
    input: CreateDecorationAnalysisJobInput,
  ): Promise<DecorationAnalysisJob> {
    return this.#transaction(async (client) => {
      if (input.asset) {
        await client.query("UPDATE asset.assets SET status='uploaded' WHERE asset_id=$1", [input.asset.assetId]);
      }
      const result = await client.query(
        `INSERT INTO decoration.analysis_jobs (
          job_id, analysis_id, session_id, asset_id, status, progress, brief, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,'accepted',0,$5,$6,$6) RETURNING *`,
        [input.jobId, input.analysisId, input.sessionId, input.asset?.assetId ?? null, input.brief, input.now],
      );
      await insertOutbox(client, input.event);
      return decorationAnalysisJobFromRow(result.rows[0]);
    });
  }

  async findDecorationAnalysisJob(jobId: string): Promise<DecorationAnalysisJob | null> {
    const result = await this.#pool.query(
      'SELECT * FROM decoration.analysis_jobs WHERE job_id=$1',
      [jobId],
    );
    return result.rowCount ? decorationAnalysisJobFromRow(result.rows[0]) : null;
  }

  async findLatestDecorationAnalysis(sessionId: string): Promise<DecorationAnalysis | null> {
    const result = await this.#pool.query(
      `SELECT analysis FROM decoration.analysis_jobs
       WHERE session_id=$1 AND status='complete'
       ORDER BY updated_at DESC LIMIT 1`,
      [sessionId],
    );
    return result.rowCount ? decorationAnalysisSchema.parse(result.rows[0].analysis) : null;
  }

  async createAssetGenerationJob(input: CreateAssetGenerationJobInput): Promise<AssetGenerationJob> {
    return this.#transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO asset_generation.jobs (
          job_id, retry_of_job_id, session_id, analysis_id, object_id, request, status, progress,
          attempts, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'accepted',0,$7,$8,$8) RETURNING *`,
        [input.jobId, input.retryOfJobId ?? null, input.request.sessionId, input.request.analysisId,
          input.request.objectId, JSON.stringify(input.request), input.attempt ?? 1, input.now],
      );
      await insertOutbox(client, input.event);
      return assetGenerationJobFromRow(result.rows[0]);
    });
  }

  async findAssetGenerationJob(jobId: string): Promise<AssetGenerationJob | null> {
    const result = await this.#pool.query('SELECT * FROM asset_generation.jobs WHERE job_id=$1', [jobId]);
    return result.rowCount ? assetGenerationJobFromRow(result.rows[0]) : null;
  }

  async createGenerationJob(
    input: CreateGenerationJobInput,
    event: GenerationRequestedEvent,
  ): Promise<CreateGenerationJobResult> {
    const existing = await this.findGenerationJobByIdempotencyKey(input.idempotencyKey);
    if (existing) return { job: existing, created: false };
    try {
      const job = await this.#transaction(async (client) => {
        const result = await insertGenerationJob(client, input);
        await insertOutbox(client, event);
        return generationJobFromRow(result.rows[0]);
      });
      return { job, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findGenerationJobByIdempotencyKey(input.idempotencyKey);
        if (raced) return { job: raced, created: false };
      }
      throw error;
    }
  }

  async findGenerationJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.#pool.query('SELECT * FROM generation.jobs WHERE job_id = $1', [jobId]);
    return result.rowCount ? generationJobFromRow(result.rows[0]) : null;
  }

  async findGenerationJobByIdempotencyKey(idempotencyKey: string): Promise<GenerationJob | null> {
    const result = await this.#pool.query('SELECT * FROM generation.jobs WHERE idempotency_key = $1', [idempotencyKey]);
    return result.rowCount ? generationJobFromRow(result.rows[0]) : null;
  }

  async findLatestSourceVisualJob(sessionId: string): Promise<GenerationJob | null> {
    const result = await this.#pool.query(
      `SELECT * FROM generation.jobs WHERE housing_session_id = $1
       AND request #>> '{requirements,referenceImagePolicy}' = 'source-render-layout-and-appearance'
       ORDER BY created_at DESC, job_id DESC LIMIT 1`,
      [sessionId],
    );
    return result.rowCount ? generationJobFromRow(result.rows[0]) : null;
  }

  async apply(event: PlatformEvent): Promise<AppliedEventResult> {
    return this.#transaction(async (client) => {
      switch (event.eventType) {
        case 'floor-plan.validation-requested':
        case 'decoration-analysis.requested':
        case 'generation.requested':
        case 'scene.revision-created':
        case 'scene.constraints-locked':
        case 'asset-generation.requested':
          return {};
        case 'floor-plan.progressed':
          await client.query(
            `UPDATE floor_plan.validation_jobs SET status=$2, progress=$3, updated_at=$4 WHERE job_id=$1`,
            [event.payload.jobId, event.payload.status, event.payload.progress, event.occurredAt],
          );
          return { jobId: event.payload.jobId };
        case 'floor-plan.validated':
          await client.query(
            `UPDATE floor_plan.validation_jobs SET status='complete', progress=1, confidence=$2,
             structured_plan=$3::jsonb, updated_at=$4 WHERE job_id=$1`,
            [event.payload.jobId, event.payload.confidence, JSON.stringify(event.payload.plan), event.occurredAt],
          );
          await client.query(
            `UPDATE asset.assets SET status='validated', checksum_sha256=$2, detected_media_type=$3,
             width_pixels=$4, height_pixels=$5, validated_at=$6 WHERE asset_id=$1`,
            [event.payload.assetId, event.payload.checksumSha256, event.payload.detectedMediaType,
              event.payload.widthPixels, event.payload.heightPixels, event.occurredAt],
          );
          return { jobId: event.payload.jobId };
        case 'floor-plan.rejected':
          await client.query(
            `UPDATE floor_plan.validation_jobs SET status='failed', progress=1, confidence=$2,
             error_code=$3, error_message=$4, updated_at=$5 WHERE job_id=$1`,
            [event.payload.jobId, event.payload.confidence ?? null, event.payload.errorCode,
              event.payload.errorMessage, event.occurredAt],
          );
          await client.query(
            `UPDATE asset.assets SET status='rejected', rejection_code=$2 WHERE asset_id=$1`,
            [event.payload.assetId, event.payload.errorCode],
          );
          return { jobId: event.payload.jobId };
        case 'decoration-analysis.progressed':
          await client.query(
            `UPDATE decoration.analysis_jobs SET status=$2, progress=$3, updated_at=$4 WHERE job_id=$1`,
            [event.payload.jobId, event.payload.status, event.payload.progress, event.occurredAt],
          );
          return { jobId: event.payload.jobId };
        case 'decoration-analysis.completed': {
          const result = await client.query(
            `UPDATE decoration.analysis_jobs
             SET status='complete', progress=1, analysis=$2::jsonb, updated_at=$3
             WHERE job_id=$1 RETURNING session_id`,
            [event.payload.jobId, JSON.stringify(event.payload.analysis), event.occurredAt],
          );
          await client.query(
            `UPDATE asset.assets SET status='validated', checksum_sha256=$2, detected_media_type=$3,
             width_pixels=$4, height_pixels=$5, validated_at=$6
             WHERE asset_id=$1`,
            [event.payload.analysis.sourceAssetId, event.payload.checksumSha256,
              event.payload.detectedMediaType, event.payload.widthPixels,
              event.payload.heightPixels, event.occurredAt],
          );
          return { jobId: event.payload.jobId, sessionId: result.rows[0]?.session_id };
        }
        case 'decoration-analysis.failed': {
          const result = await client.query(
            `UPDATE decoration.analysis_jobs
             SET status='failed', progress=1, error_code=$2, error_message=$3, updated_at=$4
             WHERE job_id=$1 RETURNING session_id`,
            [event.payload.jobId, event.payload.errorCode, event.payload.errorMessage, event.occurredAt],
          );
          return { jobId: event.payload.jobId, sessionId: result.rows[0]?.session_id };
        }
        case 'asset-generation.progressed': {
          const result = await client.query(
            `UPDATE asset_generation.jobs SET status=$2, progress=$3,
             external_task_id=COALESCE($4, external_task_id), provider_evidence=COALESCE($5::jsonb, provider_evidence),
             updated_at=$6 WHERE job_id=$1 RETURNING session_id`,
            [event.payload.jobId, event.payload.status, event.payload.progress,
              event.payload.externalTaskId ?? null,
              event.payload.providerEvidence ? JSON.stringify(event.payload.providerEvidence) : null,
              event.occurredAt],
          );
          return { jobId: event.payload.jobId, sessionId: result.rows[0]?.session_id };
        }
        case 'asset-generation.completed': {
          const result = await client.query(
            `UPDATE asset_generation.jobs SET status='complete', progress=1, external_task_id=$2,
             source_glb_asset_id=$3, normalized_glb_asset_id=$4, normalized_transform=$5::jsonb,
             provider_evidence=$6::jsonb, updated_at=$7 WHERE job_id=$1 RETURNING session_id`,
            [event.payload.jobId, event.payload.externalTaskId, event.payload.sourceGlbAssetId,
              event.payload.normalizedGlbAssetId, JSON.stringify(event.payload.transform),
              JSON.stringify(event.payload.providerEvidence), event.occurredAt],
          );
          await persistProviderEvidence(
            client, event.eventId, event.payload.jobId, event.payload.providerEvidence, event.occurredAt,
          );
          return { jobId: event.payload.jobId, sessionId: result.rows[0]?.session_id };
        }
        case 'asset-generation.failed': {
          const result = await client.query(
            `UPDATE asset_generation.jobs SET status='failed', progress=1,
             external_task_id=COALESCE($2, external_task_id), error_code=$3, error_message=$4,
             retryable=$5, provider_evidence=$6::jsonb, updated_at=$7
             WHERE job_id=$1 RETURNING session_id`,
            [event.payload.jobId, event.payload.externalTaskId ?? null, event.payload.errorCode,
              event.payload.errorMessage, event.payload.retryable,
              JSON.stringify(event.payload.providerEvidence), event.occurredAt],
          );
          await persistProviderEvidence(
            client, event.eventId, event.payload.jobId, event.payload.providerEvidence, event.occurredAt,
          );
          return { jobId: event.payload.jobId, sessionId: result.rows[0]?.session_id };
        }
        case 'generation.progressed':
          const progressedJob = await client.query(
            `UPDATE generation.jobs SET status=$2, progress=$3,
             provider_evidence=COALESCE($4::jsonb, provider_evidence), updated_at=$5 WHERE job_id=$1`,
            [
              event.payload.jobId,
              event.payload.status,
              event.payload.progress,
              event.payload.providerEvidence ? JSON.stringify(event.payload.providerEvidence) : null,
              event.occurredAt,
            ],
          );
          if (!progressedJob.rowCount) return {};
          if (event.payload.providerEvidence) {
            await persistProviderEvidence(
              client, event.eventId, event.payload.jobId, event.payload.providerEvidence, event.occurredAt,
            );
          }
          return { jobId: event.payload.jobId };
        case 'generation.completed': {
          const completedJob = await client.query(
            `UPDATE generation.jobs SET status='complete', progress=1, scene_id=$2,
             provider_evidence=COALESCE($3::jsonb, provider_evidence), updated_at=$4
             WHERE job_id=$1 RETURNING purpose, housing_session_id`,
            [
              event.payload.jobId,
              event.payload.manifest.sceneId,
              event.payload.manifest.metadata.providerEvidence
                ? JSON.stringify(event.payload.manifest.metadata.providerEvidence)
                : null,
              event.occurredAt,
            ],
          );
          if (!completedJob.rowCount) return {};
          await client.query(
            `INSERT INTO scene.scenes (scene_id, current_revision, created_at, updated_at)
             VALUES ($1,$2,$3,$3)
             ON CONFLICT (scene_id) DO UPDATE SET current_revision=EXCLUDED.current_revision, updated_at=EXCLUDED.updated_at`,
            [event.payload.manifest.sceneId, event.payload.manifest.revision, event.occurredAt],
          );
          await client.query(
            `INSERT INTO scene.revisions (scene_id, revision, manifest, created_at)
             VALUES ($1,$2,$3::jsonb,$4)
             ON CONFLICT (scene_id, revision) DO UPDATE SET manifest=EXCLUDED.manifest`,
            [event.payload.manifest.sceneId, event.payload.manifest.revision,
              JSON.stringify(event.payload.manifest), event.occurredAt],
          );
          const purpose = completedJob.rows[0]?.purpose;
          const housingSessionId = completedJob.rows[0]?.housing_session_id;
          const session = housingSessionId ? await client.query(
            `UPDATE housing.sessions SET status='shell-ready', scene_id=$2, updated_at=$3
             WHERE session_id=$1 RETURNING session_id`,
            [housingSessionId, event.payload.manifest.sceneId, event.occurredAt],
          ) : { rows: [] };
          if (purpose === 'shell' || purpose === 'decoration') {
            await persistProviderEvidence(
              client,
              event.eventId,
              event.payload.jobId,
              event.payload.manifest.metadata.providerEvidence,
              event.occurredAt,
            );
          }
          return { jobId: event.payload.jobId, sessionId: session.rows[0]?.session_id };
        }
        case 'generation.failed': {
          const failedJob = await client.query(
            `UPDATE generation.jobs SET status='failed', error_code=$2, error_message=$3,
             provider_evidence=COALESCE($4::jsonb, provider_evidence), updated_at=$5
             WHERE job_id=$1 RETURNING job_id`,
            [
              event.payload.jobId,
              event.payload.errorCode,
              event.payload.errorMessage,
              event.payload.providerEvidence ? JSON.stringify(event.payload.providerEvidence) : null,
              event.occurredAt,
            ],
          );
          if (!failedJob.rowCount) return {};
          const session = await client.query(
            `UPDATE housing.sessions SET status='failed', error_code=$2, error_message=$3, updated_at=$4
             WHERE shell_job_id=$1 RETURNING session_id`,
            [event.payload.jobId, event.payload.errorCode, event.payload.errorMessage, event.occurredAt],
          );
          await persistProviderEvidence(
            client,
            event.eventId,
            event.payload.jobId,
            event.payload.providerEvidence,
            event.occurredAt,
          );
          return { jobId: event.payload.jobId, sessionId: session.rows[0]?.session_id };
        }
      }
    });
  }

  async takeOutboxBatch(limit: number): Promise<OutboxRecord[]> {
    const result = await this.#pool.query(
      `SELECT event_id, payload FROM generation.outbox
       WHERE published_at IS NULL ORDER BY created_at ASC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      event: platformEventSchema.parse(row.payload),
    }));
  }

  async markOutboxPublished(eventId: string, publishedAt: string): Promise<void> {
    await this.#pool.query(
      `UPDATE generation.outbox SET published_at=$2, publish_attempts=publish_attempts+1, last_error=NULL
       WHERE event_id=$1`,
      [eventId, publishedAt],
    );
  }

  async markOutboxFailed(eventId: string, message: string): Promise<void> {
    await this.#pool.query(
      `UPDATE generation.outbox SET publish_attempts=publish_attempts+1, last_error=$2 WHERE event_id=$1`,
      [eventId, message.slice(0, 2000)],
    );
  }

  async clearEphemeralState() {
    return this.#transaction(async (client) => {
      const assets = await client.query<{ storage_key: string }>('SELECT storage_key FROM asset.assets');
      let deletedRecords = 0;
      for (const statement of [
        'DELETE FROM scene_service.commands',
        'DELETE FROM scene_service.revisions',
        'DELETE FROM scene_service.scenes',
        'DELETE FROM asset_generation.jobs',
        'DELETE FROM decoration.analysis_jobs',
        'DELETE FROM provider.operation_evidence',
        'DELETE FROM floor_plan.validation_jobs',
        'UPDATE generation.jobs SET housing_session_id=NULL WHERE housing_session_id IS NOT NULL',
        'DELETE FROM housing.sessions',
        'DELETE FROM scene.revisions',
        'DELETE FROM scene.scenes',
        'DELETE FROM generation.jobs',
        'DELETE FROM generation.outbox',
        'DELETE FROM asset.assets',
      ]) {
        const result = await client.query(statement);
        if (statement.startsWith('DELETE')) deletedRecords += result.rowCount ?? 0;
      }
      return { storageKeys: assets.rows.map((row) => row.storage_key), deletedRecords };
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function persistProviderEvidence(
  client: PoolClient,
  evidenceId: string,
  jobId: string,
  rawEvidence: unknown,
  occurredAt: string,
): Promise<void> {
  const parsed = providerEvidenceSchema.safeParse(rawEvidence);
  if (!parsed.success) return;
  const evidence = parsed.data;
  await client.query(
    `INSERT INTO provider.operation_evidence (
      evidence_id, internal_job_id, provider_id, operation, external_task_id,
      external_project_id, status, attempts, input_asset_ids, output_asset_ids,
      diagnostics, error_code, started_at, completed_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$15)
    ON CONFLICT (provider_id, external_task_id) WHERE external_task_id IS NOT NULL DO UPDATE SET
      internal_job_id=EXCLUDED.internal_job_id,
      status=EXCLUDED.status, attempts=EXCLUDED.attempts,
      output_asset_ids=EXCLUDED.output_asset_ids, diagnostics=EXCLUDED.diagnostics,
      error_code=EXCLUDED.error_code, completed_at=EXCLUDED.completed_at,
      updated_at=EXCLUDED.updated_at`,
    [
      evidenceId,
      jobId,
      evidence.providerId,
      evidence.operation,
      evidence.externalTaskId ?? null,
      evidence.externalProjectId ?? null,
      evidence.status,
      evidence.attempts,
      JSON.stringify(evidence.inputAssetIds),
      JSON.stringify(evidence.outputAssetIds),
      JSON.stringify(evidence.diagnostics),
      evidence.errorCode ?? null,
      evidence.startedAt ?? null,
      evidence.completedAt ?? null,
      occurredAt,
    ],
  );
}

async function insertGenerationJob(client: PoolClient, input: CreateGenerationJobInput) {
  return client.query(
    `INSERT INTO generation.jobs (
      job_id, request_id, idempotency_key, status, progress, request, purpose,
      housing_session_id, created_at, updated_at
    ) VALUES ($1,$2,$3,'accepted',0,$4::jsonb,$5,$6,$7,$7) RETURNING *`,
    [input.jobId, input.request.requestId, input.idempotencyKey, JSON.stringify(input.request),
      input.purpose ?? 'generic', input.housingSessionId ?? null, input.now],
  );
}

async function insertOutbox(client: PoolClient, event: PlatformEvent) {
  await client.query(
    `INSERT INTO generation.outbox (event_id, subject, payload, created_at)
     VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (event_id) DO NOTHING`,
    [event.eventId, `${event.eventType}.v${event.version}`, JSON.stringify(event), event.occurredAt],
  );
}

function assetFromRow(row: QueryResultRow): AssetRecord {
  return {
    assetId: row.asset_id ?? undefined,
    storageKey: row.storage_key,
    kind: row.kind,
    status: row.status,
    originalFileName: row.original_file_name,
    expectedMediaType: row.expected_media_type ?? row.media_type,
    sizeBytes: Number(row.size_bytes),
  };
}

function floorPlanJobFromRow(row: QueryResultRow): FloorPlanJob {
  return floorPlanJobSchema.parse({
    jobId: row.job_id,
    assetId: row.asset_id,
    status: row.status,
    progress: Number(row.progress),
    confidence: row.confidence === null ? undefined : Number(row.confidence),
    plan: row.structured_plan ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function generationJobFromRow(row: QueryResultRow): GenerationJob {
  return generationJobSchema.parse({
    jobId: row.job_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    progress: Number(row.progress),
    sceneId: row.scene_id ?? undefined,
    providerEvidence: row.provider_evidence ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function housingSessionFromRow(row: QueryResultRow): HousingSession {
  return housingSessionSchema.parse({
    sessionId: row.session_id,
    source: row.source,
    status: row.status,
    shellJobId: row.shell_job_id,
    sceneId: row.scene_id ?? undefined,
    manifest: row.manifest ?? undefined,
    shellRevision: row.shell_revision === null || row.shell_revision === undefined
      ? undefined : Number(row.shell_revision),
    shellLocked: row.locked_at !== null && row.locked_at !== undefined,
    spatialAnchors: row.spatial_anchors ?? undefined,
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function decorationAnalysisJobFromRow(row: QueryResultRow): DecorationAnalysisJob {
  return decorationAnalysisJobSchema.parse({
    jobId: row.job_id,
    sessionId: row.session_id,
    assetId: row.asset_id ?? undefined,
    status: row.status,
    progress: Number(row.progress),
    analysis: row.analysis ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function assetGenerationJobFromRow(row: QueryResultRow): AssetGenerationJob {
  return assetGenerationJobSchema.parse({
    jobId: row.job_id,
    retryOfJobId: row.retry_of_job_id ?? undefined,
    request: row.request,
    status: row.status,
    progress: Number(row.progress),
    attempts: Number(row.attempts),
    externalTaskId: row.external_task_id ?? undefined,
    sourceGlbAssetId: row.source_glb_asset_id ?? undefined,
    normalizedGlbAssetId: row.normalized_glb_asset_id ?? undefined,
    transform: row.normalized_transform ?? undefined,
    providerEvidence: row.provider_evidence ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryable: row.retryable ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}
