import { randomUUID } from 'node:crypto';
import {
  assetGenerationCompletedEventSchema,
  assetGenerationFailedEventSchema,
  assetGenerationProgressedEventSchema,
  assetGenerationRequestedEventSchema,
  type PlatformEvent,
  type ProviderEvidence,
} from '@spatial-intelligence/contracts';
import { inspectAndNormalizeGlb } from './glbNormalizer.js';
import { createLux3dProvider } from './lux3dProvider.js';
import type { AssetStorage } from './storage.js';

const MAX_GLB_BYTES = 512 * 1024 * 1024;

export interface AssetEventPublisher { publish(event: PlatformEvent): Promise<void> }

export interface AssetGenerationProcessorOptions {
  publisher: AssetEventPublisher;
  storage: AssetStorage;
  provider?: ReturnType<typeof createLux3dProvider>;
  download?: (url: string) => Promise<Buffer>;
  now?: () => string;
  createId?: () => string;
}

export class AssetGenerationProcessor {
  readonly #publisher: AssetEventPublisher;
  readonly #storage: AssetStorage;
  readonly #provider: ReturnType<typeof createLux3dProvider>;
  readonly #download: (url: string) => Promise<Buffer>;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(options: AssetGenerationProcessorOptions) {
    this.#publisher = options.publisher;
    this.#storage = options.storage;
    this.#provider = options.provider ?? createLux3dProvider();
    this.#download = options.download ?? downloadGlb;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  async process(rawEvent: unknown): Promise<void> {
    const event = assetGenerationRequestedEventSchema.parse(rawEvent);
    const evidenceBase: ProviderEvidence = {
      providerId: 'lux3d',
      operation: event.payload.request.mode,
      status: 'accepted',
      attempts: event.payload.attempt,
      inputAssetIds: event.payload.request.referenceAssetId ? [event.payload.request.referenceAssetId] : [],
      outputAssetIds: [],
      startedAt: this.#now(),
      diagnostics: {},
    };
    try {
      await this.#progress(event, 'submitting', 0.1, '正在裁切目标物体并提交 Lux3D…');
      const result = await this.#provider.generate(event.payload.request, async (externalTaskId) => {
        await this.#progress(event, 'generating', 0.35, 'Lux3D 正在生成写实 PBR 单体模型…', externalTaskId);
      });
      await this.#progress(event, 'downloading', 0.76, '正在下载并校验 Lux3D GLB…', result.taskId, result.evidence);
      const bytes = await this.#download(result.glbUrl);
      await this.#progress(event, 'normalizing', 0.88, '正在换算米制尺寸、地面中心 pivot 与碰撞包围盒…', result.taskId);
      const inspection = inspectAndNormalizeGlb(bytes, event.payload.request.targetSizeMeters);
      const stored = await this.#storage.store(event.payload.jobId, inspection.sourceBytes, inspection.transform);
      const evidence: ProviderEvidence = {
        ...result.evidence,
        outputAssetIds: [stored.sourceGlbAssetId, stored.normalizedGlbAssetId],
        diagnostics: { ...result.evidence.diagnostics, ...inspection.diagnostics },
      };
      await this.#publisher.publish(assetGenerationCompletedEventSchema.parse({
        ...this.#metadata(event, 'asset-generation.completed'),
        payload: {
          jobId: event.payload.jobId,
          externalTaskId: result.taskId,
          ...stored,
          transform: inspection.transform,
          providerEvidence: evidence,
        },
      }));
    } catch (error) {
      const evidence = extractEvidence(error) ?? {
        ...evidenceBase,
        status: 'failed' as const,
        completedAt: this.#now(),
        errorCode: errorCode(error),
      };
      await this.#publisher.publish(assetGenerationFailedEventSchema.parse({
        ...this.#metadata(event, 'asset-generation.failed'),
        payload: {
          jobId: event.payload.jobId,
          externalTaskId: evidence.externalTaskId,
          errorCode: errorCode(error),
          errorMessage: error instanceof Error ? error.message : 'Lux3D 单体生成失败',
          retryable: isRetryable(error),
          providerEvidence: evidence,
        },
      }));
    }
  }

  async #progress(
    source: ReturnType<typeof assetGenerationRequestedEventSchema.parse>,
    status: 'submitting' | 'generating' | 'downloading' | 'normalizing',
    progress: number,
    message: string,
    externalTaskId?: string,
    providerEvidence?: ProviderEvidence,
  ): Promise<void> {
    await this.#publisher.publish(assetGenerationProgressedEventSchema.parse({
      ...this.#metadata(source, 'asset-generation.progressed'),
      payload: { jobId: source.payload.jobId, status, progress, message, externalTaskId, providerEvidence },
    }));
  }

  #metadata(source: ReturnType<typeof assetGenerationRequestedEventSchema.parse>, eventType: PlatformEvent['eventType']) {
    return {
      eventId: this.#createId(), eventType, version: 1, occurredAt: this.#now(),
      traceId: source.traceId, correlationId: source.correlationId, causationId: source.eventId,
    };
  }
}

async function downloadGlb(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw Object.assign(new Error(`GLB 下载失败：HTTP ${response.status}`), {
    code: 'provider_output_download_failed', retryable: response.status >= 500,
  });
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_GLB_BYTES) throw Object.assign(new Error('GLB 超过 512 MB'), { code: 'provider_output_too_large', retryable: false });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_GLB_BYTES) throw Object.assign(new Error('GLB 超过 512 MB'), { code: 'provider_output_too_large', retryable: false });
  return bytes;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code : 'asset_generation_failed';
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === true;
}

function extractEvidence(error: unknown): ProviderEvidence | undefined {
  return typeof error === 'object' && error !== null && 'evidence' in error
    ? error.evidence as ProviderEvidence : undefined;
}
