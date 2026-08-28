import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createHousingSessionSchema,
  decorationRequestSchema,
  floorPlanValidationRequestSchema,
  floorPlanValidationRequestedEventSchema,
  generationRequestSchema,
  generationRequestedEventSchema,
  uploadIntentRequestSchema,
  uploadIntentSchema,
  type GenerationRequest,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import type { JobEventListener, ObjectStorage, PlatformRepository } from './ports.js';
import { presetFloorPlan } from './presetFloorPlans.js';

interface AppDependencies {
  repository: PlatformRepository;
  storage: ObjectStorage;
  events: JobEventListener;
  now?: () => string;
  createId?: () => string;
  uploadUrlTtlSeconds?: number;
  sseHeartbeatMs?: number;
}

export function createApp({
  repository,
  storage,
  events,
  now = () => new Date().toISOString(),
  createId = randomUUID,
  uploadUrlTtlSeconds = 300,
  sseHeartbeatMs = 15_000,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  app.get('/ready', async () => ({ status: 'ready', service: 'api' }));

  app.post('/v1/assets/upload-intents', async (request, reply) => {
    const parsed = uploadIntentRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'invalid_upload_intent', parsed.error.issues);
    if (parsed.data.kind === 'floor-plan' && parsed.data.sizeBytes > 10 * 1024 * 1024) {
      return reply.code(400).send({ error: 'file_too_large', message: '户型图不能超过 10 MB' });
    }
    if (parsed.data.kind === 'floor-plan' && !parsed.data.mediaType.startsWith('image/')) {
      return reply.code(400).send({ error: 'unsupported_file', message: '户型图必须是 PNG、JPG 或 WebP 图片' });
    }

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
    const plan = parsed.data.source.kind === 'preset'
      ? presetFloorPlan(parsed.data.source.preset)
      : await repository.findValidatedPlan(parsed.data.source.assetId);
    if (!plan) {
      return reply.code(409).send({
        error: 'floor_plan_not_validated',
        message: '户型图尚未通过服务端识别',
      });
    }

    const sessionId = createId();
    const jobId = createId();
    const timestamp = now();
    const generationRequest: GenerationRequest = generationRequestSchema.parse({
      requestId: sessionId,
      providerId: 'shell-provider',
      sources: parsed.data.source.kind === 'preset'
        ? [{ id: `preset-${parsed.data.source.preset}`, type: 'text', content: parsed.data.source.preset }]
        : [{ id: parsed.data.source.assetId, type: 'image', uri: `asset://${parsed.data.source.assetId}` }],
      quality: 'standard',
      requirements: { kind: 'housing-shell', floorPlan: plan },
      metadata: { housingSessionId: sessionId },
    });
    const event = generationRequestedEventSchema.parse({
      ...eventMetadata('generation.requested', timestamp, createId),
      payload: { jobId, idempotencyKey: `shell:${sessionId}`, request: generationRequest },
    });
    const session = await repository.createHousingSession({
      sessionId,
      source: parsed.data.source,
      plan,
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
    '/v1/housing-sessions/:sessionId/decorations',
    async (request, reply) => {
      const session = await repository.findHousingSession(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'housing_session_not_found' });
      if (session.status !== 'shell-ready') return reply.code(409).send({ error: 'housing_shell_not_ready' });
      const parsed = decorationRequestSchema.safeParse({
        ...(request.body as Record<string, unknown>),
        sessionId: request.params.sessionId,
      });
      if (!parsed.success) return invalid(reply, 'invalid_decoration_request', parsed.error.issues);
      const timestamp = now();
      const jobId = createId();
      const idempotencyHeader = request.headers['idempotency-key'];
      const idempotencyKey = typeof idempotencyHeader === 'string'
        ? idempotencyHeader
        : `decoration:${jobId}`;
      const generationRequest = generationRequestSchema.parse({
        requestId: jobId,
        providerId: 'fake-provider',
        sources: [{ id: 'brief', type: 'text', content: parsed.data.brief }],
        prompt: parsed.data.brief,
        requirements: { wallpaper: parsed.data.wallpaper, sceneId: session.sceneId },
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

  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId/events', async (request, reply) => {
    const generationJob = await repository.findGenerationJob(request.params.jobId);
    const floorPlanJob = generationJob ? null : await repository.findFloorPlanJob(request.params.jobId);
    if (!generationJob && !floorPlanJob) return reply.code(404).send({ error: 'job_not_found' });

    reply.hijack();
    const response = reply.raw;
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.setHeader('x-accel-buffering', 'no');
    response.flushHeaders();
    writeSse(response, 'snapshot', generationJob
      ? { kind: 'generation', job: generationJob }
      : { kind: 'floor-plan', job: floorPlanJob });

    const terminal = generationJob
      ? ['complete', 'failed', 'cancelled'].includes(generationJob.status)
      : ['complete', 'failed'].includes(floorPlanJob!.status);
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
    || event.eventType === 'floor-plan.rejected';
}

function mediaTypeExtension(mediaType: string): string {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  } as Record<string, string>)[mediaType] ?? 'bin';
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
