import {
  useEffect,
  useCallback,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { canRetrySourceVisual, sceneManifestSchema, spatialAnchorSetSchema } from '@spatial-intelligence/contracts';
import type {
  AssetGenerationJob,
  DecorationAnalysis,
  DecorationObjectCandidate,
  GenerationJob,
  HousingLayoutSource,
  HousingSession,
  ProviderEvidence,
  SceneManifest,
} from '@spatial-intelligence/contracts';
import { RoomScene } from './components/RoomScene';
import { Lux3dAssetQa } from './components/Lux3dAssetQa';
import {
  defaultBrief,
  experienceReducer,
  initialExperienceState,
  type ExperienceState,
} from './domain/experience';
import { validateFloorPlanFile } from './domain/floorPlanValidator';
import { validateSceneMutation } from '../../scene-service/src/spatialConstraints';
import {
  createDecoration,
  createDecorationAnalysis,
  createFocusAssetGeneration,
  createHousingSession,
  createSourceVisual,
  applySceneCommands,
  followJob,
  getAssetGenerationJob,
  getHousingSession,
  getScene,
  getSourceVisual,
  lockHousingShell,
  retryAssetGeneration,
  uploadCapturedSpace,
  undoSceneCommand,
  uploadDecorationReferenceImage,
  uploadFloorPlan,
  validateFloorPlan,
} from './api';

interface FurnitureGenerationState {
  status: 'idle' | 'generating' | 'assembling' | 'complete' | 'failed';
  label: string;
  candidate: DecorationObjectCandidate | null;
  progress: number;
  jobId: string | null;
  externalTaskId: string | null;
  message: string;
  retryable: boolean;
}

interface CloudEnhancementState {
  status: 'idle' | 'submitting' | 'running' | 'complete' | 'failed';
  progress: number;
  message: string;
  providerEvidence: ProviderEvidence | null;
  retryJobId?: string;
}

const initialFurnitureState: FurnitureGenerationState = {
  status: 'idle', label: '', candidate: null, progress: 0, jobId: null,
  externalTaskId: null, message: '', retryable: false,
};

const initialCloudEnhancementState: CloudEnhancementState = {
  status: 'idle', progress: 0, message: '', providerEvidence: null,
};
const publicExhibit = import.meta.env.VITE_PUBLIC_EXHIBIT === 'true';

export function App() {
  const [state, dispatch] = useReducer(experienceReducer, initialExperienceState);
  const [cleanupReady, setCleanupReady] = useState(Boolean(new URLSearchParams(window.location.search).get('qaAsset')));
  const [furniture, setFurniture] = useState<FurnitureGenerationState>(initialFurnitureState);
  const [cloudEnhancement, setCloudEnhancement] = useState<CloudEnhancementState>(initialCloudEnhancementState);
  const [layoutOnly, setLayoutOnly] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [furnitureEdit, setFurnitureEdit] = useState({ busy: false, message: '', undoDepth: 0 });
  const editingFurniture = useRef(false);
  const localUndo = useRef<SceneManifest[]>([]);
  const activeOperation = useRef(new AbortController());
  const trackedCloudJob = useRef<string | null>(null);
  const qaAssetUrl = new URLSearchParams(window.location.search).get('qaAsset');

  useEffect(() => {
    if (qaAssetUrl) return;
    if (publicExhibit) {
      setCleanupReady(true);
      return;
    }
    const sessionId = new URLSearchParams(window.location.search).get('session');
    if (!sessionId) {
      setCleanupReady(true);
      return;
    }
    const { signal } = activeOperation.current;
    void (async () => {
      try {
        const session = await getHousingSession(sessionId);
        if (!session.manifest || !session.sceneId || session.status !== 'shell-ready') {
          throw new Error('该场景尚未就绪，请重新导入。');
        }
        const latest = await getScene(session.sceneId).catch(() => null);
        signal.throwIfAborted();
        dispatch({
          type: 'RESTORE_SESSION', session, name: describeLayout(session.source),
          manifest: latest?.manifest ?? session.manifest,
        });
      } catch (error) {
        if (!signal.aborted) {
          setSessionUrl(null);
          dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '无法打开保存的场景。') });
        }
      } finally {
        if (!signal.aborted) setCleanupReady(true);
      }
    })();
  }, [qaAssetUrl]);

  const beginShell = async (source: HousingLayoutSource, name: string) => {
    dispatch({ type: 'SELECT_LAYOUT', source, name });
    try {
      if (publicExhibit && source.kind === 'preset') {
        const signal = activeOperation.current.signal;
        const response = await fetch(`${import.meta.env.BASE_URL}preset-${source.preset}.json`, { signal });
        if (!response.ok) throw new Error('示例户型加载失败，请重试。');
        const preset = await response.json();
        const manifest = sceneManifestSchema.parse(preset.manifest);
        const spatialAnchors = spatialAnchorSetSchema.parse(preset.spatialAnchors);
        signal.throwIfAborted();
        dispatch({ type: 'SHELL_SESSION_STARTED', sessionId: manifest.sceneId, jobId: manifest.sceneId });
        dispatch({ type: 'SHELL_READY', manifest, spatialAnchors });
        dispatch({ type: 'SHELL_LOCKED', spatialAnchors });
        return;
      }
      const session = await createHousingSession(source);
      dispatch({ type: 'SHELL_SESSION_STARTED', sessionId: session.sessionId, jobId: session.shellJobId });
      await followJob(session.shellJobId, (event) => {
        if (event.eventType === 'generation.progressed') {
          dispatch({
            type: 'SHELL_PROGRESS',
            progress: Math.round(event.payload.progress * 100),
            message: event.payload.message ?? shellProgressMessage(event.payload.status),
          });
        }
        if (event.eventType === 'generation.failed') {
          dispatch({ type: 'PLAN_REJECTED', message: event.payload.errorMessage });
        }
      }, { signal: activeOperation.current.signal });
      const completed = await getHousingSession(session.sessionId);
      if (completed.status !== 'shell-ready' || !completed.manifest) {
        throw new Error(completed.errorMessage ?? '毛坯空间生成失败，请重试。');
      }
      dispatch({ type: 'SHELL_READY', manifest: completed.manifest, spatialAnchors: completed.spatialAnchors });
      setSessionUrl(completed.sessionId);
    } catch (error) {
      if (!isCancelled(error)) dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '毛坯空间生成失败，请重试。') });
    }
  };

  const handlePlanUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    dispatch({ type: 'VALIDATE_PLAN' });
    const result = await validateFloorPlanFile(file);
    if (!result.accepted) {
      dispatch({ type: 'PLAN_REJECTED', message: result.reason ?? '未识别到有效户型图。' });
      return;
    }
    try {
      const assetId = await uploadFloorPlan(file);
      const job = await validateFloorPlan(assetId);
      const result = await followJob(job.jobId, (event) => {
        if (event.eventType === 'floor-plan.progressed') {
          dispatch({
            type: 'SHELL_PROGRESS',
            progress: Math.round(event.payload.progress * 100),
            message: event.payload.message,
          });
        }
        if (event.eventType === 'floor-plan.rejected') {
          dispatch({ type: 'PLAN_REJECTED', message: event.payload.errorMessage });
        }
      }, { signal: activeOperation.current.signal });
      if ('eventType' in result && result.eventType === 'floor-plan.rejected') return;
      if (!('eventType' in result) && result.kind === 'floor-plan' && result.job.status === 'failed') {
        dispatch({ type: 'PLAN_REJECTED', message: result.job.errorMessage ?? '户型图识别失败，请重试。' });
        return;
      }
      await beginShell({ kind: 'uploaded-plan', assetId }, `上传户型 · ${file.name}`);
    } catch (error) {
      if (!isCancelled(error)) dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '户型图识别失败，请重试。') });
    }
  };

  const handleCaptureUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (files.length === 0) return;
    const images = files.every((file) => file.type.startsWith('image/'));
    if ((images && files.length < 20) || (!images && files.length !== 1)) {
      dispatch({
        type: 'PLAN_REJECTED',
        message: images ? 'Aholo 实景重建至少需要 20 张连续拍摄照片。' : '视频或 INSV 每次只能上传 1 个文件。',
      });
      return;
    }
    dispatch({ type: 'VALIDATE_PLAN' });
    try {
      const source = await uploadCapturedSpace(files);
      await beginShell(source, `Aholo 实景采集 · ${files.length} 个素材`);
    } catch (error) {
      dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '实景采集上传失败，请重试。') });
    }
  };

  const lockShell = async (sessionId: string, signal: AbortSignal) => {
    const session = await getHousingSession(sessionId);
    signal.throwIfAborted();
    const locked = session.shellLocked ? session : await lockHousingShell(session);
    signal.throwIfAborted();
    if (!locked.spatialAnchors) throw new Error('空间锁定未返回入口与碰撞锚点。');
    dispatch({ type: 'SHELL_LOCKED', spatialAnchors: locked.spatialAnchors });
    return locked;
  };

  const enterImmersive = async () => {
    if (!state.sessionId || !state.manifest) return;
    if (state.shellLocked) {
      dispatch({ type: 'ENTER_IMMERSIVE' });
      return;
    }
    if (preparing) return;
    const { signal } = activeOperation.current;
    setPreparing(true);
    try {
      await lockShell(state.sessionId, signal);
      dispatch({ type: 'ENTER_IMMERSIVE' });
    } catch (error) {
      if (!signal.aborted) dispatch({
        type: 'REFERENCE_FAILED',
        message: userMessage(error, '空间锁定失败，请检查边界和入口锚点。'),
      });
    } finally {
      if (!signal.aborted) setPreparing(false);
    }
  };

  const editFurniture = async (change?: {
    entityId: string;
    transform: SceneManifest['entities'][number]['transform'];
  }) => {
    if (editingFurniture.current || !state.sessionId || !state.manifest) return;
    const manifest = state.manifest;
    const { signal } = activeOperation.current;
    editingFurniture.current = true;
    setFurnitureEdit((current) => ({ ...current, busy: true, message: '' }));
    try {
      if (publicExhibit && state.spatialAnchors) {
        let next: SceneManifest | undefined;
        if (change) {
          next = {
            ...manifest,
            revision: manifest.revision + 1,
            entities: manifest.entities.map(entity =>
              entity.id === change.entityId ? { ...entity, transform: change.transform } : entity),
          };
          validateSceneMutation(manifest, next, {
            commandId: crypto.randomUUID(), baseRevision: manifest.revision,
            explanation: '调整家具', requiresConfirmation: false, metadata: {},
            commands: [{ type: 'SET_TRANSFORM', ...change }],
          }, state.spatialAnchors);
          localUndo.current.push(manifest);
        } else {
          next = localUndo.current.pop();
        }
        if (next) dispatch({ type: 'SCENE_UPDATED', manifest: next });
        setFurnitureEdit({
          busy: false, message: change ? '家具已调整' : '已撤销上一步', undoDepth: localUndo.current.length,
        });
        return;
      }
      if (!state.shellLocked) {
        await lockShell(state.sessionId, signal);
        await getSceneWithRetry(manifest.sceneId, { requireAnchors: true, signal });
      }
      const result = change
        ? await applySceneCommands(manifest.sceneId, {
            commandId: crypto.randomUUID(), baseRevision: manifest.revision,
            explanation: '调整家具', requiresConfirmation: false, metadata: {},
            commands: [{ type: 'SET_TRANSFORM', ...change }],
          })
        : await undoSceneCommand(manifest.sceneId, manifest.revision);
      signal.throwIfAborted();
      dispatch({ type: 'SCENE_UPDATED', manifest: result.manifest });
      setFurnitureEdit((current) => ({
        busy: false, message: change ? '家具位置已保存' : '已撤销上一步',
        undoDepth: Math.max(0, current.undoDepth + (change ? 1 : -1)),
      }));
    } catch (error) {
      if (!signal.aborted) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'revision_conflict') {
          const latest = await getScene(manifest.sceneId).catch(() => null);
          if (latest && !signal.aborted) dispatch({ type: 'SCENE_UPDATED', manifest: latest.manifest });
        }
        if (!signal.aborted) setFurnitureEdit((current) => ({
          ...current, busy: false, message: userMessage(error, '无法调整家具，请重试。'),
        }));
      }
    } finally {
      if (!signal.aborted) editingFurniture.current = false;
    }
  };

  const analyzeReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !state.sessionId) return;
    const { signal } = activeOperation.current;
    dispatch({ type: 'REFERENCE_PROGRESS', progress: 8, message: '正在上传普通装修参考图…', name: file.name });
    try {
      const assetId = await uploadDecorationReferenceImage(file);
      signal.throwIfAborted();
      const analysis = await runDecorationAnalysis(assetId, state.brief);
      signal.throwIfAborted();
      dispatch({ type: 'REFERENCE_READY', assetId, analysis });
    } catch (error) {
      if (!signal.aborted && !isCancelled(error)) dispatch({ type: 'REFERENCE_FAILED', message: userMessage(error, '装修参考图分析失败，请重试。') });
    }
  };

  const startDecoration = async (mode: 'furniture' | 'cloud') => {
    const hasStyleInput = Boolean(state.referenceAssetId) || state.brief.trim().length >= 3;
    const fromOriginal = mode === 'cloud' && isPerspectiveRender(state.manifest);
    if ((!hasStyleInput && !fromOriginal) || !state.sessionId || preparing || state.referenceBusy) return;
    const canSubmitCloud = cloudEnhancement.status === 'idle' || Boolean(fromOriginal && cloudEnhancement.retryJobId);
    if (mode === 'cloud' ? !canSubmitCloud : !canSubmitFurniture(furniture)) return;
    const { signal } = activeOperation.current;
    setPreparing(true);
    try {
      if (fromOriginal) {
        const session = await lockShell(state.sessionId, signal);
        void startCloudEnhancement(session, null, signal, cloudEnhancement.retryJobId);
        return;
      }
      let analysis = state.decorationAnalysis;
      if (!analysis || analysis.sourceBrief.trim() !== state.brief.trim()) {
        dispatch({
          type: 'REFERENCE_PROGRESS',
          progress: 12,
          message: state.referenceAssetId
            ? '正在结合参考图重新分析当前装修需求…'
            : '正在分析当前装修需求…',
        });
        analysis = await runDecorationAnalysis(state.referenceAssetId ?? undefined, state.brief);
        signal.throwIfAborted();
        dispatch({ type: 'REFERENCE_READY', assetId: state.referenceAssetId, analysis });
      }
      if (analysis.sourceKind === 'image' && analysis.style.realism !== 'photorealistic') return;
      const interactiveSession = await lockShell(state.sessionId, signal);
      if (mode === 'cloud') {
        void startCloudEnhancement(interactiveSession, analysis, signal);
      } else {
        const candidate = selectFocusCandidate(analysis);
        if (candidate) void startFocusAsset(candidate, interactiveSession, { analysisId: analysis.analysisId });
        else dispatch({ type: 'REFERENCE_FAILED', message: '当前需求没有可独立建模的家具，请补充一个具体物件。' });
      }
    } catch (error) {
      if (signal.aborted || isCancelled(error)) return;
      dispatch({
        type: 'REFERENCE_FAILED',
        message: userMessage(error, '装修需求分析失败，请重试。'),
      });
    } finally {
      if (!signal.aborted) setPreparing(false);
    }
  };

  const trackCloudJob = useCallback(async (sceneId: string, job: GenerationJob, signal: AbortSignal) => {
    if (signal.aborted || trackedCloudJob.current === job.jobId) return;
    trackedCloudJob.current = job.jobId;
    let quotaBlocked = job.status === 'failed' && canRetrySourceVisual(job);
    try {
      setCloudEnhancement({
        status: 'running', progress: Math.round(job.progress * 100),
        message: '已提交写实生成，可以继续查看布局预览',
        providerEvidence: job.providerEvidence ?? null,
      });
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.errorMessage ?? 'Aholo 写实生成未完成');
      }
      let worldId = job.providerEvidence?.externalTaskId;
      if (job.status !== 'complete') {
        const result = await followJob(job.jobId, (event) => {
          if (event.eventType !== 'generation.progressed') return;
          worldId = event.payload.providerEvidence?.externalTaskId ?? worldId;
          setCloudEnhancement((current) => ({
            ...current,
            status: 'running',
            progress: Math.round(event.payload.progress * 100),
            message: event.payload.message ?? decorationProgressMessage(event.payload.status),
            providerEvidence: event.payload.providerEvidence ?? current.providerEvidence,
          }));
        }, { timeoutMs: null, signal });
        if ('eventType' in result) {
          if (result.eventType === 'generation.failed') {
            quotaBlocked = canRetrySourceVisual(result.payload);
            throw new Error(result.payload.errorMessage);
          }
        } else {
          if (result.kind !== 'generation' || result.job.status !== 'complete') {
            quotaBlocked = result.kind === 'generation' && canRetrySourceVisual(result.job);
            throw new Error(result.kind === 'generation' && result.job.errorMessage || 'Aholo 写实生成未完成');
          }
          worldId = result.job.providerEvidence?.externalTaskId ?? worldId;
        }
      }
      const scene = await waitForProjectedVisualScene(sceneId, signal, worldId);
      signal.throwIfAborted();
      dispatch({ type: 'SCENE_UPDATED', manifest: scene.manifest });
      setCloudEnhancement((current) => ({
        ...current, status: 'complete', progress: 100,
        message: 'Aholo 写实资源已就绪',
      }));
    } catch (error) {
      if (signal.aborted || isCancelled(error)) return;
      setCloudEnhancement((current) => ({
        ...current, status: 'failed',
        retryJobId: quotaBlocked ? job.jobId : undefined,
        message: quotaBlocked
          ? 'Aholo 生成额度不足。补充额度后可从原图重试。'
          : userMessage(error, 'Aholo 写实生成失败'),
      }));
    }
  }, []);

  const startCloudEnhancement = async (
    session: HousingSession, analysis: DecorationAnalysis | null, signal: AbortSignal, retryJobId?: string,
  ) => {
    setCloudEnhancement({ status: 'submitting', progress: 0, message: '正在提交写实生成…', providerEvidence: null });
    try {
      if (!session.sceneId) throw new Error('当前会话缺少场景。');
      const job = analysis
        ? await createDecoration(session.sessionId, analysis.sourceBrief, analysis.sourceAssetId ?? null)
        : await createSourceVisual(session.sessionId, retryJobId);
      if (job.jobId === retryJobId) trackedCloudJob.current = null;
      await trackCloudJob(session.sceneId, job, signal);
    } catch (error) {
      if (signal.aborted) return;
      setCloudEnhancement((current) => ({
        ...current, status: 'failed', retryJobId, message: userMessage(error, '无法提交写实生成'),
      }));
    }
  };

  const perspectiveSceneId = isPerspectiveRender(state.manifest) ? state.manifest?.sceneId : undefined;
  useEffect(() => {
    if (!state.sessionId || !perspectiveSceneId) return;
    const { signal } = activeOperation.current;
    void getSourceVisual(state.sessionId).then(({ job }) => {
      if (job) return trackCloudJob(perspectiveSceneId, job, signal);
    }).catch(() => undefined);
  }, [state.sessionId, perspectiveSceneId, trackCloudJob]);

  const startFocusAsset = async (
    candidate: DecorationObjectCandidate,
    session: HousingSession,
    input: { analysisId: string } | { retryJobId: string },
  ) => {
    if (!session.sceneId || !session.spatialAnchors) return;
    const { signal } = activeOperation.current;
    setFurniture({
      status: 'generating', label: candidate.label, candidate, progress: 0,
      jobId: 'retryJobId' in input ? input.retryJobId : null,
      externalTaskId: null, message: `正在生成独立 ${candidate.label}…`, retryable: false,
    });
    try {
      const job = 'retryJobId' in input
        ? await retryAssetGeneration(input.retryJobId)
        : await createFocusAssetGeneration(session.sessionId, input.analysisId, candidate.objectId);
      signal.throwIfAborted();
      setFurniture((current) => ({ ...current, jobId: job.jobId }));
      await followJob(job.jobId, (event) => {
        if (event.eventType !== 'asset-generation.progressed') return;
        setFurniture((current) => ({
          ...current,
          status: 'generating',
          progress: Math.round(event.payload.progress * 100),
          externalTaskId: event.payload.externalTaskId ?? current.externalTaskId,
          message: event.payload.message,
        }));
      }, { timeoutMs: 20 * 60 * 1_000, signal });
      const completedJob = await getAssetGenerationJob(job.jobId);
      signal.throwIfAborted();
      if (completedJob.status !== 'complete' || !completedJob.transform) {
        throw Object.assign(new Error(completedJob.errorMessage ?? 'Lux3D 单体家具生成失败'), {
          retryable: completedJob.retryable === true,
        });
      }
      setFurniture((current) => ({
        ...current, status: 'assembling', progress: 96,
        externalTaskId: completedJob.externalTaskId ?? current.externalTaskId,
        message: '正在校验碰撞、门窗净空与主要动线…',
      }));
      const manifest = await assembleFocusAsset(session, candidate, completedJob);
      signal.throwIfAborted();
      dispatch({ type: 'SCENE_UPDATED', manifest });
      setFurniture((current) => ({
        ...current, status: 'complete', progress: 100, retryable: false,
        message: `${candidate.label} 已作为独立 Lux3D Mesh 装配，可在场景中选择`,
      }));
    } catch (error) {
      if (signal.aborted || isCancelled(error)) return;
      setFurniture((current) => ({
        ...current, status: 'failed',
        message: userMessage(error, `${candidate.label} 生成或装配失败`),
        retryable: typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as { retryable?: unknown }).retryable === true : true,
      }));
    }
  };

  const retryFocusAsset = async () => {
    if (!furniture.candidate || !state.sessionId || !furniture.jobId) return;
    const { signal } = activeOperation.current;
    try {
      const session = await getHousingSession(state.sessionId);
      signal.throwIfAborted();
      await startFocusAsset(furniture.candidate, session, { retryJobId: furniture.jobId });
    } catch (error) {
      if (!signal.aborted) setFurniture((current) => ({
        ...current, message: userMessage(error, '无法重试家具生成'),
      }));
    }
  };

  const runDecorationAnalysis = async (assetId: string | undefined, brief: string) => {
    if (!state.sessionId) throw new Error('住宅会话不存在，请重新选择户型。');
    const job = await createDecorationAnalysis(state.sessionId, assetId, brief);
    const result = await followJob(job.jobId, (platformEvent) => {
      if (platformEvent.eventType === 'decoration-analysis.progressed') {
        dispatch({
          type: 'REFERENCE_PROGRESS',
          progress: Math.round(platformEvent.payload.progress * 100),
          message: platformEvent.payload.message,
        });
      }
    }, { signal: activeOperation.current.signal });
    const analysis = 'eventType' in result
      ? result.eventType === 'decoration-analysis.completed' ? result.payload.analysis : null
      : result.kind === 'decoration-analysis' ? result.job.analysis ?? null : null;
    if (analysis) return analysis;
    const message = 'eventType' in result && result.eventType === 'decoration-analysis.failed'
      ? result.payload.errorMessage : '装修分析未返回有效结果。';
    throw new Error(message);
  };

  const reset = () => {
    activeOperation.current.abort();
    activeOperation.current = new AbortController();
    trackedCloudJob.current = null;
    setSessionUrl(null);
    dispatch({ type: 'RESET' });
    setFurniture(initialFurnitureState);
    setCloudEnhancement(initialCloudEnhancementState);
    setLayoutOnly(false);
    setPreparing(false);
    editingFurniture.current = false;
    localUndo.current = [];
    setFurnitureEdit({ busy: false, message: '', undoDepth: 0 });
    setCleanupReady(true);
  };

  if (qaAssetUrl) return <Lux3dAssetQa url={qaAssetUrl} />;

  if (state.stage === 'layout-selection' || state.stage === 'validating-plan') {
    return (
      <LayoutSelection
        state={state}
        cleanupReady={cleanupReady}
        onChoose={beginShell}
        onUpload={handlePlanUpload}
        onCaptureUpload={handleCaptureUpload}
      />
    );
  }

  const hasVisualLayer = state.manifest?.assets.some((asset) => asset.kind === 'splat');
  const viewingVisual = Boolean(hasVisualLayer && !layoutOnly);
  const furnished = state.manifest?.entities.some((entity) => entity.interactive && entity.kind.startsWith('furniture:'));
  const decorated = hasVisualLayer || furnished;
  const plan = state.manifest?.metadata.floorPlan as {
    scaleEstimated?: boolean;
    diagnostics?: { planType?: string };
    entrance?: { kind?: string };
  } | undefined;

  return (
    <main className={`workspace stage-${state.immersive ? 'immersive' : state.stage}`}>
      <section className="scene-panel" aria-label="3D 房屋预览">
        <RoomScene
          immersive={state.immersive}
          manifest={state.manifest}
          spatialAnchors={state.spatialAnchors}
          layoutOnly={layoutOnly}
          furnitureEdit={{ ...furnitureEdit, undoable: furnitureEdit.undoDepth > 0 }}
          onTransformFurniture={(entityId, transform) => void editFurniture({ entityId, transform })}
          onUndoFurniture={() => void editFurniture()}
        />

        {!state.immersive && (
          <>
            <div className="scene-status glass-surface" role="status">
              <span className={`status-dot ${decorated ? 'ready' : ''}`} />
              <span>{viewingVisual ? '写实空间' : furnished ? '布局与家具预览' : '毛坯预览'}</span>
              <small>{state.layoutName}{plan?.diagnostics?.planType === 'perspective_render'
                ? ' · 布局估算' : plan?.scaleEstimated ? ' · 尺寸估算' : ''}</small>
            </div>
            <button className="ghost-button change-layout" type="button" onClick={reset}>
              <ArrowLeftIcon /> 更换户型
            </button>
          </>
        )}

        {state.stage === 'shell-generating' && (
          <div className="scene-generation-overlay glass-surface">
            <SparklesIcon />
            <div>
              <strong>{state.statusText}</strong>
              <div className="progress-track" aria-label={`生成进度 ${state.progress}%`}>
                <span style={{ width: `${state.progress}%` }} />
              </div>
            </div>
            <b>{state.progress}%</b>
          </div>
        )}

        {state.immersive && (
          <ImmersiveOverlay
            stairLanding={plan?.entrance?.kind === 'stair-landing'}
            onExit={() => dispatch({ type: 'EXIT_IMMERSIVE' })}
          />
        )}
      </section>

      {!state.immersive && (
        <AssistantPanel
          state={state}
          onBriefChange={(brief) => dispatch({ type: 'SET_BRIEF', brief })}
          onGenerate={() => void startDecoration('furniture')}
          onGenerateCloud={() => void startDecoration('cloud')}
          onAttachmentChange={(name) => dispatch({ type: 'SET_ATTACHMENT', name })}
          onReferenceChange={analyzeReference}
          onEnterImmersive={() => void enterImmersive()}
          preparing={preparing}
          furniture={furniture}
          cloudEnhancement={cloudEnhancement}
          fromOriginal={Boolean(perspectiveSceneId)}
          viewingVisual={viewingVisual}
          onToggleVisual={hasVisualLayer && plan ? () => setLayoutOnly(!layoutOnly) : undefined}
          onRetryFurniture={() => void retryFocusAsset()}
        />
      )}
    </main>
  );
}

function selectFocusCandidate(analysis: DecorationAnalysis): DecorationObjectCandidate | null {
  const priority = { critical: 0, supporting: 1, background: 2 } as const;
  return [...analysis.objectCandidates]
    .filter((candidate) => candidate.requiresLux3d)
    .sort((left, right) => priority[left.importance] - priority[right.importance]
      || right.confidence - left.confidence)[0] ?? null;
}

async function assembleFocusAsset(
  session: HousingSession,
  candidate: DecorationObjectCandidate,
  job: AssetGenerationJob,
) {
  if (!session.sceneId || !session.spatialAnchors || !job.transform || !job.normalizedGlbAssetId) {
    throw new Error('Lux3D 装配缺少场景、空间锚点或规范化资产证据');
  }
  const localBounds = job.transform.normalizedBoundsMeters;
  const width = localBounds.max[0] - localBounds.min[0];
  const depth = localBounds.max[2] - localBounds.min[2];
  const walkable = session.spatialAnchors.walkableBounds;
  const margin = 0.35;
  const placements: Array<[number, number, number]> = [
    [walkable.min[0] + width / 2 + margin, walkable.min[1], walkable.min[2] + depth / 2 + margin],
    [walkable.max[0] - width / 2 - margin, walkable.min[1], walkable.min[2] + depth / 2 + margin],
    [walkable.min[0] + width / 2 + margin, walkable.min[1], walkable.max[2] - depth / 2 - margin],
    [walkable.max[0] - width / 2 - margin, walkable.min[1], walkable.max[2] - depth / 2 - margin],
  ];
  const assetId = job.normalizedGlbAssetId;
  const entityId = `lux3d-${candidate.objectId}-${job.jobId.slice(0, 8)}`;
  let lastError: unknown = new Error('锁定空间内没有通过质量门的家具放置位置');
  for (const position of placements) {
    try {
      // Aholo may finish while Lux3D is being assembled. Read the latest revision for
      // each placement attempt so a visual-layer merge cannot make this command stale.
      const scene = await getSceneWithRetry(session.sceneId);
      const result = await applySceneCommands(session.sceneId, {
        commandId: crypto.randomUUID(),
        baseRevision: scene.manifest.revision,
        explanation: `装配 Lux3D ${candidate.label}`,
        requiresConfirmation: false,
        metadata: { provider: 'lux3d', externalTaskId: job.externalTaskId },
        commands: [
          {
            type: 'ADD_ASSET',
            asset: {
              id: assetId,
              kind: 'mesh',
              uri: `/v1/asset-generation-jobs/${job.jobId}/artifacts/normalized/content`,
              format: 'glb',
              metadata: {
                role: 'lux3d-interactive-object', jobId: job.jobId,
                externalTaskId: job.externalTaskId, normalization: job.transform,
              },
            },
          },
          {
            type: 'ADD_ENTITY',
            entity: {
              id: entityId, label: candidate.label, kind: `furniture:${candidate.category}`,
              parentId: null,
              transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              assetRefs: [assetId],
              components: {
                collider: { type: 'aabb', bounds: localBounds },
                assetNormalization: job.transform,
                provenance: { provider: 'lux3d', jobId: job.jobId, externalTaskId: job.externalTaskId },
              },
              tags: ['furniture', 'lux3d', 'selectable'], interactive: true,
            },
          },
        ],
      });
      return result.manifest;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function getSceneWithRetry(sceneId: string, options: { requireAnchors?: boolean; signal?: AbortSignal } = {}) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      const latest = await getScene(sceneId);
      if (!options.requireAnchors || latest.anchors) return latest;
    } catch { /* Scene Service 仍在投影场景。 */ }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error('Scene Service 尚未完成空间投影，请稍后重试家具装配');
}

function isPerspectiveRender(manifest: SceneManifest | null) {
  const plan = manifest?.metadata.floorPlan as { diagnostics?: { planType?: unknown } } | undefined;
  return plan?.diagnostics?.planType === 'perspective_render';
}

function describeLayout(source: HousingLayoutSource): string {
  if (source.kind === 'uploaded-plan') return '上传户型';
  if (source.kind === 'captured-space') return '实景采集';
  return source.preset === 'studio' ? '大开间 / Studio' : '标准一居室 / 1B1B';
}

function setSessionUrl(sessionId: string | null) {
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set('session', sessionId);
  else url.searchParams.delete('session');
  window.history.replaceState(null, '', url);
}

async function waitForProjectedVisualScene(sceneId: string, signal: AbortSignal, worldId?: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    signal.throwIfAborted();
    try {
      const latest = await getScene(sceneId);
      if (latest.manifest.assets.some((asset) =>
        asset.kind === 'splat' && (!worldId || asset.metadata.worldId === worldId)
      )) return latest;
    } catch { /* Aholo 完成事件仍在等待 Scene Service 投影。 */ }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error('Aholo 已完成，但 Scene Service 尚未投影写实视觉层');
}

function LayoutSelection({
  state,
  cleanupReady,
  onChoose,
  onUpload,
  onCaptureUpload,
}: {
  state: ExperienceState;
  cleanupReady: boolean;
  onChoose: (source: HousingLayoutSource, name: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onCaptureUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <main className="selection-page">
      <div className="selection-backdrop" aria-hidden="true">
        <div className="selection-plan-lines" />
      </div>
      <div className="selection-vignette" />
      <section className="selection-card glass-surface" aria-labelledby="selection-title">
        <header className="selection-heading">
          <div className="brand-mark"><HomeIcon /></div>
          <p className="eyebrow">AI HOME STUDIO</p>
          <h1 id="selection-title">从一个户型，预见未来的家</h1>
          <p>选择示例户型快速开始，或上传自己的户型图生成毛坯空间。</p>
        </header>

        <div className="layout-grid">
          <button
            className="layout-option"
            type="button"
            onClick={() => onChoose({ kind: 'preset', preset: 'studio' }, '大开间 / Studio')}
            disabled={state.stage === 'validating-plan' || !cleanupReady}
          >
            <FloorPlanMini variant="studio" />
            <span className="layout-copy">
              <strong>大开间 <em>Studio</em></strong>
              <small>48㎡ · 开放式空间 · 光线充足</small>
            </span>
            <ArrowUpRightIcon />
          </button>
          <button
            className="layout-option"
            type="button"
            onClick={() => onChoose({ kind: 'preset', preset: 'one-bedroom' }, '标准一居室 / 1B1B')}
            disabled={state.stage === 'validating-plan' || !cleanupReady}
          >
            <FloorPlanMini variant="one-bedroom" />
            <span className="layout-copy">
              <strong>标准一居室 <em>1B1B</em></strong>
              <small>30㎡ · 独立卧室 · 紧凑实用</small>
            </span>
            <ArrowUpRightIcon />
          </button>
        </div>

        <div className="selection-divider"><span>或者</span></div>
        <label className={`upload-plan ${state.stage === 'validating-plan' ? 'is-loading' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload} disabled={!cleanupReady || publicExhibit} />
          <span className="upload-icon"><UploadIcon /></span>
          <span>
            <strong>{state.stage === 'validating-plan' ? (state.statusText || '正在识别户型结构…') : '上传户型图或 3D 效果图'}</strong>
            <small>{state.stage === 'validating-plan' ? `识别进度 ${state.progress}%` : '一张平面户型图或斜俯视剖顶图 · 最大 10 MB'}</small>
          </span>
          {state.stage === 'validating-plan' ? <span className="spinner" /> : <ArrowUpRightIcon />}
        </label>
        <label className={`upload-plan capture-upload ${state.stage === 'validating-plan' ? 'is-loading' : ''}`}>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.insv"
            onChange={onCaptureUpload}
            disabled={!cleanupReady || publicExhibit}
          />
          <span className="upload-icon"><WalkIcon /></span>
          <span>
            <strong>专业实景采集（Aholo，可选）</strong>
            <small>高级入口：≥20 张连续照片，或 1 个 MP4/MOV/INSV</small>
          </span>
          <ArrowUpRightIcon />
        </label>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <p className="selection-note">
          {publicExhibit
            ? '公开展示支持示例户型。上传和云端生成需连接生成服务。'
            : cleanupReady
            ? '上传内容会先进行户型结构校验，无关图片不会进入生成流程。'
            : '正在恢复场景，请稍候…'}
        </p>
        {publicExhibit && (
          <nav className="exhibit-links" aria-label="栖居展示">
            <a href="tour.html">体验写实看房</a>
            <a href="qiju.mp4">观看宣传片</a>
          </nav>
        )}
      </section>
    </main>
  );
}

function AssistantPanel({
  state,
  onBriefChange,
  onGenerate,
  onGenerateCloud,
  onAttachmentChange,
  onReferenceChange,
  onEnterImmersive,
  preparing,
  furniture,
  cloudEnhancement,
  fromOriginal,
  viewingVisual,
  onToggleVisual,
  onRetryFurniture,
}: {
  state: ExperienceState;
  onBriefChange: (brief: string) => void;
  onGenerate: () => void;
  onGenerateCloud: () => void;
  onAttachmentChange: (name: string | null) => void;
  onReferenceChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onEnterImmersive: () => void;
  preparing: boolean;
  furniture: FurnitureGenerationState;
  cloudEnhancement: CloudEnhancementState;
  fromOriginal: boolean;
  viewingVisual: boolean;
  onToggleVisual?: () => void;
  onRetryFurniture: () => void;
}) {
  const canGenerate = state.stage === 'shell-ready' && state.sessionId !== null;
  const hasStyleInput = Boolean(state.referenceAssetId) || state.brief.trim().length >= 3;
  const isBusy = state.referenceBusy || preparing;
  const stageLabel = state.stage === 'shell-generating' ? '构建毛坯空间' : '看房与装修预览';

  return (
    <aside className="assistant-panel" aria-label="AI 设计师助手">
      <header className="assistant-header">
        <span className="assistant-mark"><SparklesIcon /></span>
        <div>
          <strong>AI 设计师助手</strong>
          <small>{stageLabel}</small>
        </div>
        {!publicExhibit && <span className="online-dot" title="服务在线" />}
      </header>

      <div className="assistant-body">
        {state.stage === 'shell-generating' ? (
          <PanelProgress state={state} />
        ) : (
          <>
            <section className="assistant-intro">
              <span className="ai-avatar"><SparklesIcon /></span>
              <p>
                {cloudEnhancement.status === 'complete'
                  ? '写实资源已就绪，可以进入空间查看。'
                  : fromOriginal
                    ? '当前是估算布局。写实生成会使用你上传的原图，保留可见的户型、家具和材质作为参考。'
                    : publicExhibit
                      ? '示例户型已就绪。你可以漫游或调整现有家具。'
                      : '户型已就绪。可直接看房，也可以添加家具。'}
              </p>
            </section>

            {fromOriginal && cloudEnhancement.status === 'idle' && (
              <button className="immersive-button" type="button" onClick={onGenerateCloud}
                disabled={!canGenerate || isBusy}>
                <SparklesIcon />
                <span><strong>按原图生成写实空间</strong><small>提交原图到 Aholo，生成室内漫游</small></span>
                <ArrowUpRightIcon />
              </button>
            )}
            {fromOriginal && cloudEnhancement.status !== 'idle' && (
              <CloudEnhancementCard state={cloudEnhancement} />
            )}
            {fromOriginal && cloudEnhancement.retryJobId && (
              <button className="tool-button" type="button" onClick={onGenerateCloud} disabled={isBusy}>
                额度恢复后重试
              </button>
            )}
            {onToggleVisual && (
              <button type="button" className="tool-button" onClick={onToggleVisual}>
                {viewingVisual ? '返回布局编辑' : '查看写实空间'}
              </button>
            )}

            {canGenerate && (
              <button
                className="immersive-button"
                type="button"
                onClick={onEnterImmersive}
                disabled={!state.shellLocked && preparing}
              >
                <WalkIcon />
                <span><strong>{fromOriginal && !viewingVisual ? '漫游布局预览' : '开始看房'}</strong>
                  <small>{viewingVisual ? '在写实场景中漫游' : '在可编辑布局中漫游'}</small></span>
                <ArrowUpRightIcon />
              </button>
            )}

            {publicExhibit && (
              <a className="tool-button" href="tour.html">体验写实看房 <ArrowUpRightIcon /></a>
            )}

            {!publicExhibit && <>
            <div className="tool-row">
              <label className={`tool-button ${isBusy || state.stage !== 'shell-ready' ? 'disabled' : ''}`}>
                <ImageIcon /> 单张装修参考图
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onReferenceChange}
                  disabled={isBusy || state.stage !== 'shell-ready'}
                />
              </label>
            </div>

            {state.attachmentName && (
              <div className="attachment-chip">
                <ImageIcon />
                <span>{state.attachmentName}</span>
                <button type="button" onClick={() => onAttachmentChange(null)} aria-label="移除参考素材">×</button>
              </div>
            )}

            {state.decorationAnalysis
              && state.decorationAnalysis.sourceBrief.trim() !== state.brief.trim()
              && state.brief.trim().length >= 3 && (
                <p className="analysis-hint">生成时会使用更新后的装修需求。</p>
              )}

            <section className="prompt-composer">
              <label htmlFor="design-brief">装修需求（可选）</label>
              <textarea
                id="design-brief"
                value={state.brief}
                onChange={(event) => onBriefChange(event.currentTarget.value)}
                rows={5}
                maxLength={2_000}
                disabled={isBusy}
                placeholder={defaultBrief}
              />
              <div className="composer-footer">
                <span>{state.brief.length} / 2000</span>
                <button
                  className="send-button"
                  type="button"
                  onClick={onGenerate}
                  disabled={!canGenerate || isBusy || !hasStyleInput || !canSubmitFurniture(furniture)}
                  aria-label="生成一件关键家具"
                  title="生成一件关键家具"
                >
                  生成家具
                </button>
              </div>
            </section>

            {state.error && <p className="form-error" role="alert">{state.error}</p>}

            {furniture.status !== 'idle' && (
              <section className={`furniture-generation ${furniture.status}`} role="status">
                <div>
                  <strong>Lux3D · {furniture.label}</strong>
                  <small>{furniture.message}</small>
                  {furniture.externalTaskId && <em>taskId: {furniture.externalTaskId}</em>}
                </div>
                {furniture.status === 'failed' && furniture.retryable && furniture.jobId ? (
                  <button type="button" onClick={onRetryFurniture}>重试</button>
                ) : <b>{furniture.progress}%</b>}
              </section>
            )}

            {!fromOriginal && (cloudEnhancement.status === 'idle' ? (
              <button
                className="tool-button"
                type="button"
                onClick={onGenerateCloud}
                disabled={!canGenerate || isBusy || !hasStyleInput}
              >
                <SparklesIcon /> 生成 Aholo 写实 3DGS（可选）
              </button>
            ) : (
              <CloudEnhancementCard state={cloudEnhancement} />
            ))}

            {state.referenceBusy && <PanelProgress state={state} compact />}
            </>}
          </>
        )}
      </div>
    </aside>
  );
}

function canSubmitFurniture(furniture: FurnitureGenerationState): boolean {
  return furniture.status === 'idle' || (furniture.status === 'failed' && !furniture.jobId && furniture.retryable);
}

function PanelProgress({ state, compact = false }: { state: ExperienceState; compact?: boolean }) {
  return (
    <section className={`panel-progress ${compact ? 'compact' : ''}`} role="status">
      <span className="progress-spark"><SparklesIcon /></span>
      <div>
        <small>{compact ? '内部风格提取' : '空间生成'}</small>
        <strong>{state.statusText}</strong>
        <div className="progress-track"><span style={{ width: `${state.progress}%` }} /></div>
      </div>
      <b>{state.progress}%</b>
    </section>
  );
}

function CloudEnhancementCard({ state }: { state: CloudEnhancementState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [state.status]);
  const evidence = state.providerEvidence;
  const worldStatus = evidence?.diagnostics.worldStatus;
  const providerStatus = typeof worldStatus === 'string' ? worldStatus : evidence?.status;
  const lastChangedAt = evidence?.diagnostics.providerLastChangedAt;
  const stalled = state.status === 'running' && providerStatus === 'RUNNING'
    && typeof lastChangedAt === 'string'
    && now - Date.parse(lastChangedAt) >= 45_000;
  const message = stalled
    ? 'Aholo 云端仍在运行，官方暂无进度增量；当前方案不受影响'
    : state.message;
  return (
    <section className={`panel-progress compact cloud-enhancement ${state.status}`} role="status">
      <span className="progress-spark"><SparklesIcon /></span>
      <div>
        <small>可选写实增强 · 后台任务</small>
        <strong>{message}</strong>
        {evidence?.externalTaskId && (
          <em className="provider-evidence">
            worldId: {evidence.externalTaskId}{providerStatus ? ` · ${providerStatus}` : ''}
          </em>
        )}
        {evidence?.externalTaskId && (
          <span className="provider-updated-at">
            最近一次官方更新时间：{formatProviderTime(evidence.diagnostics.providerUpdatedAt)}
          </span>
        )}
        <div className="progress-track"><span style={{ width: `${state.progress}%` }} /></div>
      </div>
      <b>{state.progress}%</b>
    </section>
  );
}

function formatProviderTime(value: unknown): string {
  const timestamp = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return '官方未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(timestamp);
}

function ImmersiveOverlay({ onExit, stairLanding }: { onExit: () => void; stairLanding: boolean }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onExit]);

  return (
    <div className="immersive-hud">
      <div className="immersive-title glass-surface">
        <span className="status-dot ready" />
        <div><strong>沉浸看房</strong><small>{stairLanding ? '从楼梯平台开始' : '从户型入口开始'}</small></div>
      </div>
      <div className="crosshair" aria-hidden="true"><span /><span /></div>
      <div className="movement-help glass-surface">
        <div className="key-grid"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>
        <span>移动</span>
        <i />
        <MouseIcon />
        <span>按住拖动环视</span>
      </div>
      <button className="exit-immersive glass-surface" type="button" onClick={onExit}>
        <ArrowLeftIcon /> 退出沉浸
      </button>
    </div>
  );
}

function FloorPlanMini({ variant }: { variant: 'studio' | 'one-bedroom' }) {
  return (
    <span className={`floor-plan-mini ${variant}`} aria-hidden="true">
      <i className="wall top" /><i className="wall left" /><i className="wall right" /><i className="wall bottom" />
      <i className="window" />
      {variant === 'one-bedroom' && <><i className="divider-one" /><i className="divider-two" /></>}
      <i className="door" />
      <i className="furniture sofa" /><i className="furniture table" /><i className="furniture bed" />
    </span>
  );
}

function shellProgressMessage(status: string): string {
  if (status === 'accepted') return '毛坯任务已进入队列…';
  if (status === 'normalizing') return '正在校验场景清单与坐标系…';
  return '正在生成墙体、门窗与地面…';
}

function decorationProgressMessage(status: string): string {
  if (status === 'accepted') return '装修任务已进入队列…';
  if (status === 'normalizing') return '正在归一化家具与材质…';
  return '正在规划家具动线与软装材质…';
}

function userMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: unknown }).code === 'job_cancelled';
}

function Icon({ children, viewBox = '0 0 24 24' }: { children: ReactNode; viewBox?: string }) {
  return <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function HomeIcon() { return <Icon><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></Icon>; }
function UploadIcon() { return <Icon><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v5h14v-5" /></Icon>; }
function ArrowUpRightIcon() { return <Icon><path d="M7 17 17 7M8 7h9v9" /></Icon>; }
function ArrowLeftIcon() { return <Icon><path d="m15 18-6-6 6-6" /></Icon>; }
function SparklesIcon() { return <Icon><path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Z" /><path d="m18.5 13 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" /></Icon>; }
function ImageIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 4.5-4 3.5 3 2.5-2 5.5 5" /></Icon>; }
function WalkIcon() { return <Icon><circle cx="12" cy="4" r="2" /><path d="m9 22 1-7-3-2 2-6 5 1 2 4 3 1M10 15l4 2 2 5" /></Icon>; }
function MouseIcon() { return <Icon><rect x="7" y="2" width="10" height="20" rx="5" /><path d="M12 2v7M7 10h10" /></Icon>; }
