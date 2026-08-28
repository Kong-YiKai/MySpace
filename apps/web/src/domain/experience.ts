import type {
  EditableRoomObject,
  HousingExperienceStage,
  HousingLayoutSource,
  WallpaperPreset,
  SceneManifest,
} from '@spatial-intelligence/contracts';

export type ObjectColors = Record<EditableRoomObject, string>;

export interface ExperienceState {
  stage: HousingExperienceStage;
  layoutSource: HousingLayoutSource | null;
  layoutName: string;
  brief: string;
  wallpaper: WallpaperPreset;
  selectedObject: EditableRoomObject | null;
  objectColors: ObjectColors;
  progress: number;
  statusText: string;
  error: string | null;
  attachmentName: string | null;
  sessionId: string | null;
  shellJobId: string | null;
  manifest: SceneManifest | null;
}

export type ExperienceAction =
  | { type: 'VALIDATE_PLAN' }
  | { type: 'SELECT_LAYOUT'; source: HousingLayoutSource; name: string }
  | { type: 'SHELL_SESSION_STARTED'; sessionId: string; jobId: string }
  | { type: 'SHELL_PROGRESS'; progress: number; message: string }
  | { type: 'SHELL_READY'; manifest?: SceneManifest }
  | { type: 'PLAN_REJECTED'; message: string }
  | { type: 'SET_BRIEF'; brief: string }
  | { type: 'SET_WALLPAPER'; wallpaper: WallpaperPreset }
  | { type: 'SET_ATTACHMENT'; name: string | null }
  | { type: 'START_DECORATION' }
  | { type: 'DECOR_PROGRESS'; progress: number; message: string }
  | { type: 'DECOR_READY' }
  | { type: 'DECOR_FAILED'; message: string }
  | { type: 'SELECT_OBJECT'; objectId: EditableRoomObject | null }
  | { type: 'SET_OBJECT_COLOR'; objectId: EditableRoomObject; color: string }
  | { type: 'ENTER_IMMERSIVE' }
  | { type: 'EXIT_IMMERSIVE' }
  | { type: 'RESET' };

export const defaultBrief = '现代奶油风，温馨治愈，需要一张舒适的布艺沙发和绿植点缀。';

export const initialExperienceState: ExperienceState = {
  stage: 'layout-selection',
  layoutSource: null,
  layoutName: '',
  brief: defaultBrief,
  wallpaper: 'cream-white',
  selectedObject: null,
  objectColors: {
    sofa: '#d8cbb9',
    'coffee-table': '#9b8f87',
    rug: '#e6d9c6',
    vase: '#e9a597',
    plant: '#78917d',
    'floor-lamp': '#d7c2a1',
  },
  progress: 0,
  statusText: '',
  error: null,
  attachmentName: null,
  sessionId: null,
  shellJobId: null,
  manifest: null,
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
    case 'SHELL_READY':
      return {
        ...state,
        stage: 'shell-ready',
        progress: 100,
        statusText: '毛坯空间已就绪',
        manifest: action.manifest ?? state.manifest,
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
    case 'SET_WALLPAPER':
      return { ...state, wallpaper: action.wallpaper };
    case 'SET_ATTACHMENT':
      return { ...state, attachmentName: action.name };
    case 'START_DECORATION':
      return {
        ...state,
        stage: 'brief-analyzing',
        selectedObject: null,
        progress: 8,
        statusText: 'AI 正在理解采光、动线与风格要求…',
        error: null,
      };
    case 'DECOR_PROGRESS':
      return {
        ...state,
        stage: action.progress >= 32 ? 'decor-generating' : state.stage,
        progress: action.progress,
        statusText: action.message,
      };
    case 'DECOR_READY':
      return {
        ...state,
        stage: 'decorated',
        progress: 100,
        statusText: '装修方案已生成，可以点选物体继续修改',
      };
    case 'DECOR_FAILED':
      return {
        ...state,
        stage: 'shell-ready',
        progress: 0,
        statusText: '',
        error: action.message,
      };
    case 'SELECT_OBJECT':
      return { ...state, selectedObject: action.objectId };
    case 'SET_OBJECT_COLOR':
      return {
        ...state,
        objectColors: { ...state.objectColors, [action.objectId]: action.color },
      };
    case 'ENTER_IMMERSIVE':
      return { ...state, stage: 'immersive', selectedObject: null };
    case 'EXIT_IMMERSIVE':
      return { ...state, stage: 'decorated' };
    case 'RESET':
      return initialExperienceState;
    default:
      return state;
  }
}

export function isDecorVisible(stage: HousingExperienceStage, progress: number): boolean {
  return stage === 'decorated' || stage === 'immersive' || (
    stage === 'decor-generating' && progress >= 55
  );
}
