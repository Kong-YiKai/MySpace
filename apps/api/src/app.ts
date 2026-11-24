import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createHousingSessionSchema,
  canRetrySourceVisual,
  assetGenerationRequestSchema,
  assetGenerationRequestedEventSchema,
  decorationAnalysisRequestSchema,
  decorationAnalysisRequestedEventSchema,
  decorationRequestSchema,
  floorPlanValidationRequestSchema,
  floorPlanValidationRequestedEventSchema,
  generationRequestSchema,
  generationRequestedEventSchema,
  shellLockRequestSchema,
  sceneConstraintsLockedEventSchema,
  uploadIntentRequestSchema,
  uploadIntentSchema,
  type GenerationRequest,
  type DecorationAnalysis,
  type HousingSession,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import type { JobEventListener, ObjectStorage, PlatformRepository } from './ports.js';
import { presetFloorPlan } from './presetFloorPlans.js';
import { deriveSpatialAnchorSet } from './spatialAnchors.js';

interface AppDependencies {
  repository: PlatformRepository;
  storage: ObjectStorage;
  events: JobEventListener;
  now?: () => string;
  createId?: () => string;
  uploadUrlTtlSeconds?: number;
  sseHeartbeatMs?: number;
  sceneServiceUrl?: string;
  onEphemeralStateCleared?: () => void | Promise<void>;
}

export function createApp({
  repository,
  storage,
  events,
  now = () => new Date().toISOString(),
  createId = randomUUID,
  uploadUrlTtlSeconds = 300,
  sseHeartbeatMs = 15_000,
  sceneServiceUrl = process.env.SCENE_SERVICE_URL ?? 'http://127.0.0.1:3100',
  onEphemeralStateCleared = () => {},
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  app.get('/ready', async () => ({ status: 'ready', service: 'api' }));

  app.delete('/v1/ephemeral-state', async (_request, reply) => {
    const cleanup = await repository.clearEphemeralState();
    try {
      await storage.deleteObjects(cleanup.storageKeys);
    } finally {
      await onEphemeralStateCleared();
    }
    return reply.send({
      cleared: true,
      deletedRecords: cleanup.deletedRecords,
      deletedObjects: cleanup.storageKeys.length,
    });
  });

  app.get<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId', async (request, reply) => (
    proxySceneRequest(sceneServiceUrl, `/v1/scenes/${encodeURIComponent(request.params.sceneId)}`, 'GET', undefined, reply)
  ));
  app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/commands', async (request, reply) => (
    proxySceneRequest(sceneServiceUrl, `/v1/scenes/${encodeURIComponent(request.params.sceneId)}/commands`, 'POST', request.body, reply)
  ));
  app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/undo', async (request, reply) => (
    proxySceneRequest(sceneServiceUrl, `/v1/scenes/${encodeURIComponent(request.params.sceneId)}/undo`, 'POST', request.body, reply)
  ));
  app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/redo', async (request, reply) => (
    proxySceneRequest(sceneServiceUrl, `/v1/scenes/${encodeURIComponent(request.params.sceneId)}/redo`, 'POST', request.body, reply)
  ));

  app.post('/v1/assets/upload-intents', async (request, reply) => {
    const parsed = uploadIntentRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'invalid_upload_intent', parsed.error.issues);
    if (parsed.data.kind === 'floor-plan' && parsed.data.sizeBytes > 10 * 1024 * 1024) {
      return reply.code(400).send({ error: 'file_too_large', message: '户型图不能超过 10 MB' });
    }
    if (parsed.data.kind === 'floor-plan' && !parsed.data.mediaType.startsWith('image/')) {
      return reply.code(400).send({ error: 'unsupported_file', message: '户型图必须是 PNG、JPG 或 WebP 图片' });
    }
    if (parsed.data.kind === 'decoration-reference-image') {
      if (!parsed.data.mediaType.startsWith('image/')) {
        return reply.code(400).send({ error: 'unsupported_file', message: '装修参考图必须是 PNG、JPG 或 WebP 图片' });
      }
      if (parsed.data.sizeBytes > 30 * 1024 * 1024) {
        return reply.code(400).send({ error: 'file_too_large', message: '装修参考图不能超过 30 MB' });
      }
    }
    const captureError = validateCaptureUpload(parsed.data);
    if (captureError) return reply.code(400).send(captureError);

    const timestamp = now();
    const assetId = `asset-${createId()}`;
    const extension = mediaTypeExtension(parsed.data.mediaType);
    const asset = await repository.createAsset({
      assetId,
      storageKey: `${parsed.data.kind}/${assetId}/source.${extension}`,
      kind: parsed.data.kind,
      status: 'pending_upload',
      originalFileName: parsed.data.fileName,
      expectedMediaType: parsed.data.mediaType,
      sizeBytes: parsed.data.sizeBytes,
      createdAt: timestamp,
    });
    const result = uploadIntentSchema.parse({
      assetId,
      method: 'PUT',
      uploadUrl: await storage.createUploadUrl(asset, uploadUrlTtlSeconds),
      headers: {
        'content-type': asset.expectedMediaType,
      },
      expiresAt: new Date(Date.parse(timestamp) + uploadUrlTtlSeconds * 1000).toISOString(),
    });
    return reply.code(201).send(result);
  });

  app.post('/v1/floor-plans/validate', async (request, reply) => {
    const parsed = floorPlanValidationRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'invalid_floor_plan_validation_request', parsed.error.issues);
    const asset = await repository.findAsset(parsed.data.assetId);
    if (!asset) return reply.code(404).send({ error: 'asset_not_found' });
    if (asset.kind !== 'floor-plan') return reply.code(400).send({ error: 'asset_kind_mismatch' });
    try {
      await storage.verifyUploadedObject(asset);
    } catch (error) {
      return reply.code(409).send({
        error: errorCode(error, 'asset_not_uploaded'),
        message: error instanceof Error ? error.message : '上传尚未完成',
      });
    }

    const jobId = createId();
    const timestamp = now();
    const event = floorPlanValidationRequestedEventSchema.parse({
      ...eventMetadata('floor-plan.validation-requested', timestamp, createId),
      payload: {
        jobId,
        assetId: asset.assetId,
        storageKey: asset.storageKey,
        expectedMediaType: asset.expectedMediaType,
        expectedSizeBytes: asset.sizeBytes,
      },
    });
    const job = await repository.createFloorPlanJob({ jobId, asset, now: timestamp, event });
    return reply.code(202).send(job);
  });

  app.get<{ Params: { jobId: string } }>('/v1/floor-plans/jobs/:jobId', async (request, reply) => {
    const job = await repository.findFloorPlanJob(request.params.jobId);
    return job ?? reply.code(404).send({ error: 'floor_plan_job_not_found' });
  });

  app.post('/v1/housing-sessions', async (request, reply) => {
    const parsed = createHousingSessionSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'invalid_housing_session', parsed.error.issues);
    const source = parsed.data.source;
    const plan = source.kind === 'preset'
      ? presetFloorPlan(source.preset)
      : source.kind === 'uploaded-plan'
        ? await repository.findValidatedPlan(source.assetId)
        : undefined;
    if (source.kind === 'uploaded-plan' && !plan) {
      return reply.code(409).send({ error: 'floor_plan_not_validated', message: '户型图尚未通过服务端识别' });
    }

    const captureAssets = source.kind === 'captured-space'
      ? await Promise.all(source.assetIds.map((assetId) => repository.findAsset(assetId)))
      : [];
    if (source.kind === 'captured-space') {
      if (captureAssets.some((asset) => !asset)) {
        return reply.code(404).send({ error: 'asset_not_found', message: '部分实景素材不存在' });
      }
      const mismatch = captureAssets.find((asset) => asset && !captureKindMatches(source.captureType, asset.kind));
      if (mismatch) return reply.code(400).send({ error: 'asset_kind_mismatch', message: '实景素材类型与捕获方式不匹配' });
      if (source.captureType === 'images' && captureAssets.length < 20) {
        return reply.code(400).send({ error: 'capture_coverage_insufficient', message: 'Aholo 图片重建至少需要 20 张连续视角图片' });
      }
      if (source.captureType !== 'images' && captureAssets.length !== 1) {
        return reply.code(400).send({ error: 'capture_asset_count_invalid', message: '视频或 INSV 重建必须提交一个文件' });
      }
      try {
        await Promise.all(captureAssets.map((asset) => storage.verifyUploadedObject(asset!)));
      } catch (error) {
        return reply.code(409).send({
          error: errorCode(error, 'asset_not_uploaded'),
          message: error instanceof Error ? error.message : '实景素材上传尚未完成',
        });
      }
    }

    const sessionId = createId();
    const jobId = createId();
    const timestamp = now();
    const captureSources = source.kind === 'captured-space'
      ? await Promise.all(captureAssets.map(async (asset) => ({
        id: asset!.assetId,
        type: source.captureType === 'images' ? 'image' as const : 'video' as const,
        uri: await storage.createDownloadUrl(asset!, 3_600),
        mimeType: asset!.expectedMediaType,
        metadata: { captureType: source.captureType, originalFileName: asset!.originalFileName },
      })))
      : null;
    const localSources = source.kind === 'preset'
      ? [{ id: `preset-${source.preset}`, type: 'text' as const, content: source.preset }]
      : source.kind === 'uploaded-plan'
        ? [{ id: source.assetId, type: 'image' as const, uri: `asset://${source.assetId}` }]
        : [];
    const generationRequest: GenerationRequest = generationRequestSchema.parse({
      requestId: sessionId,
      providerId: source.kind === 'captured-space' ? 'aholo-world-provider' : 'shell-provider',
      sources: captureSources ?? localSources,
      quality: 'standard',
      requirements: source.kind === 'captured-space'
        ? { kind: 'aholo-space-reconstruction', captureType: source.captureType, scene: 'space' }
        : { kind: 'housing-shell', floorPlan: plan },
      metadata: { housingSessionId: sessionId },
    });
    const event = generationRequestedEventSchema.parse({
      ...eventMetadata('generation.requested', timestamp, createId),
      payload: { jobId, idempotencyKey: `shell:${sessionId}`, request: generationRequest },
    });
    const session = await repository.createHousingSession({
      sessionId,
      source,
      plan: plan ?? undefined,
      job: {
        jobId,
        request: generationRequest,
        idempotencyKey: `shell:${sessionId}`,
        now: timestamp,
        purpose: 'shell',
        housingSessionId: sessionId,
      },
      event,
    });
    return reply.code(202).send(session);
  });

  app.get<{ Params: { sessionId: string } }>('/v1/housing-sessions/:sessionId', async (request, reply) => {
    const session = await repository.findHousingSession(request.params.sessionId);
    return session ?? reply.code(404).send({ error: 'housing_session_not_found' });
  });

  app.post<{ Params: { sessionId: string } }>(
    '/v1/housing-sessions/:sessionId/shell-lock',
    async (request, reply) => {
      const session = await repository.findHousingSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
      if (session.status !== 'shell-ready' || !session.manifest || !session.sceneId) {
        return reply.code(409).send({ error: 'housing_shell_not_ready', message: '毛坯空间尚未完成，不能锁定' });
      }
      const parsed = shellLockRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalid(reply, 'invalid_shell_lock_request', parsed.error.issues);
      if (parsed.data.sceneId !== session.sceneId || parsed.data.baseRevision !== session.manifest.revision) {
        return reply.code(409).send({
          error: 'revision_conflict',
          message: '场景已变化，请刷新后重新确认空间范围',
          currentRevision: session.manifest.revision,
        });
      }
      try {
        const anchors = deriveSpatialAnchorSet(session.manifest);
        const timestamp = now();
        const event = sceneConstraintsLockedEventSchema.parse({
          ...eventMetadata('scene.constraints-locked', timestamp, createId),
          payload: {
            sessionId: session.sessionId,
            sceneId: session.sceneId,
            shellRevision: anchors.shellRevision,
            spatialAnchors: anchors,
          },
        });
        const locked = await repository.lockHousingSession(session.sessionId, anchors, timestamp, event);
        return locked ?? reply.code(409).send({ error: 'shell_lock_failed' });
      } catch (error) {
        return reply.code(422).send({
          error: errorCode(error, 'spatial_anchor_invalid'),
          message: error instanceof Error ? error.message : '空间锚点无法通过质量门',
        });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/housing-sessions/:sessionId/decoration-analyses',
    async (request, reply) => {
      const session = await repository.findHousingSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
      if (session.status !== 'shell-ready') {
        return reply.code(409).send({ error: 'housing_shell_not_ready', message: '毛坯空间生成完成后才能分析装修参考' });
      }
      const parsed = decorationAnalysisRequestSchema.safeParse({
        ...(request.body as Record<string, unknown>),
        sessionId: request.params.sessionId,
      });
      if (!parsed.success) return invalid(reply, 'invalid_decoration_analysis_request', parsed.error.issues);
      const asset = parsed.data.assetId ? await repository.findAsset(parsed.data.assetId) : null;
      if (parsed.data.assetId && !asset) return reply.code(404).send({ error: 'asset_not_found' });
      if (asset) {
        if (asset.kind !== 'decoration-reference-image') {
          return reply.code(400).send({ error: 'asset_kind_mismatch', message: '只能分析普通装修参考图片' });
        }
        try {
          await storage.verifyUploadedObject(asset);
        } catch (error) {
          return reply.code(409).send({
            error: errorCode(error, 'asset_not_uploaded'),
            message: error instanceof Error ? error.message : '装修参考图上传尚未完成',
          });
        }
      }
      const timestamp = now();
      const jobId = createId();
      const analysisId = createId();
      const event = decorationAnalysisRequestedEventSchema.parse({
        ...eventMetadata('decoration-analysis.requested', timestamp, createId),
        payload: {
          jobId,
          analysisId,
          sessionId: session.sessionId,
          sourceKind: asset ? 'image' : 'text',
          ...(asset ? {
            assetId: asset.assetId,
            storageKey: asset.storageKey,
            expectedMediaType: asset.expectedMediaType,
            expectedSizeBytes: asset.sizeBytes,
          } : {}),
          brief: parsed.data.brief,
        },
      });
      const job = await repository.createDecorationAnalysisJob({
        jobId,
        analysisId,
        sessionId: session.sessionId,
        asset: asset ?? undefined,
        brief: parsed.data.brief,
        now: timestamp,
        event,
      });
      return reply.code(202).send(job);
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/decoration-analyses/jobs/:jobId',
    async (request, reply) => {
      const job = await repository.findDecorationAnalysisJob(request.params.jobId);
      return job ?? reply.code(404).send({ error: 'decoration_analysis_job_not_found' });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/v1/housing-sessions/:sessionId/decoration-analysis',
    async (request, reply) => {
      const analysis = await repository.findLatestDecorationAnalysis(request.params.sessionId);
      return analysis ?? reply.code(404).send({ error: 'decoration_analysis_not_found' });
    },
  );

  app.post<{ Params: { sessionId: string; analysisId: string; objectId: string } }>(
    '/v1/housing-sessions/:sessionId/decoration-analyses/:analysisId/objects/:objectId/generations',
    async (request, reply) => {
      const session = await repository.findHousingSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
      if (!session.shellLocked) {
        return reply.code(409).send({ error: 'housing_shell_not_locked', message: '请先锁定空间再生成家具' });
      }
      const analysis = await repository.findLatestDecorationAnalysis(session.sessionId);
      if (!analysis || analysis.analysisId !== request.params.analysisId) {
        return reply.code(404).send({ error: 'decoration_analysis_not_found' });
      }
      const candidate = analysis.objectCandidates.find((item) => item.objectId === request.params.objectId);
      if (!candidate) return reply.code(404).send({ error: 'decoration_object_not_found' });
      if (!candidate.requiresLux3d) {
        return reply.code(422).send({
          error: 'object_not_lux3d_candidate',
          message: '该对象属于连续表面或背景，不应提交 Lux3D 单体建模',
        });
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const quality = body.quality === 'preview' ? 'preview' : 'production';
      const sourceAsset = analysis.sourceAssetId
        ? await repository.findAsset(analysis.sourceAssetId) : null;
      if (analysis.sourceKind === 'image' && !sourceAsset) {
        return reply.code(409).send({ error: 'decoration_reference_missing' });
      }
      const referenceImageUrl = sourceAsset
        ? await storage.createDownloadUrl(sourceAsset, 3_600) : undefined;
      const prompt = [
        `Photorealistic standalone ${candidate.label}.`,
        candidate.description,
        `Materials: ${candidate.materialHints.join(', ') || 'physically based realistic materials'}.`,
        `Colors: ${candidate.colorHints.join(', ') || 'follow the design style'}.`,
        `Overall interior style: ${analysis.style.name}; ${analysis.style.summary}.`,
        'Single complete object, clean topology, real-world proportions, PBR materials.',
        'No room, no floor, no wall, no people, no cartoon, no anime, no low-poly styling.',
      ].join(' ');
      const generationRequest = assetGenerationRequestSchema.parse({
        sessionId: session.sessionId,
        analysisId: analysis.analysisId,
        objectId: candidate.objectId,
        mode: analysis.sourceKind === 'image' ? 'image-guided-3d' : 'text-to-3d',
        prompt,
        referenceAssetId: sourceAsset?.assetId,
        referenceImageUrl,
        referenceBoundingBox: analysis.sourceKind === 'image' ? candidate.boundingBox : undefined,
        targetSizeMeters: candidate.estimatedSizeMeters,
        placement: candidate.placement,
        quality,
        photorealistic: true,
      });
      const timestamp = now();
      const jobId = createId();
      const event = assetGenerationRequestedEventSchema.parse({
        ...eventMetadata('asset-generation.requested', timestamp, createId),
        payload: { jobId, request: generationRequest, attempt: 1 },
      });
      const job = await repository.createAssetGenerationJob({
        jobId, request: generationRequest, now: timestamp, event,
      });
      return reply.code(202).send(job);
    },
  );

  app.get<{ Params: { jobId: string } }>('/v1/asset-generation-jobs/:jobId', async (request, reply) => {
    const job = await repository.findAssetGenerationJob(request.params.jobId);
    return job ?? reply.code(404).send({ error: 'asset_generation_job_not_found' });
  });

  app.get<{ Params: { jobId: string; artifact: 'source' | 'normalized' } }>(
    '/v1/asset-generation-jobs/:jobId/artifacts/:artifact',
    async (request, reply) => {
      const job = await repository.findAssetGenerationJob(request.params.jobId);
      if (!job) return reply.code(404).send({ error: 'asset_generation_job_not_found' });
      if (job.status !== 'complete') {
        return reply.code(409).send({ error: 'asset_generation_not_complete' });
      }
      if (!['source', 'normalized'].includes(request.params.artifact)) {
        return reply.code(404).send({ error: 'asset_generation_artifact_not_found' });
      }
      const key = `asset-generation/${job.jobId}/${request.params.artifact}.glb`;
      const syntheticAsset = {
        assetId: request.params.artifact === 'source'
          ? job.sourceGlbAssetId! : job.normalizedGlbAssetId!,
        storageKey: key,
        kind: 'reference-image' as const,
        status: 'validated' as const,
        originalFileName: `${request.params.artifact}.glb`,
        expectedMediaType: 'application/octet-stream' as const,
        sizeBytes: 1,
      };
      return {
        downloadUrl: await storage.createDownloadUrl(syntheticAsset, 900),
        expiresAt: new Date(Date.parse(now()) + 900_000).toISOString(),
      };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/asset-generation-jobs/:jobId/artifacts/normalized/content',
    async (request, reply) => {
      const job = await repository.findAssetGenerationJob(request.params.jobId);
      if (!job) return reply.code(404).send({ error: 'asset_generation_job_not_found' });
      if (job.status !== 'complete' || !job.normalizedGlbAssetId) {
        return reply.code(409).send({ error: 'asset_generation_not_complete' });
      }
      const downloadUrl = await storage.createDownloadUrl({
        assetId: job.normalizedGlbAssetId,
        storageKey: `asset-generation/${job.jobId}/normalized.glb`,
        kind: 'reference-image',
        status: 'validated',
        originalFileName: 'normalized.glb',
        expectedMediaType: 'application/octet-stream',
        sizeBytes: 1,
      }, 300);
      return reply.redirect(downloadUrl);
    },
  );

  app.post<{ Params: { jobId: string } }>('/v1/asset-generation-jobs/:jobId/retry', async (request, reply) => {
    const previous = await repository.findAssetGenerationJob(request.params.jobId);
    if (!previous) return reply.code(404).send({ error: 'asset_generation_job_not_found' });
    if (previous.status !== 'failed') {
      return reply.code(409).send({
        error: 'asset_generation_not_failed',
        message: '只有失败的 Lux3D 任务可以重试',
      });
    }
    if (!previous.retryable) {
      return reply.code(422).send({
        error: 'asset_generation_not_retryable',
        message: '该失败属于素材、质量或凭证问题，请修正后重新创建任务',
      });
    }
    const timestamp = now();
    const jobId = createId();
    const attempt = previous.attempts + 1;
    const event = assetGenerationRequestedEventSchema.parse({
      ...eventMetadata('asset-generation.requested', timestamp, createId),
      payload: { jobId, request: previous.request, attempt },
    });
    const job = await repository.createAssetGenerationJob({
      jobId,
      retryOfJobId: previous.jobId,
      attempt,
      request: previous.request,
      now: timestamp,
      event,
    });
    return reply.code(202).send(job);
  });

  app.post<{ Params: { sessionId: string } }>(
    '/v1/housing-sessions/:sessionId/decorations',
    async (request, reply) => {
      const session = await repository.findHousingSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
      if (session.status !== 'shell-ready') return reply.code(409).send({ error: 'housing_shell_not_ready' });
      if (!session.shellLocked || !session.spatialAnchors) {
        return reply.code(409).send({ error: 'housing_shell_not_locked', message: '请先确认并锁定毛坯空间' });
      }
      const parsed = decorationRequestSchema.safeParse({
        ...(request.body as Record<string, unknown>),
        sessionId: request.params.sessionId,
      });
      if (!parsed.success) return invalid(reply, 'invalid_decoration_request', parsed.error.issues);
      const analysis = await repository.findLatestDecorationAnalysis(session.sessionId);
      if (!analysis) {
        return reply.code(409).send({
          error: 'decoration_analysis_required',
          message: '请先使用一张装修参考图或文字需求完成风格分析',
        });
      }
      const referenceAssetId = parsed.data.referenceAssetIds[0];
      if (analysis.sourceKind === 'image'
        && (parsed.data.referenceAssetIds.length !== 1 || analysis.sourceAssetId !== referenceAssetId)) {
        return reply.code(409).send({
          error: 'decoration_analysis_reference_mismatch',
          message: '请使用刚刚完成分析的同一张装修参考图',
        });
      }
      if (analysis.sourceKind === 'text' && parsed.data.referenceAssetIds.length !== 0) {
        return reply.code(409).send({
          error: 'decoration_analysis_reference_mismatch',
          message: '当前方案来自纯文字分析，请不要混入未经分析的参考图',
        });
      }
      const referenceAsset = referenceAssetId ? await repository.findAsset(referenceAssetId) : null;
      if (referenceAssetId && (!referenceAsset || referenceAsset.kind !== 'decoration-reference-image')) {
        return reply.code(400).send({ error: 'decoration_reference_invalid' });
      }
      if (analysis.sourceKind === 'image' && analysis.style.realism !== 'photorealistic') {
        return reply.code(422).send({
          error: 'decoration_reference_not_photorealistic',
          message: '参考图未通过照片级写实质量门，禁止进入真实装修生成',
        });
      }
      if (analysis.sourceBrief.trim() !== parsed.data.brief.trim()) {
        return reply.code(409).send({
          error: 'decoration_analysis_stale',
          message: '装修文字要求已变化，请重新分析后再生成',
        });
      }
      const referenceUrl = referenceAsset ? await storage.createDownloadUrl(referenceAsset, 3_600) : null;
      const timestamp = now();
      const jobId = createId();
      const idempotencyHeader = request.headers['idempotency-key'];
      const idempotencyKey = typeof idempotencyHeader === 'string'
        ? idempotencyHeader
        : `decoration:${jobId}`;
      const aholoPrompt = buildAholoDecorationPrompt({
        brief: parsed.data.brief,
        analysis,
        session,
      });
      const generationRequest = generationRequestSchema.parse({
        requestId: jobId,
        providerId: 'aholo-world-provider',
        sources: [
          { id: 'aholo-decoration-prompt', type: 'text', content: aholoPrompt },
          ...(referenceAsset && referenceUrl ? [{
            id: referenceAsset.assetId,
            type: 'image' as const,
            uri: referenceUrl,
            mimeType: referenceAsset.expectedMediaType,
          }] : []),
        ],
        prompt: aholoPrompt,
        quality: 'high',
        requirements: {
          kind: 'aholo-decoration-generation',
          sceneId: session.sceneId,
          shellRevision: session.shellRevision,
          shellManifest: session.manifest,
          spatialAnchors: session.spatialAnchors,
          decorationAnalysis: analysis,
          realism: 'photorealistic',
          role: 'room-level-3dgs-visual-layer',
          lux3dObjectCandidates: analysis.objectCandidates.filter((candidate) => candidate.requiresLux3d),
          referenceImagePolicy: 'style-only-not-object-copy',
          forbiddenStyles: ['cartoon', 'anime', 'hand-painted', 'low-poly'],
        },
        metadata: { housingSessionId: session.sessionId, purpose: 'decoration' },
      });
      const event = generationRequestedEventSchema.parse({
        ...eventMetadata('generation.requested', timestamp, createId),
        payload: { jobId, idempotencyKey, request: generationRequest },
      });
      const result = await repository.createGenerationJob({
        jobId,
        request: generationRequest,
        idempotencyKey,
        now: timestamp,
        purpose: 'decoration',
        housingSessionId: session.sessionId,
      }, event);
      return reply.code(result.created ? 202 : 200).send(result.job);
    },
  );

  app.get<{ Params: { sessionId: string } }>('/v1/housing-sessions/:sessionId/source-visual', async (request, reply) => {
    if (!isUuid(request.params.sessionId)) return reply.code(404).send({ error: 'housing_session_not_found' });
    const job = await repository.findLatestSourceVisualJob(request.params.sessionId);
    return { job };
  });

  app.post<{ Params: { sessionId: string } }>('/v1/housing-sessions/:sessionId/source-visual', async (request, reply) => {
    if (!isUuid(request.params.sessionId)) return reply.code(404).send({ error: 'housing_session_not_found' });
    const session = await repository.findHousingSession(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
    if (session.source.kind !== 'uploaded-plan') {
      return reply.code(422).send({ error: 'source_render_required', message: '请先上传一张斜俯视装修效果图。' });
    }
    const { retryJobId } = (request.body ?? {}) as { retryJobId?: unknown };
    const existing = await repository.findLatestSourceVisualJob(session.sessionId);
    if (retryJobId !== undefined && (typeof retryJobId !== 'string' || !isUuid(retryJobId))) {
      return reply.code(400).send({ error: 'invalid_visual_retry' });
    }
    if (existing && (existing.jobId !== retryJobId || existing.status !== 'failed' || !canRetrySourceVisual(existing))) {
      return reply.code(200).send(existing);
    }
    if (!existing && retryJobId !== undefined) {
      return reply.code(409).send({ error: 'visual_retry_missing' });
    }
    const idempotencyKey = existing
      ? `${sourceVisualKey(session.sessionId)}:retry:${existing.jobId}` : sourceVisualKey(session.sessionId);
    if (session.status !== 'shell-ready' || !session.shellLocked || !session.manifest || !session.spatialAnchors) {
      return reply.code(409).send({ error: 'housing_shell_not_locked', message: '布局校验完成后才能生成写实空间。' });
    }
    const asset = await repository.findAsset(session.source.assetId);
    const plan = await repository.findValidatedPlan(session.source.assetId);
    if (!asset || asset.kind !== 'floor-plan' || asset.status !== 'validated' || plan?.diagnostics.planType !== 'perspective_render') {
      return reply.code(422).send({ error: 'source_render_required', message: '当前会话的原图未被识别为斜俯视装修效果图。' });
    }
    const jobId = createId();
    const timestamp = now();
    const prompt = [
      'Create a photorealistic, eye-level, walkable 3D interior from the supplied roofless oblique apartment render.',
      'The input is the layout and appearance reference for the same apartment. Keep room count and adjacency, doorways, partitions, windows, and visible furniture positions and orientation.',
      'Preserve the visible palette, flooring, cabinetry, upholstery, fixtures and lighting. Assume a realistic ceiling above the existing walls. Complete only the unseen surfaces needed for an indoor walkthrough.',
      'Show the rooms from inside at human eye level. Do not produce a dollhouse, floor plan, cutaway presentation, outdoor space, people or labels.',
    ].join('\n');
    const generationRequest = generationRequestSchema.parse({
      requestId: jobId,
      providerId: 'aholo-world-provider',
      sources: [{
        id: asset.assetId, type: 'image', uri: await storage.createDownloadUrl(asset, 3_600),
        mimeType: asset.expectedMediaType,
      }],
      prompt,
      quality: 'high',
      requirements: {
        kind: 'aholo-decoration-generation',
        sceneId: session.sceneId,
        shellRevision: session.shellRevision,
        shellManifest: session.manifest,
        spatialAnchors: session.spatialAnchors,
        realism: 'photorealistic',
        role: 'room-level-3dgs-visual-layer',
        referenceImagePolicy: 'source-render-layout-and-appearance',
      },
      metadata: { housingSessionId: session.sessionId, purpose: 'decoration' },
    });
    const event = generationRequestedEventSchema.parse({
      ...eventMetadata('generation.requested', timestamp, createId),
      payload: { jobId, idempotencyKey, request: generationRequest },
    });
    const result = await repository.createGenerationJob({
      jobId, request: generationRequest, idempotencyKey, now: timestamp,
      purpose: 'decoration', housingSessionId: session.sessionId,
    }, event);
    return reply.code(result.created ? 202 : 200).send(result.job);
  });

  app.post('/v1/generation-jobs', async (request, reply) => {
    const parsed = generationRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'invalid_generation_request', parsed.error.issues);
    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader : parsed.data.requestId;
    const timestamp = now();
    const jobId = createId();
    const event = generationRequestedEventSchema.parse({
      ...eventMetadata('generation.requested', timestamp, createId),
      payload: { jobId, idempotencyKey, request: parsed.data },
    });
    const result = await repository.createGenerationJob({
      jobId,
      request: parsed.data,
      idempotencyKey,
      now: timestamp,
    }, event);
    return reply.code(result.created ? 202 : 200).send(result.job);
  });

  app.get<{ Params: { jobId: string } }>('/v1/generation-jobs/:jobId', async (request, reply) => {
    const job = await repository.findGenerationJob(request.params.jobId);
    return job ?? reply.code(404).send({ error: 'generation_job_not_found' });
  });

  const findJobSnapshot = async (jobId: string) => {
    const generationJob = await repository.findGenerationJob(jobId);
    if (generationJob) return { kind: 'generation' as const, job: generationJob };
    const floorPlanJob = await repository.findFloorPlanJob(jobId);
    if (floorPlanJob) return { kind: 'floor-plan' as const, job: floorPlanJob };
    const decorationAnalysisJob = await repository.findDecorationAnalysisJob(jobId);
    if (decorationAnalysisJob) {
      return { kind: 'decoration-analysis' as const, job: decorationAnalysisJob };
    }
    const assetGenerationJob = await repository.findAssetGenerationJob(jobId);
    return assetGenerationJob
      ? { kind: 'asset-generation' as const, job: assetGenerationJob }
      : null;
  };

  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId', async (request, reply) => {
    if (!isUuid(request.params.jobId)) {
      return reply.code(400).send({ error: 'invalid_job_id', message: 'jobId 必须是 UUID' });
    }
    const snapshot = await findJobSnapshot(request.params.jobId);
    return snapshot ?? reply.code(404).send({ error: 'job_not_found' });
  });

  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId/events', async (request, reply) => {
    if (!isUuid(request.params.jobId)) {
      return reply.code(400).send({ error: 'invalid_job_id', message: 'jobId 必须是 UUID' });
    }
    const snapshot = await findJobSnapshot(request.params.jobId);
    if (!snapshot) {
      return reply.code(404).send({ error: 'job_not_found' });
    }

    reply.hijack();
    const response = reply.raw;
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.setHeader('x-accel-buffering', 'no');
    response.flushHeaders();
    writeSse(response, 'snapshot', snapshot);

    const terminal = ['complete', 'failed', 'cancelled'].includes(snapshot.job.status);
    if (terminal) {
      response.end();
      return;
    }

    const unsubscribe = events.subscribe(request.params.jobId, (event) => {
      writeSse(response, event.eventType, event);
      if (isTerminalEvent(event)) response.end();
    });
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), sseHeartbeatMs);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    response.once('close', cleanup);
    response.once('finish', cleanup);
  });

  return app;
}

function eventMetadata(eventType: PlatformEvent['eventType'], timestamp: string, createId: () => string) {
  return {
    eventId: createId(),
    eventType,
    version: 1,
    occurredAt: timestamp,
    traceId: createId(),
    correlationId: createId(),
    causationId: null,
  };
}

function writeSse(response: NodeJS.WritableStream, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isTerminalEvent(event: PlatformEvent): boolean {
  return event.eventType === 'generation.completed'
    || event.eventType === 'generation.failed'
    || event.eventType === 'floor-plan.validated'
    || event.eventType === 'floor-plan.rejected'
    || event.eventType === 'decoration-analysis.completed'
    || event.eventType === 'decoration-analysis.failed';
}

function buildAholoDecorationPrompt({
  brief,
  analysis,
  session,
}: {
  brief: string;
  analysis: DecorationAnalysis;
  session: HousingSession;
}): string {
  const anchors = session.spatialAnchors;
  const bounds = anchors
    ? `${round(anchors.bounds.max[0] - anchors.bounds.min[0])}m wide x ${round(anchors.bounds.max[2] - anchors.bounds.min[2])}m deep x ${round(anchors.bounds.max[1] - anchors.bounds.min[1])}m high`
    : 'the locked apartment shell';
  const palette = analysis.style.palette.join(', ') || 'natural residential colors';
  const materials = analysis.style.materials.join(', ') || 'physically based residential materials';
  const negative = [...new Set([
    ...analysis.style.negativePrompts,
    'cartoon',
    'anime',
    'hand-painted',
    'low-poly',
    'toy-like plastic',
    'unrealistic furniture proportions',
    'people',
    'text',
    'logos',
  ])].slice(0, 16).join(', ');
  const lux3dObjects = analysis.objectCandidates
    .filter((candidate) => candidate.requiresLux3d)
    .map((candidate) => candidate.label)
    .join(', ') || 'none';

  return [
    'Generate a photorealistic residential 3DGS interior visual layer for a first-person house viewing simulator.',
    `Locked shell: preserve the existing floor plan, entrance, wall boundary, room adjacency and scale. Approximate bounds: ${bounds}.`,
    `User brief: ${brief}.`,
    `Style extracted for internal generation: ${analysis.style.name}. ${analysis.style.summary}.`,
    `Reference image policy: use the uploaded image only for overall style, color palette, lighting and material mood; do not copy every visible object from the image.`,
    `Palette: ${palette}. Materials: ${materials}. Lighting: ${analysis.style.lighting}.`,
    `Room-level layout intent: ${analysis.layoutSummary}.`,
    `Objects reserved for separate Lux3D interactive mesh generation: ${lux3dObjects}. Do not depend on these objects being present in the Aholo 3DGS output.`,
    `Negative constraints: ${negative}.`,
    'No stylized, cartoon, anime, hand-painted or low-poly result. No people. No visible watermark. Keep physically plausible residential scale and camera-height navigation.',
  ].join('\n');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sourceVisualKey(sessionId: string): string {
  return `source-visual:${sessionId}`;
}

function mediaTypeExtension(mediaType: string): string {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/octet-stream': 'insv',
  } as Record<string, string>)[mediaType] ?? 'bin';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateCaptureUpload(input: {
  kind: string;
  mediaType: string;
  sizeBytes: number;
}): { error: string; message: string } | null {
  if (input.kind === 'room-capture-image' && !input.mediaType.startsWith('image/')) {
    return { error: 'unsupported_file', message: '实景图片必须是 PNG、JPG 或 WebP' };
  }
  if (input.kind === 'room-capture-video'
    && !['video/mp4', 'video/webm', 'video/quicktime'].includes(input.mediaType)) {
    return { error: 'unsupported_file', message: '实景视频必须是 MP4、WebM 或 MOV' };
  }
  if (input.kind === 'room-capture-insv' && input.mediaType !== 'application/octet-stream') {
    return { error: 'unsupported_file', message: 'Insta360 素材必须使用 INSV 文件' };
  }
  if (input.kind.startsWith('room-capture') && input.sizeBytes > 2 * 1024 * 1024 * 1024) {
    return { error: 'file_too_large', message: '单个实景素材不能超过 2 GB' };
  }
  return null;
}

function captureKindMatches(captureType: 'images' | 'video' | 'insv', kind: string): boolean {
  return (captureType === 'images' && kind === 'room-capture-image')
    || (captureType === 'video' && kind === 'room-capture-video')
    || (captureType === 'insv' && kind === 'room-capture-insv');
}

function errorCode(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return fallback;
}

function invalid(reply: { code(status: number): { send(payload: unknown): unknown } }, error: string, issues: unknown) {
  return reply.code(400).send({ error, issues });
}

async function proxySceneRequest(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  reply: { code(status: number): { send(payload: unknown): unknown } },
) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : null;
    return reply.code(response.status).send(payload);
  } catch (error) {
    return reply.code(503).send({
      error: 'scene_service_unavailable',
      message: error instanceof Error ? error.message : '场景服务暂不可用',
    });
  }
}
