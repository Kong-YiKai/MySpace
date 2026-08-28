import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import type {
  EditableRoomObject,
  HousingLayoutSource,
  WallpaperPreset,
} from '@spatial-intelligence/contracts';
import { RoomScene } from './components/RoomScene';
import {
  defaultBrief,
  experienceReducer,
  initialExperienceState,
  isDecorVisible,
  type ExperienceState,
} from './domain/experience';
import { validateFloorPlanFile } from './domain/floorPlanValidator';
import {
  createDecoration,
  createHousingSession,
  followJob,
  getHousingSession,
  uploadFloorPlan,
  validateFloorPlan,
} from './api';

const objectLabels: Record<EditableRoomObject, string> = {
  sofa: '布艺沙发',
  'coffee-table': '圆形茶几',
  rug: '客厅地毯',
  vase: '桌面花瓶',
  plant: '绿植',
  'floor-lamp': '落地灯',
};

const wallpaperOptions: Array<{ value: WallpaperPreset; label: string; color: string }> = [
  { value: 'cream-white', label: '奶油白', color: '#f1eee6' },
  { value: 'oat-beige', label: '燕麦米', color: '#dfd3bf' },
  { value: 'sage-mist', label: '鼠尾草雾', color: '#d7ded3' },
];

const objectPalette = ['#d8cbb9', '#c5b8a8', '#b7c2b1', '#d4a99b', '#eee3cd'];

export function App() {
  const [state, dispatch] = useReducer(experienceReducer, initialExperienceState);

  const beginShell = async (source: HousingLayoutSource, name: string) => {
    dispatch({ type: 'SELECT_LAYOUT', source, name });
    try {
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
      });
      const completed = await getHousingSession(session.sessionId);
      if (completed.status !== 'shell-ready' || !completed.manifest) {
        throw new Error(completed.errorMessage ?? '毛坯空间生成失败，请重试。');
      }
      dispatch({ type: 'SHELL_READY', manifest: completed.manifest });
    } catch (error) {
      dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '毛坯空间生成失败，请重试。') });
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
      });
      if ('eventType' in result && result.eventType === 'floor-plan.rejected') return;
      if (!('eventType' in result) && result.kind === 'floor-plan' && result.job.status === 'failed') {
        dispatch({ type: 'PLAN_REJECTED', message: result.job.errorMessage ?? '户型图识别失败，请重试。' });
        return;
      }
      await beginShell({ kind: 'uploaded-plan', assetId }, `上传户型 · ${file.name}`);
    } catch (error) {
      dispatch({ type: 'PLAN_REJECTED', message: userMessage(error, '户型图识别失败，请重试。') });
    }
  };

  const startDecoration = async () => {
    if (state.brief.trim().length < 3 || !state.sessionId) return;
    dispatch({ type: 'START_DECORATION' });
    try {
      const job = await createDecoration(state.sessionId, state.brief, state.wallpaper);
      const result = await followJob(job.jobId, (event) => {
        if (event.eventType === 'generation.progressed') {
          dispatch({
            type: 'DECOR_PROGRESS',
            progress: Math.round(event.payload.progress * 100),
            message: event.payload.message ?? decorationProgressMessage(event.payload.status),
          });
        }
      });
      if ('eventType' in result && result.eventType === 'generation.failed') {
        throw new Error(result.payload.errorMessage);
      }
      dispatch({ type: 'DECOR_READY' });
    } catch (error) {
      dispatch({ type: 'DECOR_FAILED', message: userMessage(error, '装修任务失败，请重试。') });
    }
  };

  const reset = () => {
    dispatch({ type: 'RESET' });
  };

  if (state.stage === 'layout-selection' || state.stage === 'validating-plan') {
    return (
      <LayoutSelection
        state={state}
        onChoose={beginShell}
        onUpload={handlePlanUpload}
      />
    );
  }

  const oneBedroom = state.layoutSource?.kind === 'preset'
    && state.layoutSource.preset === 'one-bedroom';
  const decorated = isDecorVisible(state.stage, state.progress);

  return (
    <main className={`workspace stage-${state.stage}`}>
      <section className="scene-panel" aria-label="3D 房屋预览">
        <RoomScene
          decorated={decorated}
          immersive={state.stage === 'immersive'}
          oneBedroom={oneBedroom}
          manifest={state.manifest}
          wallpaper={state.wallpaper}
          objectColors={state.objectColors}
          selectedObject={state.selectedObject}
          onSelect={(objectId) => dispatch({ type: 'SELECT_OBJECT', objectId })}
        />

        {state.stage !== 'immersive' && (
          <>
            <div className="scene-status glass-surface" role="status">
              <span className={`status-dot ${decorated ? 'ready' : ''}`} />
              <span>{decorated ? '精装方案' : '毛坯预览'}</span>
              <small>{state.layoutName}</small>
            </div>
            <button className="ghost-button change-layout" type="button" onClick={reset}>
              <ArrowLeftIcon /> 更换户型
            </button>
          </>
        )}

        {(state.stage === 'shell-generating'
          || state.stage === 'brief-analyzing'
          || state.stage === 'decor-generating') && (
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

        {state.stage === 'immersive' && (
          <ImmersiveOverlay onExit={() => dispatch({ type: 'EXIT_IMMERSIVE' })} />
        )}
      </section>

      {state.stage !== 'immersive' && (
        <AssistantPanel
          state={state}
          onBriefChange={(brief) => dispatch({ type: 'SET_BRIEF', brief })}
          onGenerate={startDecoration}
          onWallpaperChange={(wallpaper) => dispatch({ type: 'SET_WALLPAPER', wallpaper })}
          onAttachmentChange={(name) => dispatch({ type: 'SET_ATTACHMENT', name })}
          onColorChange={(objectId, color) => dispatch({ type: 'SET_OBJECT_COLOR', objectId, color })}
          onEnterImmersive={() => dispatch({ type: 'ENTER_IMMERSIVE' })}
        />
      )}
    </main>
  );
}

function LayoutSelection({
  state,
  onChoose,
  onUpload,
}: {
  state: ExperienceState;
  onChoose: (source: HousingLayoutSource, name: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <main className="selection-page">
      <div className="selection-backdrop" aria-hidden="true">
        <RoomScene
          decorated
          immersive={false}
          oneBedroom={false}
          wallpaper="cream-white"
          objectColors={initialExperienceState.objectColors}
          selectedObject={null}
          onSelect={() => undefined}
          preview
        />
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
            disabled={state.stage === 'validating-plan'}
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
            disabled={state.stage === 'validating-plan'}
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
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload} />
          <span className="upload-icon"><UploadIcon /></span>
          <span>
            <strong>{state.stage === 'validating-plan' ? (state.statusText || '正在识别户型结构…') : '上传我的户型图'}</strong>
            <small>{state.stage === 'validating-plan' ? `真实任务进度 ${state.progress}%` : '支持 PNG、JPG、WebP · 最大 10 MB'}</small>
          </span>
          {state.stage === 'validating-plan' ? <span className="spinner" /> : <ArrowUpRightIcon />}
        </label>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <p className="selection-note">上传内容会先进行户型结构校验，无关图片不会进入生成流程。</p>
      </section>
    </main>
  );
}

function AssistantPanel({
  state,
  onBriefChange,
  onGenerate,
  onWallpaperChange,
  onAttachmentChange,
  onColorChange,
  onEnterImmersive,
}: {
  state: ExperienceState;
  onBriefChange: (brief: string) => void;
  onGenerate: () => void;
  onWallpaperChange: (wallpaper: WallpaperPreset) => void;
  onAttachmentChange: (name: string | null) => void;
  onColorChange: (objectId: EditableRoomObject, color: string) => void;
  onEnterImmersive: () => void;
}) {
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const canGenerate = state.stage === 'shell-ready' || state.stage === 'decorated';
  const isBusy = state.stage === 'shell-generating'
    || state.stage === 'brief-analyzing'
    || state.stage === 'decor-generating';
  const selectedLabel = state.selectedObject ? objectLabels[state.selectedObject] : null;

  const stageLabel = useMemo(() => {
    if (state.stage === 'shell-generating') return '构建毛坯空间';
    if (state.stage === 'shell-ready') return '描述理想的家';
    if (state.stage === 'brief-analyzing') return '分析装修需求';
    if (state.stage === 'decor-generating') return '生成装修方案';
    return '继续调整方案';
  }, [state.stage]);

  const handleReference = (event: ChangeEvent<HTMLInputElement>) => {
    const name = event.currentTarget.files?.[0]?.name ?? null;
    onAttachmentChange(name);
    event.currentTarget.value = '';
  };

  return (
    <aside className="assistant-panel" aria-label="AI 设计师助手">
      <header className="assistant-header">
        <span className="assistant-mark"><SparklesIcon /></span>
        <div>
          <strong>AI 设计师助手</strong>
          <small>{stageLabel}</small>
        </div>
        <span className="online-dot" title="服务在线" />
      </header>

      <div className="assistant-body">
        {state.stage === 'shell-generating' ? (
          <PanelProgress state={state} />
        ) : (
          <>
            <section className="assistant-intro">
              <span className="ai-avatar"><SparklesIcon /></span>
              <p>
                {state.stage === 'decorated'
                  ? '方案已生成。点击场景中的家具可修改材质，也可以调整需求后重新生成。'
                  : '毛坯空间已准备好。先选墙纸，再告诉我你想要的生活氛围。'}
              </p>
            </section>

            <div className="tool-row">
              <button
                className={`tool-button ${wallpaperOpen ? 'active' : ''}`}
                type="button"
                onClick={() => setWallpaperOpen((open) => !open)}
                disabled={isBusy}
              >
                <WallpaperIcon /> 墙纸
              </button>
              <label className={`tool-button ${isBusy ? 'disabled' : ''}`}>
                <ImageIcon /> 参考图 / 视频
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                  onChange={handleReference}
                  disabled={isBusy}
                />
              </label>
            </div>

            {wallpaperOpen && (
              <div className="wallpaper-popover">
                <span>毛坯墙面基调</span>
                <div>
                  {wallpaperOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={state.wallpaper === option.value ? 'selected' : ''}
                      onClick={() => onWallpaperChange(option.value)}
                    >
                      <i style={{ background: option.color }} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.attachmentName && (
              <div className="attachment-chip">
                <ImageIcon />
                <span>{state.attachmentName}</span>
                <button type="button" onClick={() => onAttachmentChange(null)} aria-label="移除参考素材">×</button>
              </div>
            )}

            {state.selectedObject && selectedLabel && (
              <section className="property-card">
                <div className="property-heading">
                  <span><ObjectIcon /></span>
                  <div>
                    <small>已选中物体</small>
                    <strong>{selectedLabel}</strong>
                  </div>
                  <b>可编辑</b>
                </div>
                <label>明媚温和 · 低饱和度配色</label>
                <div className="color-swatches">
                  {objectPalette.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`更换为 ${color}`}
                      className={state.objectColors[state.selectedObject!] === color ? 'selected' : ''}
                      style={{ background: color }}
                      onClick={() => onColorChange(state.selectedObject!, color)}
                    />
                  ))}
                </div>
                <p>颜色会直接更新当前场景，不会重新生成整套方案。</p>
              </section>
            )}

            <section className="prompt-composer">
              <label htmlFor="design-brief">装修需求</label>
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
                  disabled={!canGenerate || state.brief.trim().length < 3}
                  aria-label={state.stage === 'decorated' ? '重新生成装修方案' : '生成装修方案'}
                >
                  {isBusy ? <span className="spinner light" /> : <SendIcon />}
                </button>
              </div>
            </section>

            {state.error && <p className="form-error" role="alert">{state.error}</p>}

            {(state.stage === 'brief-analyzing' || state.stage === 'decor-generating') && (
              <PanelProgress state={state} compact />
            )}

            {state.stage === 'decorated' && (
              <button className="immersive-button" type="button" onClick={onEnterImmersive}>
                <WalkIcon />
                <span><strong>沉浸看房</strong><small>从入户门开始第一人称漫游</small></span>
                <ArrowUpRightIcon />
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function PanelProgress({ state, compact = false }: { state: ExperienceState; compact?: boolean }) {
  return (
    <section className={`panel-progress ${compact ? 'compact' : ''}`} role="status">
      <span className="progress-spark"><SparklesIcon /></span>
      <div>
        <small>{state.stage === 'shell-generating' ? '空间生成' : 'AI 装修生成'}</small>
        <strong>{state.statusText}</strong>
        <div className="progress-track"><span style={{ width: `${state.progress}%` }} /></div>
      </div>
      <b>{state.progress}%</b>
    </section>
  );
}

function ImmersiveOverlay({ onExit }: { onExit: () => void }) {
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
        <div><strong>沉浸看房</strong><small>你已站在户型入口</small></div>
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

function Icon({ children, viewBox = '0 0 24 24' }: { children: ReactNode; viewBox?: string }) {
  return <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function HomeIcon() { return <Icon><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></Icon>; }
function UploadIcon() { return <Icon><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v5h14v-5" /></Icon>; }
function ArrowUpRightIcon() { return <Icon><path d="M7 17 17 7M8 7h9v9" /></Icon>; }
function ArrowLeftIcon() { return <Icon><path d="m15 18-6-6 6-6" /></Icon>; }
function SparklesIcon() { return <Icon><path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Z" /><path d="m18.5 13 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" /></Icon>; }
function WallpaperIcon() { return <Icon><path d="M4 4h11v16H4z" /><path d="M15 8h3a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-3M8 8h3M8 12h3M8 16h3" /></Icon>; }
function ImageIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 4.5-4 3.5 3 2.5-2 5.5 5" /></Icon>; }
function SendIcon() { return <Icon><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></Icon>; }
function ObjectIcon() { return <Icon><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" /><path d="m4 6.5 8 4.5 8-4.5M12 11v9" /></Icon>; }
function WalkIcon() { return <Icon><circle cx="12" cy="4" r="2" /><path d="m9 22 1-7-3-2 2-6 5 1 2 4 3 1M10 15l4 2 2 5" /></Icon>; }
function MouseIcon() { return <Icon><rect x="7" y="2" width="10" height="20" rx="5" /><path d="M12 2v7M7 10h10" /></Icon>; }
