import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
  decorationAnalysisCompletedEventSchema,
  assetGenerationFailedEventSchema,
  floorPlanValidatedEventSchema,
  generationCompletedEventSchema,
  generationFailedEventSchema,
  spatialAnchorSetSchema,
} from '@spatial-intelligence/contracts';
import { createApp } from './app.js';
import { InMemoryPlatformRepository } from './inMemoryGenerationJobRepository.js';
import { JobEventBroker } from './jobEventBroker.js';
import type { AssetRecord, ObjectStorage } from './ports.js';

class FakeStorage implements ObjectStorage {
  readonly deleted: string[] = [];
  async createUploadUrl(asset: AssetRecord): Promise<string> {
    return `https://storage.example.test/${asset.storageKey}`;
  }
  async createDownloadUrl(asset: AssetRecord): Promise<string> {
    return `https://storage.example.test/download/${asset.storageKey}`;
  }
  async verifyUploadedObject(): Promise<void> {}
  async deleteObjects(storageKeys: string[]): Promise<void> { this.deleted.push(...storageKeys); }
}

const dependencies = () => ({
  repository: new InMemoryPlatformRepository(),
  storage: new FakeStorage(),
  events: new JobEventBroker(),
  now: () => '2026-08-27T00:00:00.000Z',
  createId: () => crypto.randomUUID(),
});

const recognizedPlan = () => ({
  schemaVersion: '1.0' as const,
  width: 9,
  depth: 7,
  scaleMetersPerPixel: null,
  scaleEstimated: true,
  walls: [
    { id: 'north', start: [0, 0], end: [9, 0], thickness: 0.2, height: 2.8 },
    { id: 'east', start: [9, 0], end: [9, 7], thickness: 0.2, height: 2.8 },
    { id: 'south', start: [9, 7], end: [0, 7], thickness: 0.2, height: 2.8 },
    { id: 'west', start: [0, 7], end: [0, 0], thickness: 0.2, height: 2.8 },
  ],
  openings: [],
  rooms: [{
    id: 'living-room', kind: 'living-room', label: '客厅',
    polygon: [[0, 0], [9, 0], [9, 7], [0, 7]], confidence: 0.91,
  }],
  entrance: { position: [9, 3.5], direction: [-1, 0] },
  confidence: 0.86,
  diagnostics: { recognitionAccepted: true },
});

const shellManifest = () => ({
  schemaVersion: '1.0' as const,
  sceneId: 'scene-studio',
  revision: 0,
  coordinateSystem: { upAxis: 'Y' as const, unit: 'meter' as const, handedness: 'right' as const },
  sourceRefs: [],
  assets: [],
  entities: [],
  behaviors: [],
  interactions: [],
  environment: {},
  metadata: {},
});

describe('Iteration 2 housing API', () => {
  it('creates a signed upload intent and an asynchronous validation job in the outbox', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/assets/upload-intents',
      payload: {
        kind: 'floor-plan',
        fileName: 'home.png',
        mediaType: 'image/png',
        sizeBytes: 2048,
      },
    });
    expect(intent.statusCode).toBe(201);
    expect(intent.json().uploadUrl).toContain('storage.example.test');

    const validation = await app.inject({
      method: 'POST',
      url: '/v1/floor-plans/validate',
      payload: { assetId: intent.json().assetId },
    });
    expect(validation.statusCode).toBe(202);
    expect(validation.json().status).toBe('accepted');
    const outbox = await deps.repository.takeOutboxBatch(10);
    expect(outbox[0]?.event.eventType).toBe('floor-plan.validation-requested');
    await app.close();
  });

  it('clears all ephemeral records and uploaded objects when the user returns', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/assets/upload-intents',
      payload: {
        kind: 'floor-plan', fileName: 'temporary.png', mediaType: 'image/png', sizeBytes: 2048,
      },
    });
    const assetId = intent.json().assetId as string;
    const asset = await deps.repository.findAsset(assetId);

    const response = await app.inject({ method: 'DELETE', url: '/v1/ephemeral-state' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cleared: true, deletedObjects: 1 });
    expect(await deps.repository.findAsset(assetId)).toBeNull();
    expect(deps.storage.deleted).toEqual([asset?.storageKey]);
    await app.close();
  });

  it('creates preset housing sessions through the same shell generation provider', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/housing-sessions',
      payload: { source: { kind: 'preset', preset: 'studio' } },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'shell-generating' });
    const outbox = await deps.repository.takeOutboxBatch(10);
    expect(outbox[0]?.event.eventType).toBe('generation.requested');
    if (outbox[0]?.event.eventType === 'generation.requested') {
      expect(outbox[0].event.payload.request.providerId).toBe('shell-provider');
      expect(outbox[0].event.payload.request.requirements).toHaveProperty('floorPlan');
    }
    await app.close();
  });

  it('passes recognized uploaded geometry to shell generation without a second approval gate', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const plan = recognizedPlan();
    const intent = await app.inject({
      method: 'POST', url: '/v1/assets/upload-intents',
      payload: { kind: 'floor-plan', fileName: 'home.png', mediaType: 'image/png', sizeBytes: 2048 },
    });
    const validation = await app.inject({
      method: 'POST', url: '/v1/floor-plans/validate', payload: { assetId: intent.json().assetId },
    });
    await deps.repository.apply(floorPlanValidatedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'floor-plan.validated', version: 1,
      occurredAt: '2026-08-27T00:00:01.000Z', traceId: crypto.randomUUID(),
      correlationId: validation.json().jobId, causationId: null,
      payload: {
        jobId: validation.json().jobId, assetId: intent.json().assetId,
        confidence: 0.86, plan, checksumSha256: 'b'.repeat(64),
        detectedMediaType: 'image/png', widthPixels: 1200, heightPixels: 900,
      },
    }));
    const response = await app.inject({
      method: 'POST', url: '/v1/housing-sessions',
      payload: { source: { kind: 'uploaded-plan', assetId: intent.json().assetId } },
    });
    expect(response.statusCode).toBe(202);
    const requested = (await deps.repository.takeOutboxBatch(10))
      .find((record) => record.event.eventType === 'generation.requested')?.event;
    if (requested?.eventType !== 'generation.requested') throw new Error('generation not requested');
    expect(requested.payload.request.requirements.floorPlan).toEqual(plan);
    await app.close();
  });

  it('deduplicates generic generation jobs by idempotency key', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const request = {
      method: 'POST' as const,
      url: '/v1/generation-jobs',
      headers: { 'idempotency-key': 'same-request' },
      payload: {
        requestId: 'request-001',
        sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
      },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().jobId).toBe(first.json().jobId);
    expect(await deps.repository.takeOutboxBatch(10)).toHaveLength(1);
    await app.close();
  });

  it('renders the original uploaded render and requires an explicit retry after a quota refusal', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const intent = await app.inject({
      method: 'POST', url: '/v1/assets/upload-intents',
      payload: { kind: 'floor-plan', fileName: 'render.png', mediaType: 'image/png', sizeBytes: 2048 },
    });
    const assetId = intent.json().assetId;
    const validation = await app.inject({
      method: 'POST', url: '/v1/floor-plans/validate', payload: { assetId },
    });
    const plan = { ...recognizedPlan(), diagnostics: { planType: 'perspective_render' } };
    const eventMeta = {
      version: 1, occurredAt: '2026-08-27T00:00:01.000Z',
      traceId: crypto.randomUUID(), correlationId: crypto.randomUUID(), causationId: null,
    };
    await deps.repository.apply(floorPlanValidatedEventSchema.parse({
      ...eventMeta, eventId: crypto.randomUUID(), eventType: 'floor-plan.validated',
      payload: {
        jobId: validation.json().jobId, assetId, plan, confidence: 0.86,
        checksumSha256: 'b'.repeat(64), detectedMediaType: 'image/png', widthPixels: 1200, heightPixels: 900,
      },
    }));
    const session = (await app.inject({
      method: 'POST', url: '/v1/housing-sessions', payload: { source: { kind: 'uploaded-plan', assetId } },
    })).json();
    await deps.repository.apply(generationCompletedEventSchema.parse({
      ...eventMeta, eventId: crypto.randomUUID(), eventType: 'generation.completed',
      payload: { jobId: session.shellJobId, manifest: { ...shellManifest(), metadata: { floorPlan: plan } } },
    }));
    await deps.repository.lockHousingSession(session.sessionId, spatialAnchorSetSchema.parse({
      schemaVersion: '1.0', sceneId: 'scene-studio', shellRevision: 0,
      coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
      bounds: { min: [0, 0, 0], max: [9, 2.8, 7] },
      entrance: { position: [1, 0, 0], direction: [0, 0, 1] },
      walkableBounds: { min: [0, 0, 0], max: [9, 0.1, 7] },
      provider: { providerId: 'shell-provider', sourceAssetIds: [assetId] },
      lockHash: 'a'.repeat(64),
    }), eventMeta.occurredAt);

    const url = `/v1/housing-sessions/${session.sessionId}/source-visual`;
    const first = await app.inject({ method: 'POST', url });
    expect(first.statusCode).toBe(202);
    const job = first.json();
    const requested = (await deps.repository.takeOutboxBatch(20)).map((record) => record.event)
      .find((event) => event.eventType === 'generation.requested' && event.payload.jobId === job.jobId);
    if (requested?.eventType !== 'generation.requested') throw new Error('visual generation not requested');
    expect(requested.payload.request.sources).toEqual([
      expect.objectContaining({
        id: assetId, type: 'image', mimeType: 'image/png', uri: expect.stringContaining('/download/floor-plan/'),
      }),
    ]);
    expect(requested.payload.request.requirements.referenceImagePolicy).toBe('source-render-layout-and-appearance');

    await deps.repository.apply(generationFailedEventSchema.parse({
      ...eventMeta, eventId: crypto.randomUUID(), eventType: 'generation.failed',
      payload: { jobId: job.jobId, errorCode: 'provider_insufficient_credits', errorMessage: '额度不足', retryable: false },
    }));
    expect((await app.inject({ method: 'POST', url })).json().jobId).toBe(job.jobId);
    const retried = await app.inject({ method: 'POST', url, payload: { retryJobId: job.jobId } });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().jobId).not.toBe(job.jobId);
    expect((await app.inject({ method: 'POST', url, payload: { retryJobId: job.jobId } })).json().jobId)
      .toBe(retried.json().jobId);
    expect((await app.inject({ method: 'GET', url })).json().job.jobId).toBe(retried.json().jobId);
    await app.close();
  });

  it('proxies scene commands and preserves revision-conflict status and evidence', async () => {
    const sceneService = Fastify();
    sceneService.post('/v1/scenes/:sceneId/commands', async (_request, reply) => (
      reply.code(409).send({ error: 'revision_conflict', currentRevision: 7 })
    ));
    const sceneServiceUrl = await sceneService.listen({ host: '127.0.0.1', port: 0 });
    const app = createApp({ ...dependencies(), sceneServiceUrl });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/scenes/scene-1/commands',
      payload: { commandId: 'stale', baseRevision: 6, commands: [] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'revision_conflict', currentRevision: 7 });
    await app.close();
    await sceneService.close();
  });

  it('accepts a text-only decoration analysis and creates a Lux3D text-to-3D job', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const sessionResponse = await app.inject({
      method: 'POST', url: '/v1/housing-sessions',
      payload: { source: { kind: 'preset', preset: 'studio' } },
    });
    const sessionId = sessionResponse.json().sessionId as string;
    const shellJobId = sessionResponse.json().shellJobId as string;
    await deps.repository.apply(generationCompletedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'generation.completed', version: 1,
      occurredAt: '2026-08-27T00:00:01.000Z', traceId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(), causationId: crypto.randomUUID(),
      payload: { jobId: shellJobId, manifest: shellManifest() },
    }));
    await deps.repository.takeOutboxBatch(10);

    const analysisResponse = await app.inject({
      method: 'POST',
      url: `/v1/housing-sessions/${sessionId}/decoration-analyses`,
      payload: { brief: '写实新中式客厅，胡桃木沙发与自然采光' },
    });
    expect(analysisResponse.statusCode).toBe(202);
    expect(analysisResponse.json()).not.toHaveProperty('assetId');
    const requested = (await deps.repository.takeOutboxBatch(10))
      .find((record) => record.event.eventType === 'decoration-analysis.requested')!.event;
    if (requested.eventType !== 'decoration-analysis.requested') throw new Error('unexpected event');
    expect(requested.payload.sourceKind).toBe('text');
    const analysisId = requested.payload.analysisId;
    await deps.repository.apply(decorationAnalysisCompletedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'decoration-analysis.completed', version: 1,
      occurredAt: '2026-08-27T00:00:02.000Z', traceId: requested.traceId,
      correlationId: requested.correlationId, causationId: requested.eventId,
      payload: {
        jobId: requested.payload.jobId,
        analysis: {
          schemaVersion: '1.0', analysisId, sessionId, sourceKind: 'text',
          sourceBrief: '写实新中式客厅，胡桃木沙发与自然采光',
          style: {
            name: '写实新中式', summary: '胡桃木与亚麻构成的真实住宅空间',
            realism: 'photorealistic', palette: ['胡桃木'], materials: ['木材', '亚麻'],
            lighting: '自然侧光', negativePrompts: ['cartoon'],
          },
          layoutSummary: '沙发位于客厅主要会客区',
          objectCandidates: [{
            objectId: 'main-sofa', label: '胡桃木布艺沙发', category: 'seating',
            importance: 'critical', confidence: 0.9,
            boundingBox: { x: 0, y: 0, width: 1, height: 1 },
            description: '胡桃木框架与米色亚麻软包', materialHints: ['胡桃木', '亚麻'],
            colorHints: ['深棕', '米色'],
            estimatedSizeMeters: { width: 2.2, height: 0.85, depth: 0.9 },
            placement: { support: 'floor', roomZone: 'living-room', notes: '背靠墙' },
            requiresLux3d: true, photorealisticRequired: true,
          }],
          confidence: 0.88, warnings: ['纯文字候选需要用户确认'], diagnostics: {},
        },
      },
    }));

    await deps.repository.lockHousingSession(sessionId, spatialAnchorSetSchema.parse({
      schemaVersion: '1.0', sceneId: 'scene-studio', shellRevision: 0,
      coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
      bounds: { min: [0, 0, 0], max: [8, 2.8, 6] },
      entrance: { position: [1, 0, 0], direction: [0, 0, 1], cameraHeight: 1.65 },
      walkableBounds: { min: [0.2, 0, 0.2], max: [7.8, 0.1, 5.8] },
      provider: { providerId: 'shell-provider', sourceAssetIds: [] },
      lockHash: 'a'.repeat(64),
    }), '2026-08-27T00:00:03.000Z');

    const luxResponse = await app.inject({
      method: 'POST',
      url: `/v1/housing-sessions/${sessionId}/decoration-analyses/${analysisId}/objects/main-sofa/generations`,
      payload: { quality: 'preview' },
    });
    expect(luxResponse.statusCode).toBe(202);
    expect(luxResponse.json()).toMatchObject({
      status: 'accepted', request: { mode: 'text-to-3d', quality: 'preview', photorealistic: true },
    });
    const assetRequested = (await deps.repository.takeOutboxBatch(10))
      .find((record) => record.event.eventType === 'asset-generation.requested');
    expect(assetRequested?.event.eventType).toBe('asset-generation.requested');
    const luxJobId = luxResponse.json().jobId as string;
    await deps.repository.apply(assetGenerationFailedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'asset-generation.failed', version: 1,
      occurredAt: '2026-08-27T00:00:03.000Z', traceId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(), causationId: crypto.randomUUID(),
      payload: {
        jobId: luxJobId, errorCode: 'provider_rate_limited',
        errorMessage: 'Lux3D rate limited', retryable: true,
        providerEvidence: {
          providerId: 'lux3d', operation: 'text-to-3d', status: 'failed', attempts: 1,
          inputAssetIds: [], outputAssetIds: [], errorCode: 'provider_rate_limited', diagnostics: {},
        },
      },
    }));
    const retryResponse = await app.inject({
      method: 'POST', url: `/v1/asset-generation-jobs/${luxJobId}/retry`,
    });
    expect(retryResponse.statusCode).toBe(202);
    expect(retryResponse.json()).toMatchObject({ retryOfJobId: luxJobId, attempts: 2 });
    await app.close();
  });

  it('submits Aholo decoration generation as the room-level 3DGS visual layer', async () => {
    const deps = dependencies();
    const app = createApp(deps);
    const sessionResponse = await app.inject({
      method: 'POST', url: '/v1/housing-sessions',
      payload: { source: { kind: 'preset', preset: 'studio' } },
    });
    const sessionId = sessionResponse.json().sessionId as string;
    const shellJobId = sessionResponse.json().shellJobId as string;
    await deps.repository.apply(generationCompletedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'generation.completed', version: 1,
      occurredAt: '2026-08-27T00:00:01.000Z', traceId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(), causationId: crypto.randomUUID(),
      payload: { jobId: shellJobId, manifest: shellManifest() },
    }));
    await deps.repository.lockHousingSession(sessionId, spatialAnchorSetSchema.parse({
      schemaVersion: '1.0', sceneId: 'scene-studio', shellRevision: 0,
      coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
      bounds: { min: [0, 0, 0], max: [8, 2.8, 6] },
      entrance: { position: [1, 0, 0], direction: [0, 0, 1], cameraHeight: 1.65 },
      walkableBounds: { min: [0.2, 0, 0.2], max: [7.8, 0.1, 5.8] },
      provider: { providerId: 'shell-provider', sourceAssetIds: [] },
      lockHash: 'a'.repeat(64),
    }), '2026-08-27T00:00:02.000Z');
    await deps.repository.takeOutboxBatch(10);

    const analysisId = crypto.randomUUID();
    const analysisJobId = crypto.randomUUID();
    await deps.repository.createDecorationAnalysisJob({
      jobId: analysisJobId,
      analysisId,
      sessionId,
      brief: '现代奶油风，保留宽敞客厅',
      now: '2026-08-27T00:00:03.000Z',
      event: {
        eventId: crypto.randomUUID(), eventType: 'decoration-analysis.requested', version: 1,
        occurredAt: '2026-08-27T00:00:03.000Z', traceId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(), causationId: null,
        payload: {
          jobId: analysisJobId, analysisId, sessionId, sourceKind: 'text',
          brief: '现代奶油风，保留宽敞客厅',
        },
      },
    });
    await deps.repository.apply(decorationAnalysisCompletedEventSchema.parse({
      eventId: crypto.randomUUID(), eventType: 'decoration-analysis.completed', version: 1,
      occurredAt: '2026-08-27T00:00:04.000Z', traceId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(), causationId: crypto.randomUUID(),
      payload: {
        jobId: analysisJobId,
        analysis: {
          schemaVersion: '1.0', analysisId, sessionId, sourceKind: 'text',
          sourceBrief: '现代奶油风，保留宽敞客厅',
          style: {
            name: '现代奶油风', summary: '暖白、浅木、柔和自然光的写实住宅风格',
            realism: 'uncertain', palette: ['奶油白', '浅木色'],
            materials: ['亚麻', '浅色木饰面'], lighting: '柔和自然光',
            negativePrompts: ['cartoon', 'anime'],
          },
          layoutSummary: '客厅保持开阔动线，家具靠墙组织',
          objectCandidates: [{
            objectId: 'main-sofa', label: '浅色布艺沙发', category: 'seating',
            importance: 'critical', confidence: 0.9,
            boundingBox: { x: 0, y: 0, width: 1, height: 1 },
            description: '浅色布艺沙发', materialHints: ['亚麻'], colorHints: ['奶油白'],
            estimatedSizeMeters: { width: 2.4, height: 0.85, depth: 0.95 },
            placement: { support: 'floor', roomZone: 'living-room', notes: '后续由 Lux3D 叠加' },
            requiresLux3d: true, photorealisticRequired: true,
          }],
          confidence: 0.9, warnings: [], diagnostics: {},
        },
      },
    }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/housing-sessions/${sessionId}/decorations`,
      headers: { 'idempotency-key': 'decoration-test' },
      payload: {
        brief: '现代奶油风，保留宽敞客厅',
        wallpaper: 'cream-white',
        referenceAssetIds: [],
      },
    });

    expect(response.statusCode).toBe(202);
    const requested = (await deps.repository.takeOutboxBatch(20))
      .find((record) => record.event.eventType === 'generation.requested'
        && record.event.payload.request.requirements.kind === 'aholo-decoration-generation')!.event;
    if (requested.eventType !== 'generation.requested') throw new Error('generation not requested');
    expect(requested.payload.request.providerId).toBe('aholo-world-provider');
    expect(requested.payload.request.requirements).toMatchObject({
      kind: 'aholo-decoration-generation',
      role: 'room-level-3dgs-visual-layer',
      referenceImagePolicy: 'style-only-not-object-copy',
    });
    expect(requested.payload.request.prompt).toContain('use the uploaded image only for overall style');
    expect(requested.payload.request.prompt).toContain('Objects reserved for separate Lux3D interactive mesh generation');
    await app.close();
  });
});
