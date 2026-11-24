import {
  AholoError,
  AuthenticationError,
  PollingTimeoutError,
  RateLimitError,
} from '@manycore/aholo-sdk-core';
import {
  createAssetClient,
  type AssetClient,
} from '@manycore/aholo-sdk-asset';
import {
  createWorldClient,
  WORLD_TERMINAL_FAILURE_STATUSES,
  type WorldClient,
  type WorldDetail,
  type WorldResourceItem,
  type WorldTaskQuality,
  type WorldTaskStatus,
} from '@manycore/aholo-sdk-world';
import {
  sceneManifestSchema,
  type ProviderEvidence,
  type SceneManifest,
} from '@spatial-intelligence/contracts';

export const AHOLO_WORLD_PROVIDER_ID = 'aholo-world-provider';

const REQUEST_KINDS = new Set(['aholo-space-reconstruction', 'aholo-decoration-generation']);

export interface AholoWorldProviderOptions {
  /** 缺省时回退到环境变量 AHOLO_API_KEY。 */
  apiKey?: string;
  /** 缺省时回退到环境变量 AHOLO_REGION，再回退到 'cn'。 */
  region?: 'cn' | 'com';
  baseUrl?: string;
  /** 测试注入；缺省时使用官方 createWorldClient。 */
  worldClient?: WorldClient;
  /** 测试注入；缺省时使用官方 createAssetClient。 */
  assetClient?: AssetClient;
  /** 轮询间隔毫秒；缺省读取 AHOLO_POLL_INTERVAL_MS，再回退到 5000。 */
  pollIntervalMs?: number;
  /** 任务等待超时毫秒；缺省读取 AHOLO_POLL_TIMEOUT_MS，再回退到 24 小时。 */
  pollTimeoutMs?: number;
  /** 测试注入定时器；缺省为 setTimeout Promise。 */
  sleep?: (ms: number) => Promise<void>;
  now?: () => string;
}

interface GenerationSource {
  id: string;
  type: 'text' | 'image' | 'video';
  uri?: string;
  content?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

interface GenerationRequestLike {
  requestId: string;
  providerId?: string;
  prompt?: string;
  quality?: 'draft' | 'standard' | 'high';
  sources: GenerationSource[];
  requirements?: Record<string, unknown>;
}

interface ProviderContext {
  signal?: AbortSignal;
  onProgress: (event: Record<string, unknown>) => void;
}

interface ProviderError extends Error {
  code: string;
  retryable: boolean;
  evidence?: ProviderEvidence;
}

function providerError(
  code: string,
  message: string,
  retryable: boolean,
  evidence?: ProviderEvidence,
): ProviderError {
  return Object.assign(new Error(message), { code, retryable, evidence });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapQuality(quality: GenerationRequestLike['quality']): WorldTaskQuality {
  if (quality === 'draft') return 'low';
  if (quality === 'high') return 'high';
  return 'normal';
}

function mapCaptureResources(request: GenerationRequestLike): WorldResourceItem[] {
  const captureType = request.requirements?.captureType;
  return request.sources
    .filter((source) => source.type !== 'text' && typeof source.uri === 'string')
    .map((source) => {
      if (captureType === 'insv') return { url: source.uri as string, type: 'insv' as const };
      if (source.type === 'video') return { url: source.uri as string, type: 'video' as const };
      return { url: source.uri as string, type: 'image' as const };
    });
}

async function uploadResourceToAholo(
  assetClient: AssetClient,
  source: GenerationSource,
  evidence: ProviderEvidence,
  signal?: AbortSignal,
): Promise<string> {
  if (!source.uri) throw new Error('source uri is required');
  const response = await fetch(source.uri, { signal });
  if (!response.ok) {
    throw providerError(
      'provider_input_fetch_failed',
      `无法读取待上传给 Aholo 的素材（HTTP ${response.status}）`,
      true,
      {
        ...evidence,
        status: 'failed',
        errorCode: 'provider_input_fetch_failed',
        completedAt: new Date().toISOString(),
        diagnostics: { ...evidence.diagnostics, sourceId: source.id, sourceUri: source.uri, httpStatus: response.status },
      },
    );
  }
  const data = Buffer.from(await response.arrayBuffer());
  const filename = typeof source.metadata?.originalFileName === 'string'
    ? source.metadata.originalFileName
    : `${source.id}.${extensionFor(source.mimeType ?? response.headers.get('content-type') ?? '')}`;
  const uploaded = await assetClient.uploadBuffer(data, { filename, signal });
  return uploaded.url;
}

async function mapAholoUploadedResources(
  assetClient: AssetClient,
  request: GenerationRequestLike,
  evidence: ProviderEvidence,
  signal?: AbortSignal,
): Promise<WorldResourceItem[]> {
  const captureType = request.requirements?.captureType;
  const resources: WorldResourceItem[] = [];
  for (const source of request.sources) {
    if (source.type === 'text' || typeof source.uri !== 'string') continue;
    const url = await uploadResourceToAholo(assetClient, source, evidence, signal);
    if (captureType === 'insv') resources.push({ url, type: 'insv' });
    else if (source.type === 'video') resources.push({ url, type: 'video' });
    else resources.push({ url, type: 'image' });
  }
  return resources;
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes('png')) return 'png';
  if (mediaType.includes('webp')) return 'webp';
  if (mediaType.includes('quicktime')) return 'mov';
  if (mediaType.includes('mp4')) return 'mp4';
  if (mediaType.includes('webm')) return 'webm';
  return 'jpg';
}

async function findExistingWorld(client: WorldClient, name: string, signal?: AbortSignal) {
  const page = await client.list({ pageNum: 0, pageSize: 100 }, { signal });
  const matches = (page.result ?? [])
    .filter((world) => world.name === name && world.status !== 'FAILED'
      && world.status !== 'CANCELED' && world.status !== 'TIMEOUT' && world.status !== 'REJECTED')
    .sort((left, right) => (right.updateTime ?? 0) - (left.updateTime ?? 0));
  return matches.find((world) => world.status === 'SUCCEEDED') ?? matches[0];
}

function evidenceBase(
  operation: string,
  request: GenerationRequestLike,
  now: () => string,
): ProviderEvidence {
  return {
    providerId: AHOLO_WORLD_PROVIDER_ID,
    operation,
    status: 'accepted',
    attempts: 1,
    inputAssetIds: request.sources.map((source) => source.id),
    outputAssetIds: [],
    startedAt: now(),
    diagnostics: {},
  };
}

function decorationManifest(
  request: GenerationRequestLike,
  visualManifest: SceneManifest,
  evidence: ProviderEvidence,
): SceneManifest {
  if (request.requirements?.kind !== 'aholo-decoration-generation') return visualManifest;
  const shell = sceneManifestSchema.safeParse(request.requirements.shellManifest);
  if (!shell.success) {
    throw providerError(
      'spatial_baseline_missing',
      'Aholo 视觉层缺少已锁定的毛坯场景基线，禁止覆盖空间事实',
      false,
      {
        ...evidence,
        status: 'failed',
        errorCode: 'spatial_baseline_missing',
        diagnostics: { ...evidence.diagnostics, shellManifestIssues: shell.error.issues.length },
      },
    );
  }

  const retainedAssets = shell.data.assets.filter((asset) => (
    asset.metadata.role !== 'shell-splat'
    && asset.metadata.role !== 'generated-panorama'
  ));
  const retainedEntities = shell.data.entities.filter((entity) => !entity.tags.includes('aholo-visual-layer'));
  const splatAsset = visualManifest.assets.find((asset) => asset.kind === 'splat');
  const visualEntity = visualManifest.entities.find((entity) => entity.kind === 'splat-shell');
  if (!splatAsset || !visualEntity) {
    throw providerError(
      'provider_output_missing',
      'Aholo 成功结果缺少可装配的 3DGS 视觉层',
      true,
      { ...evidence, status: 'failed', errorCode: 'provider_output_missing' },
    );
  }

  const lockHash = asRecord(request.requirements.spatialAnchors)?.lockHash;
  return sceneManifestSchema.parse({
    ...shell.data,
    revision: shell.data.revision + 1,
    sourceRefs: [...new Set([...shell.data.sourceRefs, ...visualManifest.sourceRefs])],
    assets: [
      ...retainedAssets,
      ...visualManifest.assets.map((asset) => ({
        ...asset,
        metadata: {
          ...asset.metadata,
          visualLayer: 'aholo-3dgs',
          nativeCoordinateSystem: visualManifest.coordinateSystem,
        },
      })),
    ],
    entities: [
      ...retainedEntities,
      {
        ...visualEntity,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          ...visualEntity.components,
          spatialAlignment: {
            status: 'pending-client-validation',
            method: 'robust-bounds-to-locked-anchor-set',
            lockHash: typeof lockHash === 'string' ? lockHash : undefined,
          },
        },
        tags: [...new Set([...visualEntity.tags, 'aholo-visual-layer'])],
      },
    ],
    metadata: {
      ...shell.data.metadata,
      providerEvidence: evidence,
      visualLayer: {
        providerId: AHOLO_WORLD_PROVIDER_ID,
        externalProjectId: evidence.externalProjectId,
        assetId: splatAsset.id,
        alignmentStatus: 'pending-client-validation',
        referenceImagePolicy: request.requirements.referenceImagePolicy,
        shellLockHash: typeof lockHash === 'string' ? lockHash : null,
      },
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapAholoError(error: unknown, evidence: ProviderEvidence): ProviderError {
  const failed = { ...evidence, status: 'failed' as const, completedAt: new Date().toISOString() };
  if (error instanceof AuthenticationError) {
    return providerError('provider_auth_failed', 'Aholo 凭证无效或已过期', false, {
      ...failed,
      errorCode: 'provider_auth_failed',
    });
  }
  if (error instanceof RateLimitError) {
    return providerError('provider_rate_limited', 'Aholo 限流，稍后自动重试', true, {
      ...failed,
      errorCode: 'provider_rate_limited',
    });
  }
  if (error instanceof PollingTimeoutError) {
    return providerError('provider_timeout', 'Aholo 任务等待超时', true, {
      ...failed,
      errorCode: 'provider_timeout',
    });
  }
  if (error instanceof AholoError) {
    if (!evidence.externalTaskId && /credit not enough|insufficient credits?/i.test(error.message)) {
      return providerError('provider_insufficient_credits', 'Aholo 生成额度不足。补充额度后可重试。', false, {
        ...failed, errorCode: 'provider_insufficient_credits',
      });
    }
    const retryable = typeof error.statusCode === 'number' && error.statusCode >= 500;
    return providerError(
      'provider_request_failed',
      `Aholo 请求失败：${error.message}`,
      retryable,
      { ...failed, errorCode: 'provider_request_failed' },
    );
  }
  return providerError(
    'generation_failed',
    error instanceof Error ? error.message : 'Aholo 生成失败',
    false,
    { ...failed, errorCode: 'generation_failed' },
  );
}

export function createAholoWorldProvider(options: AholoWorldProviderOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? defaultSleep;
  const configuredDuration = (value: string | undefined, fallbackMs: number) => {
    if (!value) return fallbackMs;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
  };
  const pollIntervalMs = options.pollIntervalMs
    ?? configuredDuration(process.env.AHOLO_POLL_INTERVAL_MS, 5_000);
  const pollTimeoutMs = options.pollTimeoutMs
    ?? configuredDuration(process.env.AHOLO_POLL_TIMEOUT_MS, 24 * 60 * 60 * 1_000);

  const resolveClient = (evidence: ProviderEvidence): WorldClient => {
    if (options.worldClient) return options.worldClient;
    const apiKey = options.apiKey ?? process.env.AHOLO_API_KEY;
    if (!apiKey) {
      throw providerError(
        'provider_credentials_missing',
        '缺少 AHOLO_API_KEY，无法调用 Aholo 真实服务',
        false,
        { ...evidence, status: 'failed', errorCode: 'provider_credentials_missing', completedAt: now() },
      );
    }
    const region = options.region
      ?? (process.env.AHOLO_REGION === 'com' ? 'com' : 'cn');
    return createWorldClient({ apiKey, region, baseUrl: options.baseUrl });
  };

  const resolveAssetClient = (evidence: ProviderEvidence): AssetClient => {
    if (options.assetClient) return options.assetClient;
    const apiKey = options.apiKey ?? process.env.AHOLO_API_KEY;
    if (!apiKey) {
      throw providerError(
        'provider_credentials_missing',
        '缺少 AHOLO_API_KEY，无法上传 Aholo 输入素材',
        false,
        { ...evidence, status: 'failed', errorCode: 'provider_credentials_missing', completedAt: now() },
      );
    }
    const region = options.region
      ?? (process.env.AHOLO_REGION === 'com' ? 'com' : 'cn');
    return createAssetClient({ apiKey, region, baseUrl: options.baseUrl });
  };

  const waitForWorld = async (
    client: WorldClient,
    worldId: string,
    evidence: ProviderEvidence,
    context: ProviderContext,
  ): Promise<WorldDetail> => {
    const deadline = Date.now() + pollTimeoutMs;
    let lastProviderProgress: number | null = null;
    let lastProviderStatus: string | null = null;
    let lastProviderChangeAt = now();
    let latestProviderEvidence = evidence;
    for (;;) {
      if (context.signal?.aborted) {
        throw providerError('provider_cancelled', 'Aholo 任务已取消', false, {
          ...evidence,
          status: 'failed',
          errorCode: 'provider_cancelled',
          completedAt: now(),
        });
      }
      const detail = await client.retrieve(worldId, { signal: context.signal });
      const status = detail.status as WorldTaskStatus | undefined;
      if (status === 'SUCCEEDED') return detail;
      if (status && WORLD_TERMINAL_FAILURE_STATUSES.includes(status)) {
        throw providerError(
          'provider_task_failed',
          `Aholo 任务终态失败：${status}`,
          status === 'TIMEOUT',
          {
            ...evidence,
            status: 'failed',
            errorCode: 'provider_task_failed',
            completedAt: now(),
            diagnostics: { ...evidence.diagnostics, worldStatus: status },
          },
        );
      }
      const providerProgress = typeof detail.progress === 'number' ? detail.progress : null;
      if (providerProgress !== lastProviderProgress || (status ?? null) !== lastProviderStatus) {
        lastProviderProgress = providerProgress;
        lastProviderStatus = status ?? null;
        lastProviderChangeAt = now();
      }
      const providerEvidence: ProviderEvidence = {
        ...evidence,
        status: 'running',
        diagnostics: {
          ...evidence.diagnostics,
          worldStatus: status ?? 'UNKNOWN',
          providerProgress,
          providerUpdatedAt: detail.updateTime ?? null,
          providerLastChangedAt: lastProviderChangeAt,
          lastPolledAt: now(),
        },
      };
      latestProviderEvidence = providerEvidence;
      context.onProgress({
        stage: 'generating',
        progress: typeof detail.progress === 'number'
          ? Math.min(0.89, Math.max(0.05, detail.progress * 0.89))
          : 0.05,
        providerId: AHOLO_WORLD_PROVIDER_ID,
        providerEvidence,
        message: status === 'PENDING'
          ? `Aholo 云端排队中（任务 ${worldId}）…`
          : status === 'PREPROCESSING'
            ? `Aholo 正在预处理输入（任务 ${worldId}）…`
            : `Aholo 正在生成 3DGS 空间（任务 ${worldId}）…`,
      });
      if (Date.now() >= deadline) {
        throw providerError('provider_timeout', 'Aholo 任务等待超时', true, {
          ...latestProviderEvidence,
          status: 'failed',
          errorCode: 'provider_timeout',
          completedAt: now(),
        });
      }
      await sleep(pollIntervalMs);
    }
  };

  return {
    id: AHOLO_WORLD_PROVIDER_ID,
    supports: (request: GenerationRequestLike) => (
      request.providerId === AHOLO_WORLD_PROVIDER_ID
      || REQUEST_KINDS.has(String(request.requirements?.kind))
    ),
    generate: async (request: GenerationRequestLike, context: ProviderContext) => {
      const kind = String(request.requirements?.kind ?? 'aholo-space-reconstruction');
      const evidence = evidenceBase(kind, request, now);
      const client = resolveClient(evidence);
      const hasExternalInputs = request.sources.some((source) => source.type !== 'text' && source.uri);
      const assetClient = hasExternalInputs && (options.assetClient || !options.worldClient)
        ? resolveAssetClient(evidence)
        : null;
      evidence.status = 'running';

      try {
        let worldId: string;
        let resumed = false;
        if (kind === 'aholo-decoration-generation') {
          const name = `decoration-${request.requestId}`;
          const existing = await findExistingWorld(client, name, context.signal);
          if (existing) {
            worldId = existing.worldId;
            resumed = true;
          } else {
            const reference = request.sources.find((source) => source.type === 'image' && source.uri);
            const referenceUrl = reference && assetClient
              ? await uploadResourceToAholo(assetClient, reference, evidence, context.signal)
              : reference?.uri;
            const resources = referenceUrl ? [{ url: referenceUrl, type: 'image' as const }] : undefined;
            const operation = await client.generations.create({
              name,
              prompt: request.prompt ?? '',
              resources,
            }, { signal: context.signal });
            worldId = operation.worldId;
          }
        } else {
          const resources = assetClient
            ? await mapAholoUploadedResources(assetClient, request, evidence, context.signal)
            : mapCaptureResources(request);
          if (resources.length === 0) {
            throw providerError(
              'provider_input_invalid',
              'Aholo 重建需要至少一个图片/视频/INSV 素材 URL',
              false,
              { ...evidence, status: 'failed', errorCode: 'provider_input_invalid', completedAt: now() },
            );
          }
          const name = `shell-${request.requestId}`;
          const existing = await findExistingWorld(client, name, context.signal);
          if (existing) {
            worldId = existing.worldId;
            resumed = true;
          } else {
            const operation = await client.reconstructions.create({
              name,
              resources,
              taskQuality: mapQuality(request.quality),
              scene: 'space',
            }, { signal: context.signal });
            worldId = operation.worldId;
          }
        }

        evidence.externalTaskId = worldId;
        evidence.externalProjectId = worldId;
        evidence.diagnostics = { resumedExistingTask: resumed };
        context.onProgress({
          stage: 'generating',
          progress: 0.05,
          providerId: AHOLO_WORLD_PROVIDER_ID,
          providerEvidence: evidence,
          message: resumed
            ? `已恢复 Aholo 任务 ${worldId}，未重复提交…`
            : `Aholo 任务 ${worldId} 已受理，等待 3DGS 产出…`,
        });

        const detail = await waitForWorld(client, worldId, evidence, context);
        const splatUrls = detail.assets?.splats?.urls;
        const splatUri = splatUrls?.spzPath ?? splatUrls?.plyPath;
        if (!splatUri) {
          throw providerError(
            'provider_output_missing',
            'Aholo 任务成功但未返回 3DGS 产物',
            true,
            {
              ...evidence,
              status: 'failed',
              errorCode: 'provider_output_missing',
              completedAt: now(),
              diagnostics: { ...evidence.diagnostics, worldStatus: detail.status },
            },
          );
        }

        const splatAssetId = `aholo-splat-${worldId}`;
        const outputAssetIds = [splatAssetId];
        const panoUrl = detail.assets?.imagery?.panoUrl;
        if (panoUrl) outputAssetIds.push(`aholo-pano-${worldId}`);
        const succeededEvidence: ProviderEvidence = {
          ...evidence,
          status: 'succeeded',
          outputAssetIds,
          completedAt: now(),
          diagnostics: {
            ...evidence.diagnostics,
            worldStatus: detail.status,
            upAxis: detail.assets?.semanticsMetadata?.upAxis ?? 'Z',
            splatFormat: splatUrls?.spzPath ? 'spz' : 'ply',
            hasLodMeta: Boolean(splatUrls?.lodMetaPath),
            hasPanorama: Boolean(panoUrl),
          },
        };

        const visualManifest = sceneManifestSchema.parse({
          schemaVersion: '1.0',
          sceneId: `aholo-world-${worldId}`,
          revision: 0,
          coordinateSystem: {
            upAxis: detail.assets?.semanticsMetadata?.upAxis ?? 'Z',
            unit: 'meter',
            handedness: 'right',
          },
          sourceRefs: request.sources.map((source) => source.id),
          assets: [
            {
              id: splatAssetId,
              kind: 'splat',
              uri: splatUri,
              format: splatUrls?.spzPath ? 'spz' : 'ply',
              metadata: {
                role: 'shell-splat',
                worldId,
                lodMetaPath: splatUrls?.lodMetaPath,
                plyPath: splatUrls?.plyPath,
                nativeUpAxis: detail.assets?.semanticsMetadata?.upAxis ?? 'Z',
                semanticsMetadata: detail.assets?.semanticsMetadata ?? {},
              },
            },
            ...(panoUrl ? [{
              id: `aholo-pano-${worldId}`,
              kind: 'texture' as const,
              uri: panoUrl,
              format: 'jpg',
              metadata: { role: 'generated-panorama', worldId },
            }] : []),
          ],
          entities: [{
            id: `aholo-shell-${worldId}`,
            label: 'Aholo 3DGS 毛坯实景',
            kind: 'splat-shell',
            assetRefs: [splatAssetId],
            components: {},
            tags: ['shell', 'splat'],
          }],
          metadata: {
            kind,
            providerId: AHOLO_WORLD_PROVIDER_ID,
            externalProjectId: worldId,
            providerEvidence: succeededEvidence,
          },
        });
        return decorationManifest(request, visualManifest, succeededEvidence);
      } catch (error) {
        if ((error as ProviderError).code) throw error;
        throw mapAholoError(error, evidence);
      }
    },
  };
}
