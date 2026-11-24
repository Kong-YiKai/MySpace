import type {
  FloorPlanJob,
  AssetGenerationJob,
  DecorationAnalysis,
  DecorationAnalysisJob,
  GenerationJob,
  HousingLayoutSource,
  HousingSession,
  PlatformEvent,
  UploadIntent,
  UploadIntentRequest,
  CommandEnvelope,
  SceneManifest,
  SpatialAnchorSet,
  SceneMutationResult,
} from '@spatial-intelligence/contracts';

export async function uploadFloorPlan(file: File): Promise<string> {
  return uploadAsset(file, 'floor-plan');
}

export async function uploadDecorationReferenceImage(file: File): Promise<string> {
  return uploadAsset(file, 'decoration-reference-image');
}

export async function uploadCapturedSpace(files: File[]): Promise<HousingLayoutSource> {
  const images = files.every((file) => file.type.startsWith('image/'));
  const captureType = images ? 'images'
    : files[0]?.name.toLowerCase().endsWith('.insv') ? 'insv' : 'video';
  const kind = images ? 'room-capture-image'
    : captureType === 'insv' ? 'room-capture-insv' : 'room-capture-video';
  const assetIds = await Promise.all(files.map((file) => uploadAsset(file, kind)));
  return { kind: 'captured-space', assetIds, captureType };
}

async function uploadAsset(file: File, kind: UploadIntentRequest['kind']): Promise<string> {
  const intent = await request<UploadIntent>('/v1/assets/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      fileName: file.name,
      mediaType: file.type || (file.name.toLowerCase().endsWith('.insv')
        ? 'application/octet-stream' : 'video/mp4'),
      sizeBytes: file.size,
    }),
  });
  const upload = await fetch(intent.uploadUrl, {
    method: intent.method,
    headers: intent.headers,
    body: file,
  });
  if (!upload.ok) throw new ApiError('upload_failed', '户型图上传失败，请重试。', upload.status);
  return intent.assetId;
}

export async function validateFloorPlan(assetId: string): Promise<FloorPlanJob> {
  return request('/v1/floor-plans/validate', {
    method: 'POST',
    body: JSON.stringify({ assetId }),
  });
}

export async function createHousingSession(source: HousingLayoutSource): Promise<HousingSession> {
  return request('/v1/housing-sessions', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export async function getHousingSession(sessionId: string): Promise<HousingSession> {
  return request(`/v1/housing-sessions/${sessionId}`, { method: 'GET' });
}

export async function clearEphemeralState(): Promise<void> {
  await request('/v1/ephemeral-state', { method: 'DELETE' });
}

export async function lockHousingShell(session: HousingSession): Promise<HousingSession> {
  if (!session.sceneId || !session.manifest) throw new ApiError('housing_shell_not_ready', '毛坯空间尚未完成。');
  return request(`/v1/housing-sessions/${session.sessionId}/shell-lock`, {
    method: 'POST',
    body: JSON.stringify({ sceneId: session.sceneId, baseRevision: session.manifest.revision, confirmed: true }),
  });
}

export async function createDecorationAnalysis(
  sessionId: string,
  assetId: string | undefined,
  brief: string,
): Promise<DecorationAnalysisJob> {
  return request(`/v1/housing-sessions/${sessionId}/decoration-analyses`, {
    method: 'POST',
    body: JSON.stringify({ ...(assetId ? { assetId } : {}), brief }),
  });
}

export async function createDecoration(
  sessionId: string,
  brief: string,
  referenceAssetId: string | null,
): Promise<GenerationJob> {
  return request(`/v1/housing-sessions/${sessionId}/decorations`, {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      brief,
      referenceAssetIds: referenceAssetId ? [referenceAssetId] : [],
    }),
  });
}

export async function createSourceVisual(sessionId: string, retryJobId?: string): Promise<GenerationJob> {
  return request(`/v1/housing-sessions/${sessionId}/source-visual`, {
    method: 'POST', body: JSON.stringify(retryJobId ? { retryJobId } : {}),
  });
}

export async function getSourceVisual(sessionId: string): Promise<{ job: GenerationJob | null }> {
  return request(`/v1/housing-sessions/${sessionId}/source-visual`, { method: 'GET' });
}

export async function createFocusAssetGeneration(
  sessionId: string,
  analysisId: string,
  objectId: string,
): Promise<AssetGenerationJob> {
  return request(`/v1/housing-sessions/${sessionId}/decoration-analyses/${analysisId}/objects/${objectId}/generations`, {
    method: 'POST', body: JSON.stringify({ quality: 'production' }),
  });
}

export async function getAssetGenerationJob(jobId: string): Promise<AssetGenerationJob> {
  return request(`/v1/asset-generation-jobs/${jobId}`, { method: 'GET' });
}

export async function retryAssetGeneration(jobId: string): Promise<AssetGenerationJob> {
  return request(`/v1/asset-generation-jobs/${jobId}/retry`, { method: 'POST' });
}

export async function getScene(sceneId: string): Promise<{ manifest: SceneManifest; anchors: SpatialAnchorSet | null }> {
  return request(`/v1/scenes/${encodeURIComponent(sceneId)}`, { method: 'GET' });
}

export async function applySceneCommands(sceneId: string, envelope: CommandEnvelope): Promise<SceneMutationResult> {
  return request(`/v1/scenes/${encodeURIComponent(sceneId)}/commands`, {
    method: 'POST', body: JSON.stringify(envelope),
  });
}

export async function undoSceneCommand(sceneId: string, baseRevision: number): Promise<SceneMutationResult> {
  return request(`/v1/scenes/${encodeURIComponent(sceneId)}/undo`, {
    method: 'POST', body: JSON.stringify({ baseRevision }),
  });
}

type JobSnapshot =
  | { kind: 'generation'; job: GenerationJob }
  | { kind: 'floor-plan'; job: FloorPlanJob }
  | { kind: 'decoration-analysis'; job: DecorationAnalysisJob }
  | { kind: 'asset-generation'; job: AssetGenerationJob };

export function followJob(
  jobId: string,
  onEvent: (event: PlatformEvent) => void,
  options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
): Promise<PlatformEvent | JobSnapshot> {
  return new Promise((resolve, reject) => {
    const stream = new EventSource(`/v1/jobs/${jobId}/events`);
    let settled = false;
    let pollTimer = 0;
    const timeout = options.timeoutMs === null
      ? null
      : window.setTimeout(() => {
        fail(new ApiError('job_timeout', '任务等待超时，已停止本地等待；可重试并查看 Provider 诊断。'));
      }, options.timeoutMs ?? 6 * 60 * 1_000);
    const listeners = [
      'generation.progressed',
      'generation.completed',
      'generation.failed',
      'floor-plan.progressed',
      'floor-plan.validated',
      'floor-plan.rejected',
      'decoration-analysis.progressed',
      'decoration-analysis.completed',
      'decoration-analysis.failed',
      'asset-generation.progressed',
      'asset-generation.completed',
      'asset-generation.failed',
    ];
    const finish = (value: PlatformEvent | JobSnapshot) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      window.clearTimeout(pollTimer);
      stream.close();
      options.signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      window.clearTimeout(pollTimer);
      stream.close();
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => fail(new ApiError('job_cancelled', '任务已取消。'));
    const poll = async () => {
      if (settled) return;
      try {
        const snapshot = await request<JobSnapshot>(`/v1/jobs/${jobId}`, {
          method: 'GET', signal: options.signal,
        });
        if (['complete', 'failed', 'cancelled'].includes(snapshot.job.status)) {
          finish(snapshot);
          return;
        }
        const progressEvent = snapshotProgressEvent(snapshot);
        if (progressEvent) onEvent(progressEvent);
      } catch (error) {
        if (options.signal?.aborted) {
          abort();
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          fail(error);
          return;
        }
      }
      pollTimer = window.setTimeout(() => void poll(), 1_000);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    stream.addEventListener('snapshot', (message) => {
      const snapshot = JSON.parse((message as MessageEvent).data) as JobSnapshot;
      if (['complete', 'failed', 'cancelled'].includes(snapshot.job.status)) finish(snapshot);
    });
    for (const type of listeners) {
      stream.addEventListener(type, (message) => {
        const event = JSON.parse((message as MessageEvent).data) as PlatformEvent;
        onEvent(event);
        if (type.endsWith('.completed') || type.endsWith('.failed')
          || type.endsWith('.validated') || type.endsWith('.rejected')) finish(event);
      });
    }
    stream.onerror = () => { /* EventSource 自动重连；轮询保证终态不会丢。 */ };
    void poll();
  });
}

export type { DecorationAnalysis };

function snapshotProgressEvent(snapshot: JobSnapshot): PlatformEvent | null {
  if (snapshot.kind === 'asset-generation') {
    const status = snapshot.job.status;
    if (!['submitting', 'generating', 'downloading', 'normalizing'].includes(status)) return null;
    return {
      eventId: crypto.randomUUID(), eventType: 'asset-generation.progressed', version: 1,
      occurredAt: snapshot.job.updatedAt, traceId: crypto.randomUUID(), correlationId: crypto.randomUUID(), causationId: null,
      payload: {
        jobId: snapshot.job.jobId,
        status: status as 'submitting' | 'generating' | 'downloading' | 'normalizing',
        progress: snapshot.job.progress,
        externalTaskId: snapshot.job.externalTaskId,
        message: `Lux3D ${status}`,
        providerEvidence: snapshot.job.providerEvidence,
      },
    };
  }
  if (snapshot.kind !== 'generation') return null;
  const status = snapshot.job.status;
  if (status !== 'accepted' && status !== 'generating' && status !== 'normalizing') return null;
  return {
    eventId: crypto.randomUUID(),
    eventType: 'generation.progressed',
    version: 1,
    occurredAt: snapshot.job.updatedAt,
    traceId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    causationId: null,
    payload: {
      jobId: snapshot.job.jobId,
      status,
      progress: snapshot.job.progress,
      providerId: snapshot.job.providerEvidence?.providerId,
      providerEvidence: snapshot.job.providerEvidence,
      message: snapshotGenerationMessage(snapshot.job),
    },
  };
}

function snapshotGenerationMessage(job: GenerationJob): string | undefined {
  const evidence = job.providerEvidence;
  if (!evidence?.externalTaskId) return undefined;
  const worldStatus = evidence.diagnostics.worldStatus;
  const statusText = typeof worldStatus === 'string' ? worldStatus : job.status.toUpperCase();
  const lastChangedAt = evidence.diagnostics.providerLastChangedAt;
  const stalled = statusText === 'RUNNING'
    && typeof lastChangedAt === 'string'
    && Date.now() - Date.parse(lastChangedAt) >= 45_000;
  if (stalled) {
    return `Aholo 云端仍在运行，官方暂无进度增量（worldId: ${evidence.externalTaskId}）`;
  }
  return `Aholo ${statusText}（worldId: ${evidence.externalTaskId}）`;
}

class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  const body = await response.json() as { error?: string; message?: string } & T;
  if (!response.ok) throw new ApiError(body.error ?? 'request_failed', body.message ?? '服务请求失败', response.status);
  return body;
}
