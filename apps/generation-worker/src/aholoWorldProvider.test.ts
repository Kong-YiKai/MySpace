import { describe, expect, it, vi } from 'vitest';
import type { AssetClient } from '@manycore/aholo-sdk-asset';
import type { WorldClient, WorldDetail } from '@manycore/aholo-sdk-world';
import {
  AuthenticationError,
  RateLimitError,
} from '@manycore/aholo-sdk-core';
import { createAholoWorldProvider } from './aholoWorldProvider.js';

const FIXED_NOW = '2026-08-28T06:00:00.000Z';

function fakeWorldClient(overrides: {
  detail?: WorldDetail;
  listed?: WorldDetail[];
  failCreateWith?: unknown;
  failRetrieveWith?: unknown;
} = {}): { client: WorldClient; calls: { created: unknown[]; retrieves: string[] } } {
  const calls = { created: [] as unknown[], retrieves: [] as string[] };
  const detail: WorldDetail = overrides.detail ?? {
    worldId: 'world-123',
    status: 'SUCCEEDED',
    progress: 1,
    assets: {
      splats: {
        urls: {
          spzPath: 'https://cdn.example.com/output/world-123.spz',
          plyPath: 'https://cdn.example.com/output/world-123.ply',
          lodMetaPath: 'https://cdn.example.com/output/world-123-lod.json',
        },
      },
      semanticsMetadata: { upAxis: 'Z' },
    },
  };
  const client = {
    reconstructions: {
      create: async (body: unknown) => {
        calls.created.push(body);
        if (overrides.failCreateWith) throw overrides.failCreateWith;
        return { worldId: 'world-123' };
      },
    },
    generations: {
      create: async (body: unknown) => {
        calls.created.push(body);
        if (overrides.failCreateWith) throw overrides.failCreateWith;
        return { worldId: 'world-123' };
      },
    },
    retrieve: async (worldId: string) => {
      calls.retrieves.push(worldId);
      if (overrides.failRetrieveWith) throw overrides.failRetrieveWith;
      return detail;
    },
    list: async () => ({ pageNum: 0, pageSize: overrides.listed?.length ?? 0, totalCount: overrides.listed?.length ?? 0, result: overrides.listed ?? [] }),
    waitFor: async () => detail,
  } as unknown as WorldClient;
  return { client, calls };
}

function captureRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'session-001',
    providerId: 'aholo-world-provider',
    quality: 'high' as const,
    sources: Array.from({ length: 20 }, (_, index) => ({
      id: `asset-${index}`,
      type: 'image' as const,
      uri: `https://objects.example.com/capture/${index}.jpg`,
      metadata: { captureType: 'images' },
    })),
    requirements: { kind: 'aholo-space-reconstruction', captureType: 'images', scene: 'space' },
    ...overrides,
  };
}

const lockedShellManifest = {
  schemaVersion: '1.0' as const,
  sceneId: 'locked-shell-scene',
  revision: 3,
  coordinateSystem: { upAxis: 'Y' as const, unit: 'meter' as const, handedness: 'right' as const },
  sourceRefs: ['asset-floor-plan'],
  assets: [],
  entities: [{
    id: 'shell-floor', label: 'Locked floor', kind: 'floor', parentId: null,
    transform: { position: [0, -0.05, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    assetRefs: [], components: { primitive: { shape: 'box', size: [8, 0.1, 6] } },
    tags: ['structural'], interactive: false,
  }],
  behaviors: [], interactions: [], environment: {}, metadata: { floorPlan: { width: 8, depth: 6 } },
};

function decorationRequirements() {
  return {
    kind: 'aholo-decoration-generation',
    shellManifest: lockedShellManifest,
    spatialAnchors: { lockHash: 'a'.repeat(64) },
  };
}

const noopProgress = () => {};

function fakeAssetClient(): { client: AssetClient; uploads: Array<{ bytes: number; filename?: string }> } {
  const uploads: Array<{ bytes: number; filename?: string }> = [];
  return {
    uploads,
    client: {
      uploadBuffer: async (data: Buffer, options?: { filename?: string }) => {
        uploads.push({ bytes: data.byteLength, filename: options?.filename });
        return { url: `https://aholo-assets.example.com/${options?.filename ?? 'upload.jpg'}`, md5: 'md5' };
      },
    } as unknown as AssetClient,
  };
}

describe('createAholoWorldProvider', () => {
  it('通过 providerId 或 requirements.kind 声明支持', () => {
    const provider = createAholoWorldProvider({ worldClient: fakeWorldClient().client });
    expect(provider.supports(captureRequest())).toBe(true);
    expect(provider.supports({ requestId: 'x', sources: [], requirements: { kind: 'aholo-space-reconstruction' } })).toBe(true);
    expect(provider.supports({ requestId: 'x', sources: [], requirements: { kind: 'housing-shell' } })).toBe(false);
  });

  it('缺少 AHOLO_API_KEY 时抛出稳定的 provider_credentials_missing', async () => {
    const previous = process.env.AHOLO_API_KEY;
    delete process.env.AHOLO_API_KEY;
    try {
      const provider = createAholoWorldProvider({ now: () => FIXED_NOW });
      await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
        .rejects.toMatchObject({ code: 'provider_credentials_missing', retryable: false });
    } finally {
      if (previous !== undefined) process.env.AHOLO_API_KEY = previous;
    }
  });

  it('重建成功时返回带 3DGS 资产与 Provider 证据的 SceneManifest', async () => {
    const { client, calls } = fakeWorldClient();
    const provider = createAholoWorldProvider({
      worldClient: client,
      now: () => FIXED_NOW,
      sleep: async () => {},
    });
    const progress: Array<Record<string, unknown>> = [];

    const manifest = await provider.generate(captureRequest(), {
      onProgress: (event) => progress.push(event),
    }) as Record<string, any>;

    expect(calls.created).toHaveLength(1);
    const created = calls.created[0] as Record<string, unknown>;
    expect(created.scene).toBe('space');
    expect(created.taskQuality).toBe('high');
    expect((created.resources as unknown[]).length).toBe(20);
    expect((created.resources as Array<{ type?: string }>)[0].type).toBe('image');

    expect(manifest.sceneId).toBe('aholo-world-world-123');
    const splat = manifest.assets.find((asset: { kind: string }) => asset.kind === 'splat');
    expect(splat.uri).toBe('https://cdn.example.com/output/world-123.spz');
    expect(splat.format).toBe('spz');
    const evidence = manifest.metadata.providerEvidence;
    expect(evidence).toMatchObject({
      providerId: 'aholo-world-provider',
      operation: 'aholo-space-reconstruction',
      externalTaskId: 'world-123',
      status: 'succeeded',
    });
    expect(evidence.inputAssetIds).toHaveLength(20);
    expect(evidence.outputAssetIds).toContain('aholo-splat-world-123');
    expect(progress.some((event) => event.stage === 'generating')).toBe(true);
  });

  it('INSV 捕获映射为 insv 资源类型', async () => {
    const { client, calls } = fakeWorldClient();
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    await provider.generate(captureRequest({
      sources: [{ id: 'asset-insv', type: 'video', uri: 'https://objects.example.com/capture/room.insv' }],
      requirements: { kind: 'aholo-space-reconstruction', captureType: 'insv', scene: 'space' },
    }), { onProgress: noopProgress });
    const created = calls.created[0] as { resources: Array<{ type: string }> };
    expect(created.resources[0].type).toBe('insv');
  });

  it('终态失败状态映射为 provider_task_failed 并带诊断', async () => {
    const { client } = fakeWorldClient({
      detail: { worldId: 'world-123', status: 'FAILED', progress: 0.4 },
    });
    const provider = createAholoWorldProvider({
      worldClient: client,
      now: () => FIXED_NOW,
      sleep: async () => {},
    });
    await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
      .rejects.toMatchObject({
        code: 'provider_task_failed',
        retryable: false,
        evidence: { status: 'failed', errorCode: 'provider_task_failed' },
      });
  });

  it('任务成功但缺少 3DGS 产物时抛出 provider_output_missing', async () => {
    const { client } = fakeWorldClient({
      detail: { worldId: 'world-123', status: 'SUCCEEDED', progress: 1, assets: {} },
    });
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
      .rejects.toMatchObject({ code: 'provider_output_missing', retryable: true });
  });

  it('从环境变量读取轮询超时并在超时时保留最后一次官方诊断', async () => {
    const previous = process.env.AHOLO_POLL_TIMEOUT_MS;
    process.env.AHOLO_POLL_TIMEOUT_MS = '1';
    const dateNow = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValue(1_001);
    const { client, calls } = fakeWorldClient({
      detail: {
        worldId: 'world-123',
        status: 'RUNNING',
        progress: 0,
        updateTime: 1_787_997_607_000,
      },
    });

    try {
      const provider = createAholoWorldProvider({
        worldClient: client,
        now: () => FIXED_NOW,
        sleep: async () => {},
      });
      await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
        .rejects.toMatchObject({
          code: 'provider_timeout',
          retryable: true,
          evidence: {
            diagnostics: {
              worldStatus: 'RUNNING',
              providerProgress: 0,
              providerUpdatedAt: 1_787_997_607_000,
            },
          },
        });
      expect(calls.retrieves).toHaveLength(1);
    } finally {
      dateNow.mockRestore();
      if (previous === undefined) delete process.env.AHOLO_POLL_TIMEOUT_MS;
      else process.env.AHOLO_POLL_TIMEOUT_MS = previous;
    }
  });

  it('认证失败映射为 provider_auth_failed 且不可重试', async () => {
    const { client } = fakeWorldClient({ failCreateWith: new AuthenticationError('bad key') });
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
      .rejects.toMatchObject({ code: 'provider_auth_failed', retryable: false });
  });

  it('限流映射为 provider_rate_limited 且可重试', async () => {
    const { client } = fakeWorldClient({ failCreateWith: new RateLimitError('slow down') });
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    await expect(provider.generate(captureRequest(), { onProgress: noopProgress }))
      .rejects.toMatchObject({ code: 'provider_rate_limited', retryable: true });
  });

  it('装修生成走 generations.create 并携带全景参考图', async () => {
    const { client, calls } = fakeWorldClient({
      detail: {
        worldId: 'world-123',
        status: 'SUCCEEDED',
        progress: 1,
        assets: {
          splats: { urls: { plyPath: 'https://cdn.example.com/output/world-123.ply' } },
          imagery: { panoUrl: 'https://cdn.example.com/output/world-123-pano.jpg' },
        },
      },
    });
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    const manifest = await provider.generate({
      requestId: 'job-001',
      providerId: 'aholo-world-provider',
      prompt: '现代奶油风客厅',
      quality: 'high',
      sources: [
        { id: 'brief', type: 'text', content: '现代奶油风客厅' },
        { id: 'pano-1', type: 'image', uri: 'https://objects.example.com/pano.jpg' },
      ],
      requirements: decorationRequirements(),
    }, { onProgress: noopProgress }) as Record<string, any>;

    const created = calls.created[0] as { prompt: string; resources: Array<{ url: string }> };
    expect(created.prompt).toBe('现代奶油风客厅');
    expect(created.resources[0].url).toBe('https://objects.example.com/pano.jpg');
    expect(manifest.assets.some((asset: { kind: string }) => asset.kind === 'texture')).toBe(true);
    expect(manifest.metadata.providerEvidence.outputAssetIds).toContain('aholo-pano-world-123');
  });

  it('使用 Aholo Asset SDK 上传参考图后再提交 generation resource', async () => {
    const { client, calls } = fakeWorldClient();
    const assets = fakeAssetClient();
    const provider = createAholoWorldProvider({
      worldClient: client,
      assetClient: assets.client,
      sleep: async () => {},
    });

    await provider.generate({
      requestId: 'job-asset-upload',
      providerId: 'aholo-world-provider',
      prompt: 'photorealistic living room',
      quality: 'high',
      sources: [
        { id: 'brief', type: 'text', content: 'photorealistic living room' },
        {
          id: 'ref-1',
          type: 'image',
          uri: 'data:image/jpeg;base64,aGVsbG8=',
          mimeType: 'image/jpeg',
          metadata: { originalFileName: 'reference.jpg' },
        },
      ],
      requirements: decorationRequirements(),
    }, { onProgress: noopProgress });

    expect(assets.uploads).toEqual([{ bytes: 5, filename: 'reference.jpg' }]);
    const created = calls.created[0] as { resources: Array<{ url: string; type: string }> };
    expect(created.resources).toEqual([{ url: 'https://aholo-assets.example.com/reference.jpg', type: 'image' }]);
  });

  it('同一内部任务重投时恢复已有 Aholo world，不重复创建云任务', async () => {
    const { client, calls } = fakeWorldClient({
      listed: [{
        worldId: 'world-123', name: 'decoration-job-001', status: 'RUNNING', progress: 0.2,
        updateTime: 1,
      }],
    });
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    const progress: Array<Record<string, unknown>> = [];

    await provider.generate({
      requestId: 'job-001', providerId: 'aholo-world-provider', prompt: '写实奶油风',
      sources: [{ id: 'brief', type: 'text', content: '写实奶油风' }],
      requirements: decorationRequirements(),
    }, { onProgress: (event) => progress.push(event) });

    expect(calls.created).toHaveLength(0);
    expect(progress[0]).toMatchObject({
      providerEvidence: { externalTaskId: 'world-123', diagnostics: { resumedExistingTask: true } },
    });
  });

  it('装修结果只替换 Aholo 视觉层并保留锁定场景身份与结构实体', async () => {
    const { client } = fakeWorldClient();
    const provider = createAholoWorldProvider({ worldClient: client, sleep: async () => {} });
    const manifest = await provider.generate({
      requestId: 'job-composite', providerId: 'aholo-world-provider', prompt: '写实客厅',
      sources: [{ id: 'brief', type: 'text', content: '写实客厅' }],
      requirements: decorationRequirements(),
    }, { onProgress: noopProgress }) as Record<string, any>;

    expect(manifest.sceneId).toBe('locked-shell-scene');
    expect(manifest.revision).toBe(4);
    expect(manifest.coordinateSystem.upAxis).toBe('Y');
    expect(manifest.entities.some((entity: { id: string }) => entity.id === 'shell-floor')).toBe(true);
    expect(manifest.entities.some((entity: { tags: string[] }) => entity.tags.includes('aholo-visual-layer'))).toBe(true);
    expect(manifest.metadata.visualLayer.alignmentStatus).toBe('pending-client-validation');
  });
});
