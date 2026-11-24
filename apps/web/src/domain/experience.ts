import type {
  HousingLayoutSource,
  HousingSession,
  SceneManifest,
  DecorationAnalysis,
  SpatialAnchorSet,
} from '@spatial-intelligence/contracts';

export interface ExperienceState {
  stage: 'layout-selection' | 'validating-plan' | 'shell-generating' | 'shell-ready';
  immersive: boolean;
  layoutSource: HousingLayoutSource | null;
  layoutName: string;
  brief: string;
  progress: number;
  statusText: string;
  error: string | null;
  attachmentName: string | null;
  sessionId: string | null;
  shellJobId: string | null;
  manifest: SceneManifest | null;
  shellLocked: boolean;
  referenceAssetId: string | null;
  decorationAnalysis: DecorationAnalysis | null;
  spatialAnchors: SpatialAnchorSet | null;
  referenceBusy: boolean;
}
export type ExperienceAction =
  | { type: 'VALIDATE_PLAN' }
  | { type: 'SELECT_LAYOUT'; source: HousingLayoutSource; name: string }
  | { type: 'SHELL_SESSION_STARTED'; sessionId: string; jobId: string }
  | { type: 'RESTORE_SESSION'; session: HousingSession; name: string; manifest: SceneManifest }
  | { type: 'SHELL_PROGRESS'; progress: number; message: string }
  | { type: 'SHELL_READY'; manifest?: SceneManifest; spatialAnchors?: SpatialAnchorSet }
  | { type: 'SHELL_LOCKED'; spatialAnchors: SpatialAnchorSet }
  | { type: 'REFERENCE_PROGRESS'; progress: number; message: string; name?: string }
  | { type: 'REFERENCE_READY'; assetId: string | null; analysis: DecorationAnalysis }
  | { type: 'REFERENCE_FAILED'; message: string }
  | { type: 'PLAN_REJECTED'; message: string }
  | { type: 'SET_BRIEF'; brief: string }
  | { type: 'SET_ATTACHMENT'; name: string | null }
  | { type: 'SCENE_UPDATED'; manifest: SceneManifest }
  | { type: 'ENTER_IMMERSIVE' }
  | { type: 'EXIT_IMMERSIVE' }
  | { type: 'RESET' };

export const defaultBrief = '现代奶油风，温馨治愈，需要一张舒适的布艺沙发和绿植点缀。';

export const initialExperienceState: ExperienceState = {
  stage: 'layout-selection',
  immersive: false,
  layoutSource: null,
  layoutName: '',
  brief: defaultBrief,
  progress: 0,
  statusText: '',
  error: null,
  attachmentName: null,
  sessionId: null,
  shellJobId: null,
  manifest: null,
  shellLocked: false,
  referenceAssetId: null,
  decorationAnalysis: null,
  spatialAnchors: null,
  referenceBusy: false,
};

export function experienceReducer(
  state: ExperienceState,
  action: ExperienceAction,
): ExperienceState {
  switch (action.type) {
    case 'VALIDATE_PLAN':
      return {
        ...state,
        stage: 'validating-plan',
        progress: 18,
        statusText: '正在识别墙线、门窗与空间结构…',
        error: null,
      };
    case 'SELECT_LAYOUT':
      return {
        ...state,
        stage: 'shell-generating',
        layoutSource: action.source,
        layoutName: action.name,
        progress: 12,
        statusText: '正在建立户型边界…',
        error: null,
      };
    case 'SHELL_PROGRESS':
      return { ...state, progress: action.progress, statusText: action.message };
    case 'SHELL_SESSION_STARTED':
      return { ...state, sessionId: action.sessionId, shellJobId: action.jobId };
    case 'RESTORE_SESSION':
      return {
        ...state,
        stage: 'shell-ready',
        layoutName: action.name,
        layoutSource: action.session.source,
        sessionId: action.session.sessionId,
        shellJobId: action.session.shellJobId,
        shellLocked: action.session.shellLocked,
        spatialAnchors: action.session.spatialAnchors ?? null,
        manifest: action.manifest,
        progress: 100,
        error: null,
      };
    case 'SHELL_READY':
      return {
        ...state,
        stage: 'shell-ready',
        progress: 100,
        statusText: '毛坯空间已就绪',
        manifest: action.manifest ?? state.manifest,
        spatialAnchors: action.spatialAnchors ?? state.spatialAnchors,
      };
    case 'SHELL_LOCKED':
      return {
        ...state,
        shellLocked: true,
        spatialAnchors: action.spatialAnchors,
        statusText: '毛坯空间已锁定',
        error: null,
      };
    case 'REFERENCE_PROGRESS':
      return {
        ...state,
        referenceBusy: true,
        progress: action.progress,
        statusText: action.message,
        attachmentName: action.name ?? state.attachmentName,
        decorationAnalysis: null,
        referenceAssetId: null,
        error: null,
      };
    case 'REFERENCE_READY':
      return {
        ...state,
        referenceBusy: false,
        progress: 100,
        statusText: action.analysis.sourceKind === 'image'
          ? '参考图风格已提取'
          : '文字需求已整理',
        referenceAssetId: action.assetId,
        decorationAnalysis: action.analysis,
        error: action.analysis.sourceKind !== 'image' || action.analysis.style.realism === 'photorealistic'
          ? null : '参考图未通过照片级写实质量门，请更换真实照片或可信写实渲染图。',
      };
    case 'REFERENCE_FAILED':
      return {
        ...state,
        referenceBusy: false,
        progress: 0,
        statusText: '',
        error: action.message,
      };
    case 'PLAN_REJECTED':
      return {
        ...state,
        stage: 'layout-selection',
        progress: 0,
        statusText: '',
        error: action.message,
      };
    case 'SET_BRIEF':
      return { ...state, brief: action.brief };
    case 'SET_ATTACHMENT':
      return action.name === null
        ? {
            ...state,
            attachmentName: null,
            referenceAssetId: null,
            decorationAnalysis: state.decorationAnalysis?.sourceKind === 'image'
              ? null : state.decorationAnalysis,
          }
        : { ...state, attachmentName: action.name };
    case 'SCENE_UPDATED':
      return state.manifest && action.manifest.revision < state.manifest.revision
        ? state
        : { ...state, manifest: action.manifest };
    case 'ENTER_IMMERSIVE':
      return { ...state, immersive: true };
    case 'EXIT_IMMERSIVE':
      return { ...state, immersive: false };
    case 'RESET':
      return initialExperienceState;
    default:
      return state;
  }
}
