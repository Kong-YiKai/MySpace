import {
  createLux3dClient,
  type ImgTo3dRequest,
  type Lux3dTaskResult,
  type TextTo3dRequest,
  type WaitForLux3dTaskOptions,
} from '@manycore/aholo-sdk-lux3d';
import type { AssetGenerationRequest, ProviderEvidence } from '@spatial-intelligence/contracts';
import { prepareObjectReference } from './referenceImage.js';

export interface Lux3dGenerationResult {
  taskId: string;
  glbUrl: string;
  evidence: ProviderEvidence;
}

export interface Lux3dProviderOptions {
  apiKey?: string;
  region?: 'cn' | 'com';
  client?: Lux3dClientLike;
  prepareReference?: typeof prepareObjectReference;
  now?: () => string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface Lux3dClientLike {
  imgTo3d: { create(body: ImgTo3dRequest): Promise<number> };
  textTo3d: { create(body: TextTo3dRequest): Promise<number> };
  tasks: { waitFor(taskId: number, options?: WaitForLux3dTaskOptions): Promise<Lux3dTaskResult> };
}

export function createLux3dProvider(options: Lux3dProviderOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const prepareReference = options.prepareReference ?? prepareObjectReference;
  return {
    generate: async (
      request: AssetGenerationRequest,
      onSubmitted: (taskId: string) => Promise<void>,
    ): Promise<Lux3dGenerationResult> => {
      const startedAt = now();
      const evidence: ProviderEvidence = {
        providerId: 'lux3d',
        operation: request.mode,
        status: 'accepted',
        attempts: 1,
        inputAssetIds: request.referenceAssetId ? [request.referenceAssetId] : [],
        outputAssetIds: [],
        startedAt,
        diagnostics: {
          sdk: '@manycore/aholo-sdk-lux3d@1.6.0',
          quality: request.quality,
          style: 'photorealistic',
          pbr: true,
        },
      };
      try {
        const client = options.client ?? resolveClient(options);
        const faceCount = request.quality === 'preview' ? 50_000 : 200_000;
        let taskId: number;
        if (request.mode === 'image-guided-3d') {
          const image = await prepareReference(request.referenceImageUrl!, request.referenceBoundingBox!);
          taskId = await client.textTo3d.create({
            img: image,
            prompt: request.prompt,
            style: 'photorealistic',
            version: 'G1-Turbo',
            faceCount,
            outputFormat: ['glb'],
            enablePbr: true,
            aiPredictSize: true,
          });
        } else {
          taskId = await client.textTo3d.create({
            prompt: request.prompt,
            style: 'photorealistic',
            version: 'G1-Turbo',
            faceCount,
            outputFormat: ['glb'],
            enablePbr: true,
            aiPredictSize: true,
          });
        }
        const externalTaskId = String(taskId);
        evidence.externalTaskId = externalTaskId;
        evidence.status = 'running';
        await onSubmitted(externalTaskId);
        const result = await client.tasks.waitFor(taskId, {
          intervalMs: options.pollIntervalMs ?? Number(process.env.LUX3D_POLL_INTERVAL_MS ?? 5_000),
          timeoutMs: options.timeoutMs ?? Number(process.env.LUX3D_POLL_TIMEOUT_MS ?? 900_000),
        });
        const glbUrl = result.outputs
          .map((output) => output.content)
          .find((content): content is string => typeof content === 'string' && /^https?:\/\//.test(content));
        if (!glbUrl) throw providerError('provider_output_missing', 'Lux3D 成功任务未返回 GLB URL', false, evidence);
        return {
          taskId: externalTaskId,
          glbUrl,
          evidence: { ...evidence, status: 'succeeded', completedAt: now() },
        };
      } catch (error) {
        if (isProviderError(error)) throw error;
        const message = error instanceof Error ? error.message : 'Lux3D 调用失败';
        const lower = message.toLowerCase();
        const auth = lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401');
        const retryable = !auth && (lower.includes('timeout') || lower.includes('429') || lower.includes('rate') || lower.includes('5'));
        throw providerError(
          auth ? 'provider_auth_failed' : 'provider_request_failed',
          auth ? 'Lux3D 凭证无效或已过期' : `Lux3D 请求失败：${message}`,
          retryable,
          { ...evidence, status: 'failed', completedAt: now() },
        );
      }
    },
  };
}

function resolveClient(options: Lux3dProviderOptions): Lux3dClientLike {
  const apiKey = options.apiKey ?? process.env.AHOLO_API_KEY;
  if (!apiKey) {
    throw providerError('provider_credentials_missing', '缺少 AHOLO_API_KEY，无法调用 Lux3D', false, {
      providerId: 'lux3d', operation: 'create', status: 'failed', attempts: 1,
      inputAssetIds: [], outputAssetIds: [], diagnostics: {},
    });
  }
  const region = options.region ?? (process.env.AHOLO_REGION === 'com' ? 'com' : 'cn');
  return createLux3dClient({ apiKey, region });
}

function providerError(code: string, message: string, retryable: boolean, evidence: ProviderEvidence): Error {
  return Object.assign(new Error(message), {
    code,
    retryable,
    evidence: { ...evidence, errorCode: code },
  });
}

function isProviderError(error: unknown): error is Error & { evidence: ProviderEvidence } {
  return typeof error === 'object' && error !== null && 'evidence' in error;
}
