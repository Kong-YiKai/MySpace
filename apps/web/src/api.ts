import type {
  FloorPlanJob,
  GenerationJob,
  HousingLayoutSource,
  HousingSession,
  PlatformEvent,
  UploadIntent,
  WallpaperPreset,
} from '@spatial-intelligence/contracts';

export async function uploadFloorPlan(file: File): Promise<string> {
  const intent = await request<UploadIntent>('/v1/assets/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'floor-plan',
      fileName: file.name,
      mediaType: file.type,
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

export async function createDecoration(
  sessionId: string,
  brief: string,
  wallpaper: WallpaperPreset,
): Promise<GenerationJob> {
  return request(`/v1/housing-sessions/${sessionId}/decorations`, {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ brief, wallpaper, referenceAssetIds: [] }),
  });
}

export function followJob(
  jobId: string,
  onEvent: (event: PlatformEvent) => void,
): Promise<PlatformEvent | { kind: 'generation' | 'floor-plan'; job: GenerationJob | FloorPlanJob }> {
  return new Promise((resolve, reject) => {
    const stream = new EventSource(`/v1/jobs/${jobId}/events`);
    const timeout = window.setTimeout(() => {
      stream.close();
      reject(new ApiError('job_timeout', '户型识别超过 6 分钟，请检查 Worker 或稍后重试。'));
    }, 6 * 60 * 1_000);
    const listeners = [
      'generation.progressed',
      'generation.completed',
      'generation.failed',
      'floor-plan.progressed',
      'floor-plan.validated',
      'floor-plan.rejected',
    ];
    const finish = (value: PlatformEvent | { kind: 'generation' | 'floor-plan'; job: GenerationJob | FloorPlanJob }) => {
      window.clearTimeout(timeout);
      stream.close();
      resolve(value);
    };
    stream.addEventListener('snapshot', (message) => {
      const snapshot = JSON.parse((message as MessageEvent).data) as {
        kind: 'generation' | 'floor-plan';
        job: GenerationJob | FloorPlanJob;
      };
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
    stream.onerror = () => {
      window.clearTimeout(timeout);
      stream.close();
      reject(new ApiError('event_stream_failed', '实时任务连接中断，请重试。'));
    };
  });
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
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const body = await response.json() as { error?: string; message?: string } & T;
  if (!response.ok) throw new ApiError(body.error ?? 'request_failed', body.message ?? '服务请求失败', response.status);
  return body;
}
