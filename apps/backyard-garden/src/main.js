import {
  BackgroundMode,
  Box3,
  Color,
  Object3D,
  PerspectiveCamera,
  Ray,
  Raycaster,
  SplatLoader,
  SplatUtils,
  Vector2,
  Vector3,
  createViewerContext,
  createViewer,
  setViewerConfig,
} from '@manycore/aholo-viewer';
import {
  consumeFirstVisit,
  createGameStateClient,
  createSpatialAgentSceneContext,
  GAME_WEAPONS,
  resolveMySpaceAppRoute,
  SpatialRuntime,
} from 'spatial-intelligence-core';
import { clearAnchorDraft, getAnchorJson, loadAnchorDraft, saveAnchorDraft } from './anchor-editor.js';
import { createBackyardManifest, getPlotPlantYaw, getPlots } from './backyard.scene.js';
import {
  GROWTH_STAGE,
  PLANT_SPECIES,
  createClaimCommands,
  createPlantingCommands,
  createUprootCommands,
  getGrowthVisualAssetIds,
  getPendingGrowthCommands,
  getStageDescription,
} from './growth-system.js';
import { loadLux3dGlbForAholo } from './lux3d-asset-loader.js';
import { loadSplatPointPicker } from './splat-point-picker.js';
import { createGardenToolViewer } from './garden-tool-viewer.js';
import { createPlantVisionReferenceCapture } from './plant-vision-reference.js';
import { formatDaveDialogue } from './dave-dialogue.js';
import './styles.css';

const MANIFEST_STORAGE_KEY = 'myspace.backyard-garden.scene-state.v1';
const gameStateClient = createGameStateClient();
const SPATIAL_AGENT_URL = 'http://127.0.0.1:8787/api/spatial-agent/inspect';
const MYSTERY_SEED_ID = 'mysterySeed';
const MYSTERY_VISION_REPORTS_STORAGE_KEY = 'myspace.backyard.mystery-vision-reports.v1';
const MYSTERY_VISION_AUTOMATION_MIN_CONFIDENCE = 0.72;
const LOD_META_URL = '/assets/backyard/lod-v1/lod-meta.json';
const SPLAT_PICKER_SOURCE_URL = '/assets/backyard/backyard-garden-3dgs-v1.ply';
const LOD_LOAD_TIMEOUT_MS = 35_000;
const LOD_BOOT_SPLAT_BUDGET = 20_000;
// 交互时优先响应，停下后再让附近温室细节逐步回到更高精度。
// 36 万仍显著低于原始 57.2 万全量直载，但足以避免静态画面长期发糊。
const LOD_IDLE_SPLAT_BUDGET = 360_000;
const LOD_IDLE_MIN_LEVEL = 0;
const LOD_IDLE_DELAY_MS = 400;
const LOD_TICK_INTERVAL_MS = 96;
// Hover 只需提供即时反馈，不必和点云渲染同频。限制到 12.5Hz 可以避免准星扫过
// Lux GLB 时与 3DGS 的高精度绘制争夺主线程。
const HOVER_PICK_INTERVAL_MS = 80;
// 原来的 Shift 冲刺速度就是正常探索手感；默认直接使用它，避免长距离穿行温室过慢。
const PLAYER_MOVE_SPEED = 3.2625;
// Aholo Viewer 的运行时未导出该枚举，但其渲染管线稳定使用这两个模式值。
const OUTLINE_RENDER_MODE = Object.freeze({ DEFAULT: 0, DISABLED: 1 });
// Lux3D 输出的模型单位并不完全一致，因此每个成长阶段都在这里保留自己的场景标定。
// halfHeight 用于把模型根部贴到 Aholo 点云中的花圃平面（该场景视觉向上为 -Y）。
const GROWTH_VISUAL_ASSETS = Object.freeze({
  'shared-seedling-v1': Object.freeze({
    label: '初生期幼苗',
    uri: '/assets/plants/shared-seedling-v1.glb',
    scale: 8,
    halfHeight: 0.72,
  }),
  'shared-sprout-v1': Object.freeze({
    label: '青年豌豆射手',
    uri: '/assets/plants/shared-sprout-v1.glb',
    scale: 11,
    halfHeight: 0.66,
  }),
  'corn-pult-sprout-v1': Object.freeze({
    label: '青年玉米投手',
    uri: '/assets/plants/corn-pult-sprout-v1.glb',
    scale: 11,
    halfHeight: 0.72,
  }),
  'watermelon-pult-sprout-v1': Object.freeze({
    label: '青年西瓜投手',
    uri: '/assets/plants/watermelon-pult-sprout-v1.glb',
    scale: 11,
    halfHeight: 0.72,
  }),
  'pea-shooter-adult-v1': Object.freeze({
    label: '成年豌豆射手',
    uri: '/assets/plants/pea-shooter-adult-v1.glb',
    scale: 12,
    halfHeight: 1.08,
  }),
  'corn-pult-adult-v1': Object.freeze({
    label: '成年玉米投手',
    uri: '/assets/plants/corn-pult-adult-v1.glb',
    // 与豌豆射手同高、略宽；先共享高度标定，后续可只调整这一项而不影响其他植物。
    scale: 12,
    halfHeight: 1.08,
  }),
  'watermelon-pult-adult-v1': Object.freeze({
    label: '成年西瓜投手',
    uri: '/assets/plants/watermelon-pult-adult-v1.glb',
    // 西瓜主体较宽，先沿用成熟植物的花圃高度标定；只需后续单独微调这两项。
    scale: 12,
    halfHeight: 1.08,
  }),
});
// 每次戴夫进行“看外观”类问答时，都会把这三套项目内 GLB 离屏渲染成固定三机位。
// 这不是训练 Qwen 权重，而是把明确、可复现的视觉样本作为当次多模态请求的参考。
const PLANT_YOUTH_VISION_REFERENCE_ASSETS = Object.freeze([
  Object.freeze({
    id: 'pea-shooter-sprout-v1',
    label: '青年豌豆射手（圆形豌豆头、正前方出弹口、卷曲叶片）',
    uri: '/assets/plants/shared-sprout-v1.glb',
  }),
  Object.freeze({
    id: 'corn-pult-sprout-v1',
    label: '青年玉米投手（黄色玉米穗主体、侧向投掷勺、绿色苞叶）',
    uri: '/assets/plants/corn-pult-sprout-v1.glb',
  }),
  Object.freeze({
    id: 'watermelon-pult-sprout-v1',
    label: '青年西瓜投手（圆润深浅绿条纹瓜体、粗壮藤蔓、无出弹口）',
    uri: '/assets/plants/watermelon-pult-sprout-v1.glb',
  }),
]);
const DAVE_VISUAL_ASSET = Object.freeze({
  id: 'crazy-dave-gardener-v1',
  label: '疯狂戴夫',
  uri: '/assets/characters/crazy-dave-gardener-v1.glb',
  // 戴夫的原始 GLB 已接近 1.8 个场景单位高，而植物 GLB 只有约 0.1 单位。
  // 不能沿用植物的 scale: 12；否则每次锚点同步都会得到二十多米高的戴夫。
  // 适度放大为可清晰交谈的管家尺寸，并同步保持脚底贴合地板。
  scale: 1.15,
  halfHeight: 1.035,
  interactionHeight: 2.35,
  interactionWidth: 1.35,
});
// 工具与 Aholo 3DGS 使用两套独立渲染层：花圃和戴夫仍在空间里，第一人称工具
// 则由透明 Three.js 前景层渲染，因而不会被点云遮住或混合成奇怪的颜色。
const GARDEN_TOOL_ASSETS = Object.freeze({
  glove: Object.freeze({
    label: '白手套',
    uri: '/assets/tools/garden-glove-v1.glb',
    targetSize: 1.68,
    yaw: 0,
  }),
  wateringCan: Object.freeze({
    label: '水壶',
    uri: '/assets/tools/garden-watering-can-v1.glb',
    targetSize: 1.92,
    yaw: 0,
  }),
  shovel: Object.freeze({
    label: '铁铲',
    uri: '/assets/tools/garden-shovel-v1.glb',
    targetSize: 2.12,
    yaw: 0,
  }),
});
const dom = {
  viewerShell: document.querySelector('.viewer-shell'),
  viewer: document.querySelector('#viewer'),
  gardenToolViewer: document.querySelector('#garden-tool-viewer'),
  reticle: document.querySelector('#garden-reticle'),
  interactionFeedback: document.querySelector('#interaction-feedback'),
  visionMonitor: document.querySelector('#dave-vision-monitor'),
  visionMonitorTitle: document.querySelector('#dave-vision-monitor-title'),
  visionMonitorCopy: document.querySelector('#dave-vision-monitor-copy'),
  seedBag: document.querySelector('#seed-bag'),
  seedBagPlot: document.querySelector('#seed-bag-plot'),
  seedBagClose: document.querySelector('#seed-bag-close'),
  toolInspectHint: document.querySelector('#tool-inspect-hint'),
  overlay: document.querySelector('#anchor-overlay'),
  viewerHint: document.querySelector('.viewer-hint'),
  focusGarden: document.querySelector('#focus-garden'),
  panelToggle: document.querySelector('#panel-toggle'),
  mapToggle: document.querySelector('#map-toggle'),
  mapOverlay: document.querySelector('#world-map'),
  mapClose: document.querySelector('#map-close'),
  musicToggle: document.querySelector('#music-toggle'),
  sceneMusic: document.querySelector('#scene-music'),
  mapDestinations: document.querySelector('#map-destinations'),
  backpackToggle: document.querySelector('#backpack-toggle'),
  backpack: document.querySelector('#garden-backpack'),
  backpackClose: document.querySelector('#garden-backpack-close'),
  backpackSummary: document.querySelector('#garden-backpack-summary'),
  backpackContents: document.querySelector('#garden-backpack-contents'),
  loading: document.querySelector('#loading'),
  status: document.querySelector('#viewer-status'),
  statusRow: document.querySelector('.status-row'),
  plotList: document.querySelector('#plot-list'),
  selectedPlotName: document.querySelector('#selected-plot-name'),
  coordinate: ['x', 'y', 'z'].map((axis) => document.querySelector(`#anchor-${axis}`)),
  applyAnchor: document.querySelector('#apply-anchor'),
  copyAnchor: document.querySelector('#copy-anchor'),
  resetAnchors: document.querySelector('#reset-anchors'),
  daveAnchor: ['x', 'y', 'z'].map((axis) => document.querySelector(`#dave-anchor-${axis}`)),
  daveAnchorEditor: document.querySelector('#dave-anchor-editor'),
  applyDaveAnchor: document.querySelector('#apply-dave-anchor'),
  placeDaveAtReticle: document.querySelector('#place-dave-at-reticle'),
  plantPea: document.querySelector('#plant-pea'),
  plantCorn: document.querySelector('#plant-corn'),
  waterPlant: document.querySelector('#water-plant'),
  daveMessage: document.querySelector('#dave-message'),
  daveGuide: document.querySelector('#dave-guide'),
  daveToggle: document.querySelector('#dave-toggle'),
  daveDialog: document.querySelector('#dave-dialog'),
  daveDialogClose: document.querySelector('#dave-dialog-close'),
  daveReply: document.querySelector('#dave-reply'),
  daveTranscript: document.querySelector('#dave-transcript'),
  daveForm: document.querySelector('#dave-form'),
  daveInput: document.querySelector('#dave-input'),
  daveAsk: document.querySelector('#dave-ask'),
  daveQuickPrompts: document.querySelector('#dave-quick-prompts'),
  daveOpenTaskStation: document.querySelector('#dave-open-task-station'),
  daveTaskSummary: document.querySelector('#dave-task-summary'),
  daveTaskPlantPea: document.querySelector('#dave-task-plant-pea'),
  daveTaskPlantCorn: document.querySelector('#dave-task-plant-corn'),
  daveTaskPlantMystery: document.querySelector('#dave-task-plant-mystery'),
  daveTaskWater: document.querySelector('#dave-task-water'),
  daveTaskHarvest: document.querySelector('#dave-task-harvest'),
  daveTaskPlots: document.querySelector('#dave-task-plots'),
  onboarding: document.querySelector('#dave-onboarding'),
  onboardingClose: document.querySelector('#dave-onboarding-close'),
};

function loadManifest() {
  try {
    const saved = JSON.parse(localStorage.getItem(MANIFEST_STORAGE_KEY));
    if (saved?.sceneId === 'backyard-garden-001') {
      const currentTemplate = createBackyardManifest();
      const requiredAssets = currentTemplate.assets;
      const savedAssets = Array.isArray(saved.assets) ? saved.assets : [];
      const savedEntities = Array.isArray(saved.entities) ? saved.entities : [];
      return {
        ...saved,
        assets: [...savedAssets, ...requiredAssets.filter((asset) => !savedAssets.some((existing) => existing.id === asset.id))],
        // 旧本地草稿没有戴夫实体；合并模板中的缺失实体，不覆盖用户已经校准过的坐标。
        entities: [...savedEntities, ...currentTemplate.entities.filter((entity) => !savedEntities.some((existing) => existing.id === entity.id))],
      };
    }
  } catch {
    // 本地草稿损坏时回落到只含锚点的初始场景。
  }
  return createBackyardManifest(loadAnchorDraft());
}

const runtime = new SpatialRuntime({
  manifest: loadManifest(),
  persistence: {
    async saveManifest(manifest) {
      localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(manifest));
      saveAnchorDraft(manifest);
    },
  },
});

let selectedPlotId = 'plot-a';
let gameState = null;
let activeGardenTool = 'glove';
let viewer;
let camera;
let ray;
let interactionRaycaster;
let orbit = { target: new Vector3(-8, -12, 21), radius: 148, azimuth: 0.72, elevation: -0.24 };
let pointerState = null;
let hoveredInteractionRoot = null;
const RETICLE_NDC = new Vector2(0, 0);
const INTERACTION_HIT_POINT = new Vector3();
let viewerReady = false;
let growthTickBusy = false;
let sceneDraftPositions = null;
let sceneDraftDaveAnchor = null;
let roomOrbit = null;
let lodSplat = null;
let splatPointPicker = null;
let splatPointPickerPromise = null;
let cameraRenderFrame = null;
let lodIdleTimer = null;
let lodInteractionActive = false;
let lodMaxLevel = 0;
let movementBounds = null;
const pressedMovementKeys = new Set();
let movementFrame = null;
let movementLastTimestamp = null;
let lastLodTickAt = 0;
const plantPrototypeCache = new Map();
const plantPrototypePromises = new Map();
const plantVisuals = new Map();
const plotInteractionVisuals = new Map();
const modelInteractionRoots = new Map();
// 命中框只存在于逻辑层，不会渲染出来。它来自模型自身的真实网格包围范围，
// 用于 Hover 的快速预筛；点击时仍会优先做精确网格命中。
const modelInteractionBounds = new Map();
let lastHoverPickAt = 0;
let gardenToolViewer = null;
let isInspectingGardenTool = false;
let gardenToolInspectRightDrag = false;
let interactionFeedbackTimer = null;
let daveVisual = null;
let davePrototype = null;
let davePrototypePromise = null;
let plantVisionReferenceCapture = null;
let plantVisionReferencePromise = null;
let mysteryVisionReports = loadMysteryVisionReports();
const mysteryVisionMonitorInFlight = new Set();
let anchorPlacementEntityId = null;
let daveBusy = false;
let isGardenMusicEnabled = true;
let daveReply = formatDaveDialogue('我是花园管家。聊天时我会看看植物长势；想让我播种、浇水或收获，就在任务台给我派活。');
let daveDialogMode = 'chat';
const daveTranscript = [];
// 空间运行时以 revision 做并发保护。成长计时器和玩家/戴夫操作必须共用一条队列，
// 否则两者同时读取同一 revision 时，后提交的动作会被误判为“种不了”。
let runtimeCommandQueue = Promise.resolve();
// 共享背包命令与 3D 场景命令也必须串行。否则玩家点种子袋与戴夫任务台同时提交时，
// 两端可能各自读到同一块“空花圃”，造成看似随机的播种失败。
let gardenActionQueue = Promise.resolve();
const APP_ROUTES = Object.freeze({
  panorama: resolveMySpaceAppRoute('panorama', { override: import.meta.env.VITE_MYSPACE_PANORAMA_URL }),
  battle: resolveMySpaceAppRoute('battle', { override: import.meta.env.VITE_MYSPACE_BATTLE_URL }),
});

const WORLD_DESTINATIONS = Object.freeze([
  {
    id: 'garden',
    eyebrow: '当前地点 · 3DGS',
    title: '戴夫的后花园',
    description: '六块花圃、成长状态和可领取武器。',
    state: 'current',
  },
  {
    id: 'grave-gate',
    eyebrow: '开场地点 · 全景',
    title: '墓碑大门',
    description: '月夜墓园的正式开场全景；点击墓碑门可进入园艺小卡车商店。',
    href: `${APP_ROUTES.panorama}?scene=grave-gate-001`,
    state: 'ready',
  },
  {
    id: 'shop',
    eyebrow: '补给地点 · 全景',
    title: '园艺小卡车商店',
    description: '360° 空场景中叠加可点击的小卡车；可浏览种子与肥料的补给目录。',
    href: `${APP_ROUTES.panorama}?scene=garden-supply-shop-001`,
    state: 'ready',
  },
  {
    id: 'battle',
    eyebrow: '正式关卡 · Three.js',
    title: '潮汐防线',
    description: '第一人称战斗场；种植完成的植物会在此成为武器。',
    href: APP_ROUTES.battle,
    state: 'ready',
  },
]);

function setStatus(message, ready = false) {
  dom.status.textContent = message;
  dom.statusRow.classList.toggle('is-ready', ready);
}

function getSharedInventoryCount(group, key) {
  return gameState?.inventory?.[group]?.[key] ?? 0;
}

function renderBackpack() {
  if (!dom.backpack || !dom.backpackSummary || !dom.backpackContents) return;
  if (!gameState) {
    dom.backpackSummary.textContent = '正在连接本地共享背包…';
    dom.backpackContents.replaceChildren();
    return;
  }
  dom.backpackSummary.textContent = `阳光 ${gameState.sun} · 水壶 ${gameState.garden.waterCharges}/3 · 已装备 ${gameState.loadout.equippedWeaponId ? GAME_WEAPONS[gameState.loadout.equippedWeaponId].label : '未选择'}`;
  const rows = [
    ['种子', '豌豆射手种子', getSharedInventoryCount('seeds', 'peaShooter')],
    ['种子', '玉米投手种子', getSharedInventoryCount('seeds', 'cornPult')],
    ['种子', '神秘种子', getSharedInventoryCount('seeds', MYSTERY_SEED_ID)],
    ['肥料', '速生肥', getSharedInventoryCount('fertilizer', 'quickGrow')],
    ['植物', '豌豆射手', getSharedInventoryCount('plants', 'peaShooter')],
    ['植物', '双发射手', getSharedInventoryCount('plants', 'doublePeaShooter')],
    ['植物', '机枪射手', getSharedInventoryCount('plants', 'gatlingPeaShooter')],
    ['植物', '玉米投手', getSharedInventoryCount('plants', 'cornPult')],
    ['植物', '西瓜投手（稀有）', getSharedInventoryCount('plants', 'watermelonPult')],
  ];
  dom.backpackContents.replaceChildren(...rows.map(([kind, label, quantity]) => {
    const row = document.createElement('div');
    row.className = 'backpack-row';
    row.innerHTML = `<span>${kind}</span><strong>${label}</strong><em>×${quantity}</em>`;
    return row;
  }));
}

function getGardenToolLabel(toolId = activeGardenTool) {
  return { glove: '白手套 · 收获', wateringCan: '水壶 · 浇灌', shovel: '铁铲 · 铲回种子' }[toolId] ?? '未选择工具';
}

function showInteractionFeedback(message, tone = 'neutral') {
  if (!dom.interactionFeedback) return;
  if (interactionFeedbackTimer !== null) window.clearTimeout(interactionFeedbackTimer);
  dom.interactionFeedback.textContent = message;
  dom.interactionFeedback.dataset.tone = tone;
  dom.interactionFeedback.hidden = false;
  interactionFeedbackTimer = window.setTimeout(() => {
    dom.interactionFeedback.hidden = true;
    interactionFeedbackTimer = null;
  }, 3_200);
}

// 一旦打开需要点击、滚动或输入的 UI，就必须先交还浏览器光标。
// 这同时清理旧拖拽状态，防止关闭面板后把上一次的鼠标位移误用于转镜头。
function releaseGardenPointerLock() {
  pointerState = null;
  gardenToolInspectRightDrag = false;
  if (document.pointerLockElement) document.exitPointerLock?.();
}

function setSeedBagOpen(open, { plotId = selectedPlotId } = {}) {
  if (!dom.seedBag) return;
  const plot = getPlot(plotId);
  const plant = plot && getPlantForPlot(runtime.getManifest(), plot);
  if (!open || !plot || plant) {
    dom.seedBag.hidden = true;
    return;
  }
  selectedPlotId = plot.id;
  releaseGardenPointerLock();
  dom.seedBag.hidden = false;
  if (dom.seedBagPlot) dom.seedBagPlot.textContent = plot.label;
  document.querySelectorAll('[data-quick-plant]').forEach((button) => {
    const speciesId = button.dataset.quickPlant;
    const count = getSharedInventoryCount('seeds', speciesId);
    const countNode = button.querySelector('[data-seed-count]');
    if (countNode) countNode.textContent = `×${count}`;
    button.disabled = !gameState || count < 1;
  });
}

function setActiveGardenTool(toolId) {
  const didChange = activeGardenTool !== toolId;
  activeGardenTool = toolId;
  if (didChange) setGardenToolInspection(false);
  document.querySelectorAll('[data-garden-tool]').forEach((button) => {
    const active = button.dataset.gardenTool === toolId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  dom.daveMessage.textContent = `${getGardenToolLabel()}已就绪。点击花圃锚点即可执行对应操作。`;
  showInteractionFeedback(`${getGardenToolLabel()}已就绪`, 'neutral');
  void syncHeldGardenTool().catch((error) => {
    console.error(error);
    dom.daveMessage.textContent = `手持${getGardenToolLabel()}加载失败：${error.message}`;
  });
}

function setBackpackOpen(open) {
  if (!dom.backpack || !dom.backpackToggle) return;
  dom.backpack.hidden = !open;
  dom.backpackToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    releaseGardenPointerLock();
    renderBackpack();
  }
}

function renderDaveTranscript() {
  if (!dom.daveTranscript) return;
  dom.daveTranscript.replaceChildren(...daveTranscript.map((entry) => {
    const line = document.createElement('p');
    line.className = `dave-transcript__line dave-transcript__line--${entry.role}`;
    line.textContent = entry.text;
    return line;
  }));
  dom.daveTranscript.scrollTop = dom.daveTranscript.scrollHeight;
}

function appendDaveTranscript(role, message) {
  const text = message.trim();
  if (!text) return;
  daveTranscript.push({ role, text });
  if (daveTranscript.length > 8) daveTranscript.splice(0, daveTranscript.length - 8);
  renderDaveTranscript();
}

function setDaveReply(message, { record = false } = {}) {
  // 无论文本来自 Qwen、本地任务台还是异常分支，玩家看到的都必须是戴夫的台词，
  // 不能露出模型的分段标签、内部字段或英文成长状态。
  daveReply = formatDaveDialogue(message, { variant: daveTranscript.length });
  if (dom.daveReply) dom.daveReply.textContent = daveReply;
  if (record) appendDaveTranscript('dave', daveReply);
}

function setDaveBusy(busy) {
  daveBusy = busy;
  if (dom.daveAsk) {
    dom.daveAsk.disabled = busy;
    dom.daveAsk.textContent = busy ? '戴夫在观察花园…' : '问问戴夫';
  }
  if (dom.daveInput) dom.daveInput.disabled = busy;
  dom.daveQuickPrompts?.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
}

function setDaveDialogOpen(open, { mode = daveDialogMode } = {}) {
  if (!dom.daveDialog || !dom.daveToggle) return;
  daveDialogMode = mode;
  dom.daveDialog.hidden = !open;
  dom.daveDialog.classList.toggle('is-task-mode', mode === 'tasks');
  dom.daveToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    releaseGardenPointerLock();
    if (dom.daveReply) dom.daveReply.textContent = daveReply;
    renderDaveTranscript();
    window.setTimeout(() => {
      if (mode === 'tasks') dom.daveTaskPlantMystery?.focus();
      else dom.daveInput?.focus();
    }, 0);
  }
}

function captureGardenScreenshot() {
  try {
    const canvas = dom.viewer.querySelector('canvas');
    if (!canvas || canvas.width < 4 || canvas.height < 4) return null;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    // 为青年期多机位参考图保留请求体预算，避免浏览器截图过大导致请求被本地 Agent 拒绝。
    return dataUrl.length <= 5_800_000 ? { dataUrl, detail: 'low' } : null;
  } catch {
    // 部分 WebGL 上下文禁止导出像素；此时仍可按权威空间图回答。
    return null;
  }
}

async function captureYouthPlantVisionReferences() {
  if (plantVisionReferencePromise) return plantVisionReferencePromise;
  plantVisionReferenceCapture ??= createPlantVisionReferenceCapture({
    assets: PLANT_YOUTH_VISION_REFERENCE_ASSETS,
  });
  plantVisionReferencePromise = plantVisionReferenceCapture.capture()
    .catch((error) => {
      // 参考集失败时不能让正常的戴夫问答失效；运行时截图和权威状态仍会照常发送。
      console.warn('青年植株视觉参考图生成失败：', error);
      return [];
    })
    .finally(() => {
      plantVisionReferencePromise = null;
    });
  return plantVisionReferencePromise;
}

function loadMysteryVisionReports() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MYSTERY_VISION_REPORTS_STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, report]) => report && typeof report === 'object' && typeof report.plantId === 'string')
      .slice(-12));
  } catch {
    return {};
  }
}

function saveMysteryVisionReports() {
  try {
    const entries = Object.entries(mysteryVisionReports)
      .sort(([, left], [, right]) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
      .slice(-12);
    mysteryVisionReports = Object.fromEntries(entries);
    window.localStorage.setItem(MYSTERY_VISION_REPORTS_STORAGE_KEY, JSON.stringify(mysteryVisionReports));
  } catch {
    // 无痕模式禁用 localStorage 时，当前页面仍可以完成本轮巡检，只是不跨刷新保留浮窗历史。
  }
}

function saveMysteryVisionReport(report) {
  mysteryVisionReports[report.plantId] = report;
  saveMysteryVisionReports();
  renderMysteryVisionMonitor();
}

function renderMysteryVisionMonitor() {
  if (!dom.visionMonitor || !dom.visionMonitorTitle || !dom.visionMonitorCopy) return;
  const latest = Object.values(mysteryVisionReports)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
  dom.visionMonitor.hidden = !latest;
  if (!latest) return;
  dom.visionMonitor.dataset.tone = latest.status;
  dom.visionMonitorTitle.textContent = latest.title;
  dom.visionMonitorCopy.textContent = latest.copy;
}

function getMysteryYouthVisionAsset(plant) {
  const growth = plant?.components?.growth;
  if (!growth || growth.stage !== GROWTH_STAGE.SPROUT) return null;
  const assetId = getGrowthVisualAssetIds(growth.speciesId, growth.stage)
    .find((id) => GROWTH_VISUAL_ASSETS[id]);
  return assetId ? { id: assetId, ...GROWTH_VISUAL_ASSETS[assetId] } : null;
}

function createRedactedMysteryInspectionScene(plant) {
  const redactedManifest = structuredClone(runtime.getManifest());
  const target = redactedManifest.entities.find((entity) => entity.id === plant.id);
  if (target) {
    // 目标的真实 speciesId 仅保留在本地状态机中；Qwen 收到的空间上下文不会泄露答案。
    target.label = '待识别神秘青年植株';
    target.components.growth = {
      stage: GROWTH_STAGE.SPROUT,
      sourceSeedId: MYSTERY_SEED_ID,
    };
  }
  return createSpatialAgentSceneContext(redactedManifest);
}

async function runMysterySeedVisionInspection(plant) {
  const growth = plant.components.growth;
  if (growth.sourceSeedId !== MYSTERY_SEED_ID || growth.stage !== GROWTH_STAGE.SPROUT) return;
  if (mysteryVisionReports[plant.id] || mysteryVisionMonitorInFlight.has(plant.id)) return;
  const visualAsset = getMysteryYouthVisionAsset(plant);
  if (!visualAsset) return;

  mysteryVisionMonitorInFlight.add(plant.id);
  const plot = getPlots(runtime.getManifest()).find((candidate) => candidate.id === plant.parentId);
  const plotLabel = plot?.label ?? plant.parentId;
  saveMysteryVisionReport({
    plantId: plant.id,
    createdAt: Date.now(),
    status: 'checking',
    title: `${plotLabel} · 戴夫正在辨认神秘幼苗`,
    copy: '正在渲染目标三机位，并与豌豆、玉米、西瓜青年植株的视觉参考集比对…',
  });

  try {
    const referenceImages = await captureYouthPlantVisionReferences();
    const targetImages = await plantVisionReferenceCapture.captureAssetViews({
      id: visualAsset.id,
      label: '待识别神秘青年植株',
      uri: visualAsset.uri,
    }, {
      idPrefix: `mystery-target:${plant.id}`,
      label: '待识别神秘青年植株',
    });
    const response = await fetch(SPATIAL_AGENT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: `mystery-vision-${crypto.randomUUID()}`,
        question: `神秘种子巡检：请仅根据未标名目标的三个机位图，识别实体 ${plant.id} 是豌豆、玉米还是西瓜的青年期形态。若它是西瓜请建议保留，否则建议铲除并让神秘种子返还背包。请返回 visualAssessment。`,
        scene: createRedactedMysteryInspectionScene(plant),
        screenshot: captureGardenScreenshot(),
        referenceImages,
        targetImages,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload.directive?.visualAssessment) {
      throw new Error(payload?.error?.message ?? 'Qwen 没有给出有效的青年植株判定。');
    }
    const assessment = payload.directive.visualAssessment;
    if (assessment.entityId !== plant.id) throw new Error('Qwen 的判定对象与当前神秘幼苗不一致。');
    const label = PLANT_SPECIES[assessment.speciesId]?.label ?? assessment.speciesId;
    const confidence = Math.round(assessment.confidence * 100);
    let status = assessment.recommendation === 'keep' ? 'kept' : 'waiting';
    let actionCopy = assessment.recommendation === 'keep'
      ? '判为稀有西瓜，已保留继续生长。'
      : '判为非西瓜，等待自动处理。';

    // 玩家明确启用了神秘种子自动巡检：高置信度的非西瓜建议会调用既有铁铲状态机，
    // 返还原始神秘种子，而不是由模型直接写背包或删除实体。
    if (assessment.recommendation === 'uproot' && assessment.confidence >= MYSTERY_VISION_AUTOMATION_MIN_CONFIDENCE) {
      const result = await uprootPlant(plant.id, { actor: '戴夫的视觉巡检' });
      status = result.ok ? 'uprooted' : 'waiting';
      actionCopy = result.ok ? '判为非西瓜，已铲除并返还神秘种子。' : `建议铲除，但本地状态机未执行：${result.message}`;
    } else if (assessment.recommendation === 'uproot') {
      actionCopy = `判为非西瓜，但置信度 ${confidence}% 低于自动铲除阈值，将保留等待复查。`;
    }

    saveMysteryVisionReport({
      plantId: plant.id,
      createdAt: Date.now(),
      status,
      title: `${plotLabel} · 戴夫判定：${label}（${confidence}%）`,
      copy: `${assessment.reason} ${actionCopy}`,
      daveLine: formatDaveDialogue(payload.directive.answer),
      assessment,
    });
  } catch (error) {
    saveMysteryVisionReport({
      plantId: plant.id,
      createdAt: Date.now(),
      status: 'error',
      title: `${plotLabel} · 神秘幼苗等待复查`,
      copy: `戴夫本轮视觉巡检未完成：${error.message}。植物未被改动。`,
    });
  } finally {
    mysteryVisionMonitorInFlight.delete(plant.id);
  }
}

function monitorMysterySeedSprouts() {
  if (!viewerReady) return;
  for (const plant of runtime.getManifest().entities) {
    if (plant.kind !== 'garden-plant') continue;
    void runMysterySeedVisionInspection(plant);
  }
}

function getDaveStateSummary() {
  const manifest = runtime.getManifest();
  const plots = getPlots(manifest).map((plot) => {
    const plant = getPlantForPlot(manifest, plot);
    return {
      plotId: plot.id,
      selected: plot.id === selectedPlotId,
      occupant: plant ? {
        speciesId: plant.components.growth.speciesId,
        stage: plant.components.growth.stage,
        readyToClaim: Boolean(plant.components.growth.readyToClaim),
      } : null,
    };
  });
  return {
    selectedPlotId,
    selectedPlot: getPlot(selectedPlotId)?.label ?? null,
    activeTool: getGardenToolLabel(),
    plots,
    vocabulary: {
      peaShooter: '豌豆射手（植物与种子）',
      cornPult: '玉米投手（植物与种子）',
      watermelonPult: '西瓜投手（稀有成熟植物，当前不在商店售卖）',
      cornCannon: '玉米加农炮（一次性战斗道具，绝不是种子）',
    },
    seeds: {
      peaShooter: getSharedInventoryCount('seeds', 'peaShooter'),
      cornPult: getSharedInventoryCount('seeds', 'cornPult'),
      mysterySeed: getSharedInventoryCount('seeds', MYSTERY_SEED_ID),
    },
    waterCharges: gameState?.garden?.waterCharges ?? null,
  };
}

function renderDaveTaskStation() {
  if (!dom.daveTaskSummary) return;
  if (dom.daveTaskPlots) {
    dom.daveTaskPlots.replaceChildren(...getPlots(runtime.getManifest()).map((candidate) => {
      const button = document.createElement('button');
      const selected = candidate.id === selectedPlotId;
      const occupied = Boolean(getPlantForPlot(runtime.getManifest(), candidate));
      button.type = 'button';
      button.className = `dave-task-plots__item${selected ? ' is-selected' : ''}${occupied ? ' is-occupied' : ''}`;
      button.textContent = candidate.label.replace('花圃 ', '');
      button.title = `${candidate.label}${occupied ? '（已种植）' : '（空闲）'}`;
      button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => {
        selectPlot(candidate.id);
        showInteractionFeedback(`戴夫的任务目标已切换到${candidate.label}`, 'neutral');
      });
      return button;
    }));
  }
  const plot = getPlot();
  const plant = plot && getPlantForPlot(runtime.getManifest(), plot);
  const hasPeaSeed = getSharedInventoryCount('seeds', 'peaShooter') > 0;
  const hasCornSeed = getSharedInventoryCount('seeds', 'cornPult') > 0;
  const hasMysterySeed = getSharedInventoryCount('seeds', MYSTERY_SEED_ID) > 0;
  // 戴夫播种不再被“当前查看的花圃”绑死：他按 A→F 寻找下一块真正空闲的地块。
  const nextPlantingPlot = getNextAvailablePlantingPlot();
  const canPlant = Boolean(nextPlantingPlot);
  const canWater = Boolean(plant && !plant.components.growth.readyToClaim && (gameState?.garden?.waterCharges ?? 0) > 0);
  const canHarvest = Boolean(plant?.components.growth.readyToClaim);

  dom.daveTaskPlantPea.disabled = !canPlant || !hasPeaSeed;
  dom.daveTaskPlantCorn.disabled = !canPlant || !hasCornSeed;
  dom.daveTaskPlantMystery.disabled = !canPlant || !hasMysterySeed;
  dom.daveTaskWater.disabled = !canWater;
  dom.daveTaskHarvest.disabled = !canHarvest;

  if (!plot) {
    dom.daveTaskSummary.textContent = '先从右侧花圃列表选择一个任务地点。';
    return;
  }
  if (!plant) {
    dom.daveTaskSummary.textContent = `${plot.label} 空闲。戴夫播种会按 A→F 自动前往${nextPlantingPlot?.label ?? '下一块空花圃'}；豌豆 ${hasPeaSeed ? '可用' : '不足'}、玉米 ${hasCornSeed ? '可用' : '不足'}、神秘种子 ${hasMysterySeed ? '可用' : '不足'}。`;
    return;
  }
  const species = PLANT_SPECIES[plant.components.growth.speciesId];
  dom.daveTaskSummary.textContent = `${plot.label}：${species.label}处于${stageLabel(plant)}。${canHarvest ? '已可派戴夫收获。' : canWater ? '可派戴夫浇水推进成长。' : '等待成长或补充水壶水量。'}${nextPlantingPlot ? ` 播种任务仍会自动前往${nextPlantingPlot.label}。` : ''}`;
}

async function dispatchDaveTask(taskType) {
  const isPlantingTask = taskType === 'plant-pea' || taskType === 'plant-corn' || taskType === 'plant-mystery';
  const plot = isPlantingTask ? getNextAvailablePlantingPlot() : getPlot();
  if (!plot) {
    setDaveReply(isPlantingTask
      ? '歪比巴布！A 到 F 都已经种满了，先收获或用铁铲清出空花圃吧。'
      : '歪比巴布！先在任务台选一块花圃，我才知道要去哪儿干活。');
    return;
  }
  if (isPlantingTask) selectPlot(plot.id);
  let result;
  if (taskType === 'plant-pea') result = await plant('peaShooter', plot.id);
  if (taskType === 'plant-corn') result = await plant('cornPult', plot.id);
  if (taskType === 'plant-mystery') result = await plant(MYSTERY_SEED_ID, plot.id);
  if (taskType === 'water') result = await waterPlantAt(plot.id);
  if (taskType === 'harvest') {
    const plant = getPlantForPlot(runtime.getManifest(), plot);
    result = plant ? await claimPlant(plant.id) : { ok: false, message: '这个花圃目前没有植物可收获。' };
  }
  setDaveReply(result?.ok
    ? `阿喔柔！任务完成：${result.message}`
    : `歪比巴布……任务没能完成：${result?.message ?? '任务类型无效。'}`);
  renderDaveTaskStation();
}

async function askDave(question) {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || daveBusy) return;
  setDaveBusy(true);
  appendDaveTranscript('player', normalizedQuestion);
  setDaveReply('阿喔柔……我先看看花圃、背包和眼前的画面。');
  try {
    await refreshGameState();
    const scene = createSpatialAgentSceneContext(runtime.getManifest());
    const stateSummary = getDaveStateSummary();
    // 首次请求会从项目内青年 GLB 生成三机位参考图；后续请求命中页面缓存。
    const referenceImages = await captureYouthPlantVisionReferences();
    const response = await fetch(SPATIAL_AGENT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: `dave-${crypto.randomUUID()}`,
        question: `${normalizedQuestion}\n\n青年植株视觉参考图会随本次请求发送。它们只用于辨认外观特征；当前花园截图是实时画面。权威花园业务状态摘要（用于解释，不可绕过本地校验）：${JSON.stringify(stateSummary)}`,
        scene,
        screenshot: captureGardenScreenshot(),
        referenceImages,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload.directive) {
      throw new Error(payload?.error?.message ?? '戴夫暂时没有收到模型回复。');
    }
    setDaveReply(payload.directive.answer, { record: true });
  } catch (error) {
    setDaveReply(`歪比巴布……我这次没连上大脑。${error.message}\n\n花圃与背包没有被改动；检查本地 Qwen 兼容地址配置后可以再试。`, { record: true });
  } finally {
    setDaveBusy(false);
  }
}

async function refreshGameState({ announceFailure = false } = {}) {
  try {
    gameState = await gameStateClient.getState();
    const scenePlants = runtime.getManifest().entities
      .filter((entity) => entity.kind === 'garden-plant' && entity.components.growth?.stage !== GROWTH_STAGE.CLAIMED)
      .map((entity) => ({
        id: entity.id,
        plotId: entity.parentId,
        speciesId: entity.components.growth.speciesId,
        plantedAt: entity.components.growth.plantedAt,
        ...(entity.components.growth.sourceSeedId ? { sourceSeedId: entity.components.growth.sourceSeedId } : {}),
      }));
    if (gameState.revision === 0) {
      if (scenePlants.length) {
        gameState = await gameStateClient.command('migrateLegacyGardenPlants', { plants: scenePlants });
        dom.daveMessage.textContent = `已将 ${scenePlants.length} 株既有花园植物迁入共享背包存档；这只会在新存档首次打开时执行。`;
      }
    } else if (scenePlants.length) {
      // 旧版本在共享存档已经有战斗/商店进度时跳过了迁移，造成“模型存在但无法收获”。
      // 新对账只回填共享存档中的空花圃；发生冲突立即中止，绝不覆盖玩家已有进度。
      gameState = await gameStateClient.command('reconcileGardenPlants', { plants: scenePlants });
    }
    // 共享背包是跨“商店 → 花园 → 战斗”保存的权威状态。旧页面只做了反向回填，
    // 导致新打开花园时 B~F 已在存档里、却没有恢复到 3D 锚点；戴夫与玩家于是
    // 分别基于不同的空位集合操作。这里把缺失的共享植物补回场景，且保留同一个 ID。
    await hydrateSharedGardenPlants();
    renderBackpack();
    renderUi();
  } catch (error) {
    if (announceFailure) dom.daveMessage.textContent = `共享背包不可用：${error.message}`;
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function getPlot(plotId = selectedPlotId) {
  return getPlots(runtime.getManifest()).find((plot) => plot.id === plotId) ?? null;
}

function getSharedPlantForPlot(plotId) {
  return gameState?.garden?.plots?.[plotId] ?? null;
}

function isPlotOccupied(manifest, plot) {
  return Boolean(getPlantForPlot(manifest, plot) || getSharedPlantForPlot(plot.id));
}

function getNextAvailablePlantingPlot(manifest = runtime.getManifest()) {
  // getPlots() 的定义顺序就是 A → F；不要依赖当前选中花圃或屏幕点击顺序。
  return getPlots(manifest).find((plot) => !isPlotOccupied(manifest, plot)) ?? null;
}

function getDaveEntity(manifest = runtime.getManifest()) {
  return manifest.entities.find((entity) => entity.id === 'crazy-dave-guide') ?? null;
}

function getPlantForPlot(manifest, plot) {
  const plantId = plot.components.occupancy?.entityId;
  return plantId ? manifest.entities.find((entity) => entity.id === plantId) ?? null : null;
}

async function hydrateSharedGardenPlants() {
  if (!gameState) return;
  const manifest = runtime.getManifest();
  const commands = [];
  for (const plot of getPlots(manifest)) {
    const sharedPlant = getSharedPlantForPlot(plot.id);
    if (!sharedPlant || getPlantForPlot(manifest, plot)) continue;
    commands.push(...createPlantingCommands(manifest, {
      speciesId: sharedPlant.speciesId,
      plotId: plot.id,
      now: sharedPlant.plantedAt,
      plantId: sharedPlant.id,
      sourceSeedId: sharedPlant.sourceSeedId ?? null,
    }));
  }
  if (commands.length) {
    await execute(commands, '将共享花园进度恢复到对应的 3D 花圃锚点');
  }
}

async function loadPlantPrototype(assetId) {
  const definition = GROWTH_VISUAL_ASSETS[assetId];
  if (!definition) throw new Error(`未知的成长模型资源：${assetId}`);
  if (plantPrototypeCache.has(assetId)) return plantPrototypeCache.get(assetId);
  if (plantPrototypePromises.has(assetId)) return plantPrototypePromises.get(assetId);

  const pending = (async () => {
    const scene = await loadLux3dGlbForAholo({ viewer, uri: definition.uri, label: definition.label });
    plantPrototypeCache.set(assetId, scene);
    return scene;
  })();
  plantPrototypePromises.set(assetId, pending);
  try {
    return await pending;
  } catch (error) {
    plantPrototypePromises.delete(assetId);
    throw error;
  }
}

function setGardenToolInspection(value) {
  const toolDefinition = GARDEN_TOOL_ASSETS[activeGardenTool];
  isInspectingGardenTool = Boolean(toolDefinition && gardenToolViewer?.setInspection(value));
  if (!isInspectingGardenTool) gardenToolInspectRightDrag = false;
  dom.viewerShell?.classList.toggle('is-tool-inspecting', isInspectingGardenTool);
  if (dom.toolInspectHint) {
    dom.toolInspectHint.hidden = !isInspectingGardenTool;
    dom.toolInspectHint.textContent = isInspectingGardenTool
      ? `检视 ${toolDefinition.label} · 自动旋转 · 按住右键自由旋转 · V / Esc 退出`
      : '';
  }
}

async function syncHeldGardenTool() {
  if (!dom.gardenToolViewer) return;
  gardenToolViewer ??= createGardenToolViewer({
    container: dom.gardenToolViewer,
    assets: GARDEN_TOOL_ASSETS,
  });
  const requestedToolId = activeGardenTool;
  const definition = GARDEN_TOOL_ASSETS[requestedToolId];
  if (!definition) {
    setGardenToolInspection(false);
    await gardenToolViewer.setTool(null);
    return;
  }
  await gardenToolViewer.setTool(requestedToolId);
}

function getPlantVisualPosition(plot, definition) {
  const [x, y, z] = plot.transform.position;
  // 该 Aholo PLY 的视觉向上是 -Y；把标准 GLB 翻转后，以根部贴住花圃平面。
  return [x, y - definition.halfHeight, z];
}

function createPlotInteractionVisual(plot) {
  // Aholo 的 Scene3D 只能挂接它自身的 Object3D；不能把 npm three 的 Mesh/Group
  // 直接塞进来，否则渲染遍历会因缺少 traverseWithChildrenSkip 而循环报错。
  // 花圃的“可点区域”采用语义包围盒，3DGS 本身仍是花圃的视觉呈现。
  const root = new Object3D();
  root.name = `garden-plot-anchor:${plot.id}`;
  return root;
}

function getPlotInteractionBounds(plot) {
  const [x, y, z] = plot.transform.position;
  // 花圃本身在 3DGS 里没有可拾取网格。此前 ±0.88 的小盒要求玩家精确点到中心，
  // 尤其最左侧 A 花圃很容易漏判；这里按 manifest 里的真实花圃 footprint 建立无形点击区。
  const { width, depth } = plot.components.spatialAnchor.footprint;
  const bounds = new Box3();
  bounds.min.set(x - width / 2, y - 0.8, z - depth / 2);
  bounds.max.set(x + width / 2, y + 0.8, z + depth / 2);
  return bounds;
}

function syncPlotInteractionVisuals() {
  if (!viewerReady || !viewer) return;
  const manifest = runtime.getManifest();
  for (const plot of getPlots(manifest)) {
    const occupied = isPlotOccupied(manifest, plot);
    const existing = plotInteractionVisuals.get(plot.id);
    if (occupied) {
      if (!existing) continue;
      viewer.getScene().remove(existing);
      modelInteractionRoots.delete(existing);
      modelInteractionBounds.delete(existing);
      plotInteractionVisuals.delete(plot.id);
      continue;
    }
    const visual = existing ?? createPlotInteractionVisual(plot);
    const [x, y, z] = plot.transform.position;
    visual.position.set(x, y - 0.055, z);
    if (!existing) {
      plotInteractionVisuals.set(plot.id, visual);
      viewer.getScene().add(visual);
    }
    modelInteractionRoots.set(visual, { type: 'garden-plot', plotId: plot.id });
    modelInteractionBounds.set(visual, getPlotInteractionBounds(plot));
  }
  updateCamera();
}

async function syncPlantVisuals() {
  if (!viewerReady || !viewer) return;
  const manifest = runtime.getManifest();
  const desiredPlants = manifest.entities.flatMap((plant) => {
    const growth = plant.components.growth;
    if (plant.kind !== 'garden-plant' || !growth || growth.stage === GROWTH_STAGE.CLAIMED) return [];
    const assetId = getGrowthVisualAssetIds(growth.speciesId, growth.stage).find((id) => GROWTH_VISUAL_ASSETS[id]);
    // 例如玉米还没提供成年 GLB 时，不让旧幼苗继续冒充成熟模型。
    return assetId ? [{ plant, assetId }] : [];
  });
  const desiredIds = new Set(desiredPlants.map(({ plant }) => plant.id));

  for (const [plantId, visualRecord] of plantVisuals) {
    if (desiredIds.has(plantId)) continue;
    viewer.getScene().remove(visualRecord.object);
    modelInteractionRoots.delete(visualRecord.object);
    modelInteractionBounds.delete(visualRecord.object);
    plantVisuals.delete(plantId);
  }
  if (!desiredPlants.length) {
    updateCamera();
    return;
  }

  const neededAssetIds = [...new Set(desiredPlants.map(({ assetId }) => assetId))];
  await Promise.all(neededAssetIds.map((assetId) => loadPlantPrototype(assetId)));

  for (const { plant, assetId } of desiredPlants) {
    const plot = getPlots(manifest).find((candidate) => candidate.id === plant.parentId);
    if (!plot) continue;
    const definition = GROWTH_VISUAL_ASSETS[assetId];
    const currentVisual = plantVisuals.get(plant.id);
    if (currentVisual?.assetId !== assetId) {
      if (currentVisual) viewer.getScene().remove(currentVisual.object);
      const prototype = plantPrototypeCache.get(assetId);
      const object = prototype.clone(true);
      plantVisuals.set(plant.id, { assetId, object });
    }
    const visual = plantVisuals.get(plant.id).object;
    const [x, y, z] = getPlantVisualPosition(plot, definition);
    visual.name = `garden-plant:${plant.id}`;
    visual.scale.set(definition.scale, definition.scale, definition.scale);
    visual.rotation.set(Math.PI, getPlotPlantYaw(plot), 0);
    visual.position.set(x, y, z);
    modelInteractionRoots.set(visual, { type: 'garden-plant', plantId: plant.id });
    refreshModelInteractionBounds(visual);
    if (!currentVisual || currentVisual.assetId !== assetId) {
      viewer.getScene().add(visual);
    }
  }
  updateCamera();
}

async function loadDavePrototype() {
  if (davePrototype) return davePrototype;
  if (davePrototypePromise) return davePrototypePromise;
  davePrototypePromise = loadLux3dGlbForAholo({
    viewer,
    uri: DAVE_VISUAL_ASSET.uri,
    label: DAVE_VISUAL_ASSET.label,
  }).then((scene) => {
    davePrototype = scene;
    return scene;
  }).finally(() => {
    davePrototypePromise = null;
  });
  return davePrototypePromise;
}

async function syncDaveVisual() {
  if (!viewerReady || !viewer) return;
  const dave = getDaveEntity();
  if (!dave) return;
  const prototype = await loadDavePrototype();
  if (!daveVisual) {
    daveVisual = prototype.clone(true);
    daveVisual.name = 'guide:crazy-dave';
    viewer.getScene().add(daveVisual);
  }
  const [x, y, z] = dave.transform.position;
  daveVisual.scale.set(DAVE_VISUAL_ASSET.scale, DAVE_VISUAL_ASSET.scale, DAVE_VISUAL_ASSET.scale);
  // 3DGS 花园的视觉向上为 -Y，X 轴翻转让 GLB 正确站地；再绕视觉竖轴转半圈朝向玩家。
  daveVisual.rotation.set(Math.PI, Math.PI, 0);
  daveVisual.position.set(x, y - DAVE_VISUAL_ASSET.halfHeight, z);
  modelInteractionRoots.set(daveVisual, { type: 'dave' });
  refreshModelInteractionBounds(daveVisual);
  updateCamera();
}

function stageLabel(plant) {
  if (!plant) return '空闲';
  const stage = plant.components.growth.stage;
  if (stage === GROWTH_STAGE.SEED) return '初生期';
  if (stage === GROWTH_STAGE.SPROUT) return '青春期';
  if (stage === GROWTH_STAGE.MATURE) return '成年期';
  return '已领取';
}

function updateDaveMessage() {
  const manifest = runtime.getManifest();
  const plot = getPlot();
  if (!plot) {
    dom.daveMessage.textContent = '请选择一块花圃后再种植。';
    return;
  }
  const plant = getPlantForPlot(manifest, plot);
  if (!plant) {
    dom.daveMessage.textContent = `${plot.label} 目前空闲。可以种下豌豆或玉米种子；空间 Agent 之后会据此给出位置建议。`;
    return;
  }
  const species = PLANT_SPECIES[plant.components.growth.speciesId];
  dom.daveMessage.textContent = `${plot.label} 的${species.label}：${getStageDescription(plant.components.growth)}。真实状态由种下时间和状态机决定，Luna 只负责说明与建议。`;
}

function renderPlotList() {
  const manifest = runtime.getManifest();
  const cards = getPlots(manifest).map((plot) => {
    const plant = getPlantForPlot(manifest, plot);
    const row = document.createElement('div');
    row.className = 'plot-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `plot-card${plot.id === selectedPlotId ? ' is-selected' : ''}${plant ? ' is-occupied' : ''}`;
    button.innerHTML = `<span class="plot-key">${plot.label.slice(-1)}</span><span><span class="plot-title">${plot.label}</span><span class="plot-meta">${plant ? PLANT_SPECIES[plant.components.growth.speciesId].label : '尚未种植'}</span></span><span class="stage-badge">${stageLabel(plant)}</span>`;
    button.addEventListener('click', () => selectPlot(plot.id));
    row.append(button);

    if (plant?.components.growth.readyToClaim) {
      const claim = document.createElement('button');
      claim.type = 'button';
      claim.className = 'claim-button';
      claim.textContent = `收获${PLANT_SPECIES[plant.components.growth.speciesId].label}`;
      claim.addEventListener('click', () => claimPlant(plant.id));
      row.append(claim);
    }
    return row;
  });
  dom.plotList.replaceChildren(...cards);
}

function renderAnchorOverlay() {
  // 锚点编辑已结束；模型直接由 GLB 网格射线命中，不再叠加任何遮挡视野的 HTML 框。
  dom.overlay?.replaceChildren();
}

function renderUi() {
  renderPlotList();
  renderMysteryVisionMonitor();
  updateDaveMessage();
  renderDaveTaskStation();
  renderAnchorOverlay();
  dom.plantPea.disabled = !gameState || getSharedInventoryCount('seeds', 'peaShooter') === 0;
  dom.plantCorn.disabled = !gameState || getSharedInventoryCount('seeds', 'cornPult') === 0;
  const selectedPlot = getPlot();
  dom.waterPlant.disabled = !gameState || !selectedPlot || !getPlantForPlot(runtime.getManifest(), selectedPlot) || gameState.garden.waterCharges === 0;
  if (dom.seedBag && !dom.seedBag.hidden) setSeedBagOpen(true, { plotId: selectedPlotId });
}

function renderWorldMap() {
  if (!dom.mapDestinations) return;
  dom.mapDestinations.replaceChildren(...WORLD_DESTINATIONS.map((destination) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `map-destination map-destination--${destination.state}`;
    button.disabled = destination.state === 'current' || destination.state === 'planned';
    button.innerHTML = `<span class="map-destination__eyebrow">${destination.eyebrow}</span><strong>${destination.title}</strong><span>${destination.description}</span><em>${destination.state === 'current' ? '你在这里' : destination.state === 'planned' ? '筹备中' : '进入地点'}</em>`;
    if (destination.href) {
      button.addEventListener('click', () => { window.location.assign(destination.href); });
    }
    return button;
  }));
}

function setWorldMapOpen(open) {
  if (!dom.mapOverlay || !dom.mapToggle) return;
  if (open) releaseGardenPointerLock();
  dom.mapOverlay.hidden = !open;
  document.body.classList.toggle('world-map-open', open);
  dom.mapToggle.setAttribute('aria-expanded', String(open));
}

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function setGardenOnboardingOpen(open) {
  if (!dom.onboarding) return;
  if (open) releaseGardenPointerLock();
  dom.onboarding.hidden = !open;
  if (open) window.requestAnimationFrame(() => dom.onboardingClose?.focus());
}

function showGardenOnboarding() {
  if (!dom.onboarding || !consumeFirstVisit(getBrowserStorage(), 'backyard-garden-001')) return;
  setGardenOnboardingOpen(true);
}

function updateGardenMusicToggle() {
  if (!dom.musicToggle) return;
  dom.musicToggle.textContent = `音乐：${isGardenMusicEnabled ? '暂停' : '播放'} · P`;
  dom.musicToggle.setAttribute('aria-pressed', String(isGardenMusicEnabled));
}

async function resumeGardenMusic() {
  if (!isGardenMusicEnabled || !dom.sceneMusic) return;
  dom.sceneMusic.volume = 0.28;
  try {
    await dom.sceneMusic.play();
  } catch {
    // 首次自动播放受浏览器策略限制，会在下一次用户交互后再尝试。
  }
  updateGardenMusicToggle();
}

function toggleGardenMusic() {
  isGardenMusicEnabled = !isGardenMusicEnabled;
  if (!isGardenMusicEnabled) dom.sceneMusic?.pause();
  else void resumeGardenMusic();
  updateGardenMusicToggle();
}

function selectPlot(plotId) {
  selectedPlotId = plotId;
  renderUi();
}

async function execute(commands, explanation, requiresConfirmation = false) {
  const run = () => runtime.execute({
    commandId: `backyard:${crypto.randomUUID()}`,
    // 必须在真正轮到本操作时再取 revision，不能在入队瞬间提前捕获旧值。
    baseRevision: runtime.revision,
    commands,
    explanation,
    requiresConfirmation,
  }, { confirmed: requiresConfirmation });
  const queued = runtimeCommandQueue.then(run, run);
  // 即便某一次输入本身非法，也不能让后续有效操作永久卡在 rejected Promise 后面。
  runtimeCommandQueue = queued.catch(() => undefined);
  return queued;
}

function enqueueGardenAction(action) {
  const queued = gardenActionQueue.then(action, action);
  gardenActionQueue = queued.catch(() => undefined);
  return queued;
}

async function updateAnchorPosition(position, plotId = selectedPlotId) {
  const plot = getPlot(plotId);
  if (!plot) return;
  await execute([
    {
      type: 'SET_TRANSFORM',
      entityId: plot.id,
      transform: { ...plot.transform, position },
    },
    { type: 'SET_ENVIRONMENT_PROPERTY', key: 'anchorDraft', value: false },
  ], `校准 ${plot.label} 的空间锚点`);
  if (anchorPlacementEntityId === plot.id) cancelAnchorPlacement();
  renderUi();
}

async function updateDaveAnchorPosition(position) {
  const dave = getDaveEntity();
  if (!dave) throw new Error('场景中没有找到疯狂戴夫锚点');
  await execute([
    {
      type: 'SET_TRANSFORM',
      entityId: dave.id,
      transform: { ...dave.transform, position },
    },
  ], '校准疯狂戴夫的空间锚点');
  await syncDaveVisual();
  if (anchorPlacementEntityId === dave.id) cancelAnchorPlacement();
  renderUi();
  setDaveReply('阿喔柔！我的站位已经保存到这个花园的本地语义场景里。点击我的模型可打开任务台，按 Enter 则只打开聊天。');
}

async function plant(speciesId, plotId = selectedPlotId) {
  return enqueueGardenAction(async () => {
    try {
      // 操作前再读一次权威状态并恢复场景，避免旧标签页、戴夫任务台与种子袋各自
      // 持有过期的“空花圃”视图。
      await refreshGameState();
      const now = Date.now();
      const plot = getPlot(plotId);
      if (!plot) throw new Error('请先选择一个有效花圃');
      if (isPlotOccupied(runtime.getManifest(), plot)) throw new Error(`${plot.label}已经种有植物`);
      const requestedPlantId = `plant-${speciesId}-${plotId}-${now}`;
      gameState = await gameStateClient.command('plantSeed', { speciesId, plotId, now, plantId: requestedPlantId });
      const sharedPlant = gameState.garden.plots[plotId];
      const resolvedSpeciesId = sharedPlant?.speciesId;
      const resolvedSpecies = PLANT_SPECIES[resolvedSpeciesId];
      if (!sharedPlant || !resolvedSpecies) throw new Error('神秘种子的开奖结果未能写入花圃');
      const commands = createPlantingCommands(runtime.getManifest(), {
        speciesId: resolvedSpeciesId,
        plotId,
        now: sharedPlant.plantedAt,
        plantId: sharedPlant.id,
        sourceSeedId: sharedPlant.sourceSeedId ?? null,
      });
      await execute(commands, `在 ${plot.label} 种下 ${resolvedSpecies.label}`);
      renderUi();
      renderBackpack();
      setSeedBagOpen(false);
      const resultLabel = speciesId === MYSTERY_SEED_ID
        ? `神秘种子开出了${resolvedSpecies.label}`
        : `${resolvedSpecies.label}已种入${plot.label}`;
      showInteractionFeedback(resultLabel, 'success');
      return { ok: true, message: speciesId === MYSTERY_SEED_ID
        ? `戴夫在 ${plot.label} 播下神秘种子，结果是${resolvedSpecies.label}。`
        : `戴夫已在 ${plot.label} 种下${resolvedSpecies.label}。` };
    } catch (error) {
      dom.daveMessage.textContent = error.message;
      return { ok: false, message: error.message };
    }
  });
}

async function claimPlant(plantId) {
  try {
    const plant = runtime.getManifest().entities.find((entity) => entity.id === plantId);
    if (!plant) throw new Error('找不到要收获的植物');
    const species = PLANT_SPECIES[plant.components.growth.speciesId];
    gameState = await gameStateClient.command('claimMaturePlant', { plotId: plant.parentId, now: Date.now() });
    await execute(createClaimCommands(runtime.getManifest(), plantId), `收获 ${species.label} 并放入共享背包`);
    renderUi();
    renderBackpack();
    dom.daveMessage.textContent = `收获完成：${species.label} 已进入共享背包。前往潮汐防线按 Tab 选择它。`;
    showInteractionFeedback(`收获成功：${species.label}已放入背包`, 'success');
    return { ok: true, message: `${species.label} 已成熟并收入共享背包。` };
  } catch (error) {
    dom.daveMessage.textContent = error.message;
    return { ok: false, message: error.message };
  }
}

async function waterPlantAt(plotId = selectedPlotId) {
  try {
    const plot = getPlot(plotId);
    const plant = plot && getPlantForPlot(runtime.getManifest(), plot);
    if (!plot || !plant) throw new Error('先选择一块已经种下植物的花圃');
    gameState = await gameStateClient.command('waterGardenPlant', { plotId: plot.id, now: Date.now() });
    const sharedPlant = gameState.garden.plots[plot.id];
    const growth = plant.components.growth;
    await execute([
      { type: 'SET_COMPONENT', entityId: plant.id, component: 'growth', value: { ...growth, plantedAt: sharedPlant.plantedAt } },
    ], `用水壶照料 ${PLANT_SPECIES[growth.speciesId].label}`);
    await tickGrowth();
    renderBackpack();
    dom.daveMessage.textContent = '浇水完成：这一株植物已推进一个演示成长阶段。';
    showInteractionFeedback(`${PLANT_SPECIES[growth.speciesId].label}已浇水，成长推进`, 'water');
    return { ok: true, message: `${PLANT_SPECIES[growth.speciesId].label} 已浇水，并推进一个演示成长阶段。` };
  } catch (error) {
    dom.daveMessage.textContent = error.message;
    return { ok: false, message: error.message };
  }
}

async function uprootPlant(plantId, { actor = '铁铲' } = {}) {
  try {
    const plant = runtime.getManifest().entities.find((entity) => entity.id === plantId);
    if (!plant) throw new Error('找不到要清理的植物');
    const species = PLANT_SPECIES[plant.components.growth.speciesId];
    gameState = await gameStateClient.command('uprootGardenPlant', { plotId: plant.parentId, now: Date.now() });
    await execute(createUprootCommands(runtime.getManifest(), plant.id), `${actor}清理 ${species.label} 并返还种子`);
    renderUi();
    renderBackpack();
    dom.daveMessage.textContent = `${actor}已清理${species.label}，种子已返还背包。`;
    showInteractionFeedback(`${actor}已铲回${species.label}种子`, 'success');
    return { ok: true, message: `${species.label} 已清理，种子已返还。` };
  } catch (error) {
    dom.daveMessage.textContent = error.message;
    showInteractionFeedback(error.message, 'warning');
    return { ok: false, message: error.message };
  }
}

function renderCameraFrame() {
  if (!camera) return;
  const horizontal = Math.cos(orbit.elevation) * orbit.radius;
  camera.position.set(
    orbit.target.x + Math.sin(orbit.azimuth) * horizontal,
    orbit.target.y + Math.sin(orbit.elevation) * orbit.radius,
    orbit.target.z + Math.cos(orbit.azimuth) * horizontal,
  );
  camera.lookAt(orbit.target);
  // 场景依然每帧绘制，但分块的选级与请求无需每帧重算。
  // 这能减少高精度移动时的主线程波动，而不会主动降低当前画面质量。
  const now = performance.now();
  if (lodSplat && (lastLodTickAt === 0 || now - lastLodTickAt >= LOD_TICK_INTERVAL_MS || !lodInteractionActive)) {
    lodSplat.tick(camera);
    lastLodTickAt = now;
  }
  viewer?.render();
  if (!lodInteractionActive) renderAnchorOverlay();
  updateModelHoverAtReticle();
}

function updateCamera() {
  if (cameraRenderFrame !== null) return;
  cameraRenderFrame = window.requestAnimationFrame(() => {
    cameraRenderFrame = null;
    renderCameraFrame();
  });
}

function updateCameraNow() {
  if (cameraRenderFrame !== null) {
    window.cancelAnimationFrame(cameraRenderFrame);
    cameraRenderFrame = null;
  }
  renderCameraFrame();
}

function setLodInteractionMode(active) {
  if (!lodSplat || lodInteractionActive === active) return;
  lodInteractionActive = active;
  // 当前设备已验证有足够余量：移动时也保持和停下后相同的细化 LOD，
  // 不再让场景在转向和行走时主动降到低清档。
  lodSplat.setConfig({
    minLevel: Math.min(LOD_IDLE_MIN_LEVEL, lodMaxLevel),
    maxBudget: LOD_IDLE_SPLAT_BUDGET,
    frustumCullingEnabled: false,
  });
  lastLodTickAt = 0;
  setViewerConfig(viewer, {
    pipeline: {
      Splatting: {
        pack: {
          highPrecisionEnabled: true,
          cameraRelativeEnabled: false,
        },
        raster: {
          detailCullingThreshold: 0,
          maxPixelRadius: 1024,
          maxStdDev: Math.sqrt(8),
          preBlurAmount: 0,
          blurAmount: 0.3,
          normalizedFalloff: true,
        },
      },
    },
  });
}

function markCameraInteraction() {
  if (lodIdleTimer !== null) window.clearTimeout(lodIdleTimer);
  setLodInteractionMode(true);
  lodIdleTimer = window.setTimeout(() => {
    lodIdleTimer = null;
    setLodInteractionMode(false);
    updateCamera();
  }, LOD_IDLE_DELAY_MS);
}

function calculateInitialDraftPositions(boxMin, boxMax) {
  const rangeX = boxMax[0] - boxMin[0];
  const rangeY = boxMax[1] - boxMin[1];
  const rangeZ = boxMax[2] - boxMin[2];
  const floorY = boxMax[1] - Math.max(rangeY * 0.025, 0.04);
  const columns = [0.25, 0.5, 0.75].map((ratio) => boxMin[0] + rangeX * ratio);
  const rows = [0.33, 0.68].map((ratio) => boxMin[2] + rangeZ * ratio);
  return {
    'plot-a': [columns[0], floorY, rows[0]],
    'plot-b': [columns[1], floorY, rows[0]],
    'plot-c': [columns[2], floorY, rows[0]],
    'plot-d': [columns[0], floorY, rows[1]],
    'plot-e': [columns[1], floorY, rows[1]],
    'plot-f': [columns[2], floorY, rows[1]],
  };
}

function calculateInitialDaveAnchor(boxMin, boxMax) {
  const rangeX = boxMax[0] - boxMin[0];
  const rangeY = boxMax[1] - boxMin[1];
  const rangeZ = boxMax[2] - boxMin[2];
  // 与花圃同样贴到 3DGS 的视觉地面。放在温室右侧、略靠前的可见带，
  // 而不是沿用旧 PLY 的绝对坐标 [-42, -12, 20]。
  const floorY = boxMax[1] - Math.max(rangeY * 0.025, 0.04);
  return [
    boxMin[0] + rangeX * 0.73,
    floorY,
    boxMin[2] + rangeZ * 0.43,
  ];
}

function resolveRoomWalkBounds(meta, forwardBox) {
  // forwardBox 是 LOD 生成工具统计的“约 80% Gaussian 覆盖范围”，用于调度优先级；
  // 它不是温室墙体。这里仅用高密度且非离群的空间分块扩出平面可行走范围。
  const spatialNodes = (meta.tree ?? []).filter(({ bound, lods }) => (
    // 8k 左右的分块在这个 PLY 中是远处采样/漂浮残点，不能计入房间体积。
    lods?.[0]?.count >= 10_000
    && Math.abs(bound.min[0]) < 100 && Math.abs(bound.max[0]) < 100
    && Math.abs(bound.min[2]) < 100 && Math.abs(bound.max[2]) < 100
  ));
  if (!spatialNodes.length) {
    return {
      minX: forwardBox.min[0] + 0.3,
      maxX: forwardBox.max[0] - 0.3,
      minY: forwardBox.min[1] + 0.4,
      maxY: forwardBox.max[1] - 0.25,
      minZ: forwardBox.min[2] + 0.3,
      maxZ: forwardBox.max[2] - 0.3,
    };
  }
  const minX = Math.min(...spatialNodes.map(({ bound }) => bound.min[0]));
  const maxX = Math.max(...spatialNodes.map(({ bound }) => bound.max[0]));
  const minZ = Math.min(...spatialNodes.map(({ bound }) => bound.min[2]));
  const maxZ = Math.max(...spatialNodes.map(({ bound }) => bound.max[2]));
  return {
    minX: minX + 0.65,
    maxX: maxX - 0.65,
    // 保留已验证的地面与屋顶高度，避免飞穿温室。
    minY: forwardBox.min[1] + 0.4,
    maxY: forwardBox.max[1] - 0.25,
    minZ: minZ + 0.5,
    maxZ: maxZ - 0.5,
  };
}

function frameCameraFromForwardBox(meta) {
  const forwardBox = meta.forwardBox;
  const boxMin = forwardBox.min;
  const boxMax = forwardBox.max;
  const horizontalExtent = Math.max(boxMax[0] - boxMin[0], boxMax[2] - boxMin[2]);
  const verticalExtent = boxMax[1] - boxMin[1];
  // 此模型的 PLY 采用 -Y 为视觉向上：Y 最大面接近地面，Y 变小才是抬高。
  // 先把相机落到致密空间内部的人眼高度，不再用远距离总览把视角放到温室外。
  const eyeTargetY = boxMax[1] - Math.min(Math.max(verticalExtent * 0.32, 0.8), 1.7);
  const center = new Vector3(
    (boxMin[0] + boxMax[0]) * 0.5 - (boxMax[0] - boxMin[0]) * 0.12,
    eyeTargetY,
    (boxMin[2] + boxMax[2]) * 0.5 - (boxMax[2] - boxMin[2]) * 0.1,
  );
  roomOrbit = {
    target: center,
    radius: Math.max(1.15, Math.min(horizontalExtent * 0.3, 2.1)),
    azimuth: 0,
    elevation: 0,
  };
  orbit = { ...roomOrbit, target: roomOrbit.target.clone() };
  sceneDraftPositions = calculateInitialDraftPositions(boxMin, boxMax);
  sceneDraftDaveAnchor = calculateInitialDaveAnchor(boxMin, boxMax);
  movementBounds = resolveRoomWalkBounds(meta, forwardBox);
}

async function loadLodMeta() {
  const response = await fetch(LOD_META_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`LOD 元数据读取失败（HTTP ${response.status}）`);
  const meta = await response.json();
  if (meta?.magicCode !== 2500660 || meta?.type !== 'lod-splat' || !Array.isArray(meta.files)) {
    throw new Error('LOD 元数据格式无效。请重新生成 lod-v1 资源包。');
  }
  return meta;
}

async function loadLodResource(resource) {
  const absoluteUrl = new URL(resource, new URL('/assets/backyard/lod-v1/', window.location.origin)).toString();
  const fileType = SplatLoader.detectSplatFileType(absoluteUrl, new Uint8Array());
  if (fileType === undefined) throw new Error(`不支持的 LOD 分块格式：${resource}`);
  return SplatLoader.parseSplatData(fileType, absoluteUrl, SplatLoader.SplatPackType.Compressed);
}

function prepareSplatPointPicker() {
  if (splatPointPicker) return Promise.resolve(splatPointPicker);
  if (!splatPointPickerPromise) {
    splatPointPickerPromise = loadSplatPointPicker(SPLAT_PICKER_SOURCE_URL)
      .then((picker) => {
        splatPointPicker = picker;
        return picker;
      })
      .catch((error) => {
        splatPointPickerPromise = null;
        throw error;
      });
  }
  return splatPointPickerPromise;
}

async function positionUncalibratedAnchors() {
  const manifest = runtime.getManifest();
  if (!sceneDraftPositions || manifest.environment.anchorDraft === false) return;
  const commands = getPlots(manifest).map((plot) => ({
    type: 'SET_TRANSFORM',
    entityId: plot.id,
    transform: { ...plot.transform, position: sceneDraftPositions[plot.id] },
  }));
  const dave = getDaveEntity(manifest);
  if (dave && sceneDraftDaveAnchor) {
    commands.push({
      type: 'SET_TRANSFORM',
      entityId: dave.id,
      transform: { ...dave.transform, position: sceneDraftDaveAnchor },
    });
  }
  commands.push({ type: 'SET_ENVIRONMENT_PROPERTY', key: 'anchorDraft', value: false });
  await execute(commands, '将花圃与戴夫放入 3DGS 的致密可见区域');
}

function findModelInteraction(object) {
  let current = object;
  while (current) {
    const interaction = modelInteractionRoots.get(current);
    if (interaction) return { ...interaction, root: current };
    current = current.parent;
  }
  return null;
}

function refreshModelInteractionBounds(root) {
  if (!root) return;
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    modelInteractionBounds.delete(root);
    return;
  }
  // 只扩一丁点，补偿叶片、手臂等细小镂空区域，不会形成此前那种可见的大方框。
  bounds.expandByScalar(0.035);
  modelInteractionBounds.set(root, bounds);
}

function pickInjectedModelBoundsAtNdc(ndc) {
  if (!interactionRaycaster || !camera || !modelInteractionBounds.size) return null;
  camera.updateMatrixWorld(true);
  interactionRaycaster.setFromCamera(ndc, camera, dom.viewer.getBoundingClientRect().height);

  let nearest = null;
  let nearestDistance = Infinity;
  for (const [root, bounds] of modelInteractionBounds) {
    const hitPoint = interactionRaycaster.ray.intersectBox(bounds, INTERACTION_HIT_POINT);
    if (!hitPoint) continue;
    const distance = interactionRaycaster.ray.origin.distanceToSquared(hitPoint);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = { ...modelInteractionRoots.get(root), root };
  }
  return nearest;
}

function pickInjectedModelBoundsAtReticle() {
  return pickInjectedModelBoundsAtNdc(RETICLE_NDC);
}

function pickInjectedModelAtNdc(ndc) {
  if (!interactionRaycaster || !camera || !modelInteractionRoots.size) return null;
  const roots = [...modelInteractionRoots.keys()];
  camera.updateMatrixWorld(true);
  interactionRaycaster.setFromCamera(ndc, camera, dom.viewer.getBoundingClientRect().height);
  const hit = interactionRaycaster.intersectObjects(roots, true)[0];
  return hit ? findModelInteraction(hit.object) : null;
}

function pickInjectedModelAtReticle() {
  return pickInjectedModelAtNdc(RETICLE_NDC);
}

function setModelOutlineMode(root, mode) {
  root?.traverse((object) => {
    if (object.isMesh) object.outlineRenderMode = mode;
  });
}

function setModelHighlight(root, enabled) {
  if (!root) return;
  setModelOutlineMode(root, enabled ? OUTLINE_RENDER_MODE.DEFAULT : OUTLINE_RENDER_MODE.DISABLED);
  root.userData?.setHighlight?.(enabled);
  updateCamera();
}

function updateModelHoverAtReticle({ force = false } = {}) {
  const now = performance.now();
  if (!force && now - lastHoverPickAt < HOVER_PICK_INTERVAL_MS) return;
  lastHoverPickAt = now;
  // Hover 不再逐三角形遍历每个 GLB，而是只检测预缓存的模型包围范围。
  // 这样点云高精度运动时也不会因为准星高亮出现明显卡顿。
  const interaction = pickInjectedModelBoundsAtReticle();
  const nextRoot = interaction?.root ?? null;
  if (nextRoot === hoveredInteractionRoot) return;
  setModelHighlight(hoveredInteractionRoot, false);
  hoveredInteractionRoot = nextRoot;
  setModelHighlight(hoveredInteractionRoot, true);
  dom.viewer.classList.toggle('is-interactive-hover', Boolean(hoveredInteractionRoot));
  dom.viewerShell?.classList.toggle('has-interaction-target', Boolean(hoveredInteractionRoot));
}

async function interactWithGardenPlant(plantId) {
  const plant = runtime.getManifest().entities.find((entity) => entity.id === plantId);
  if (!plant) return;
  selectPlot(plant.parentId);
  const species = PLANT_SPECIES[plant.components.growth.speciesId];
  if (activeGardenTool === 'glove' && plant.components.growth.readyToClaim) {
    await claimPlant(plant.id);
  } else if (activeGardenTool === 'wateringCan' && !plant.components.growth.readyToClaim) {
    await waterPlantAt(plant.parentId);
  } else if (activeGardenTool === 'shovel') {
    await uprootPlant(plant.id);
  } else {
    const message = activeGardenTool === 'glove'
      ? `${species.label}尚未成熟，白手套暂时不能收获。可用水壶推进成长。`
      : `${species.label}已经成熟，请切换白手套后收获。`;
    dom.daveMessage.textContent = message;
    showInteractionFeedback(message, 'warning');
  }
}

function interactWithGardenPlot(plotId) {
  const plot = getPlot(plotId);
  if (!plot) return;
  if (isPlotOccupied(runtime.getManifest(), plot)) {
    selectPlot(plot.id);
    showInteractionFeedback(`${plot.label}已有作物，切换工具后可浇水、收获或铲除。`, 'warning');
    return;
  }
  selectPlot(plot.id);
  setSeedBagOpen(true, { plotId: plot.id });
  showInteractionFeedback(`${plot.label}已打开种子袋`, 'neutral');
}

function getInjectedModelInteractionAtNdc(ndc) {
  // 点击优先走精确网格命中；枝叶、锚点圆环的透明区域则回退到逻辑包围范围。
  return pickInjectedModelAtNdc(ndc) ?? pickInjectedModelBoundsAtNdc(ndc);
}

function handleInjectedModelClick(event, { useReticle = false } = {}) {
  // 鼠标未锁定时使用真实点击坐标；第一人称锁定时才使用中心准星。
  // 不直接读取 attachViewerControls() 的局部锁定函数，避免普通点击路径失去作用域。
  const ndc = useReticle ? RETICLE_NDC : getViewerPointerNdc(event);
  const interaction = getInjectedModelInteractionAtNdc(ndc);
  if (!interaction) return false;
  if (interaction.type === 'dave') {
    setDaveDialogOpen(true, { mode: 'tasks' });
    setDaveReply('歪比巴布！任务台已经打开。需要改变花园进度就点下面的明确任务；按 Enter 可以只和我聊植物长势。');
  } else if (interaction.type === 'garden-plant') {
    void interactWithGardenPlant(interaction.plantId);
  } else if (interaction.type === 'garden-plot') {
    interactWithGardenPlot(interaction.plotId);
  }
  return true;
}

function getViewerPointerNdc(event) {
  const rect = dom.viewer.getBoundingClientRect();
  return new Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

async function placeSelectedAnchorAtScenePointer(event) {
  const anchor = getEditableAnchorEntity();
  if (!anchor || !camera || !ray) return;
  const ndc = getViewerPointerNdc(event);
  try {
    // LodSplat 的公开 API 不提供高斯命中坐标；这里按同一份 PLY 的真实 Gaussian
    // 中心拾取，不再把旧锚点的 Y（例如 -12）作为落点高度。
    const picker = await prepareSplatPointPicker();
    camera.updateMatrixWorld(true);
    camera.castRay(ray, ndc);
    const position = picker.pick(ray.origin, ray.direction, {
      fovDegrees: camera.fov,
      viewportHeight: dom.viewer.getBoundingClientRect().height,
    });
    if (!position) {
      dom.daveMessage.textContent = '这里没有命中可用的 3DGS 点位；请轻点花圃或地板的清晰区域后重试。';
      return;
    }
    if (anchor.id === 'crazy-dave-guide') await updateDaveAnchorPosition(position);
    else await updateAnchorPosition(position, anchor.id);
  } catch (error) {
    dom.daveMessage.textContent = `${anchor.label}锚点未应用：${error.message}`;
  }
}

function attachViewerControls() {
  const maxPointerDelta = 160;
  const isViewerUiTarget = (target) => (
    target instanceof Element && Boolean(target.closest('button, input, textarea, select, [contenteditable="true"]'))
  );
  // Aholo Viewer 在容器中异步插入 Canvas。优先锁真实渲染画布，并兼容少数浏览器
  // 只允许父容器锁定的实现；不能再只比较 div 本身，避免“看似申请但状态永远不成立”。
  const getPointerLockTarget = () => dom.viewer.querySelector('canvas') ?? dom.viewer;
  const isPointerLockedToViewer = () => {
    const lockedElement = document.pointerLockElement;
    return lockedElement === dom.viewer || lockedElement === getPointerLockTarget();
  };
  const requestGardenPointerLock = () => {
    const target = getPointerLockTarget();
    if (!target?.requestPointerLock) {
      if (dom.viewerHint) dom.viewerHint.textContent = '当前浏览器没有开放鼠标锁定；请刷新后点击场景，或按住左键拖动作为临时操作。';
      return;
    }
    try {
      const request = target.requestPointerLock();
      // Chromium 新版会返回 Promise，旧版则返回 void；两者都兼容。
      request?.catch?.(() => {
        if (dom.viewerHint) dom.viewerHint.textContent = '鼠标锁定未被浏览器允许。先点击场景使页面获得焦点，再试一次；Esc 可随时释放。';
      });
    } catch {
      if (dom.viewerHint) dom.viewerHint.textContent = '鼠标锁定未启动。请先点击场景，再试一次；Esc 可随时释放。';
    }
  };
  const updatePointerLockedLook = (deltaX, deltaY) => {
    if (Math.abs(deltaX) > maxPointerDelta || Math.abs(deltaY) > maxPointerDelta) return;
    if (deltaX === 0 && deltaY === 0) return;
    markCameraInteraction();
    orbit.azimuth -= deltaX * 0.0042;
    orbit.elevation = Math.max(-1.22, Math.min(0.72, orbit.elevation + deltaY * 0.0038));
    updateCamera();
  };

  // 点击场景后锁定鼠标：第一人称环视没有边界，浏览器原生 Esc 会释放鼠标回到 UI。
  // Pointer Lock 下浏览器会把左键事件派发给 document，而不一定再回冒到 viewer 容器。
  // 因此在捕获阶段优先按中心准星处理命中，避免“模型已高亮但白手套没有反应”。
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !viewerReady || !isPointerLockedToViewer() || anchorPlacementEntityId) return;
    const handled = handleInjectedModelClick(event, { useReticle: true });
    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  dom.viewer.addEventListener('pointerdown', (event) => {
    if (!viewerReady || isViewerUiTarget(event.target)) return;
    if (event.button === 2 && isInspectingGardenTool) {
      gardenToolInspectRightDrag = true;
      pointerState = {
        pointerId: event.pointerId,
        moved: false,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      return;
    }
    if (event.button !== 0) return;
    // 释放鼠标时，直接点在植物、戴夫或空花圃圆环上必须保留真实点击坐标。
    // 以前这里无条件请求 Pointer Lock，导致 pointerup 只能按准星判定，从而“点了没反应”。
    const directInteraction = !isPointerLockedToViewer()
      ? getInjectedModelInteractionAtNdc(getViewerPointerNdc(event))
      : null;
    pointerState = {
      pointerId: event.pointerId,
      moved: false,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      directInteraction: Boolean(directInteraction),
    };
    if (event.pointerType === 'mouse' && !isPointerLockedToViewer() && !directInteraction) {
      requestGardenPointerLock();
    }
  });
  dom.viewer.addEventListener('pointermove', (event) => {
    if (!viewerReady || isViewerUiTarget(event.target)) return;
    if (!isPointerLockedToViewer() && isInspectingGardenTool && gardenToolInspectRightDrag && event.buttons & 2) {
      const deltaX = event.clientX - (pointerState?.lastClientX ?? event.clientX);
      const deltaY = event.clientY - (pointerState?.lastClientY ?? event.clientY);
      gardenToolViewer?.rotateInspection(deltaX, deltaY);
      if (pointerState) {
        pointerState.lastClientX = event.clientX;
        pointerState.lastClientY = event.clientY;
      }
      return;
    }
    // Pointer Lock 被浏览器临时拒绝时，仍保留“按住左键拖动”的诚实降级；
    // 它不是无限环视，但不会让用户陷入画面完全无法转动的状态。
    if (!isPointerLockedToViewer() && pointerState?.pointerId === event.pointerId && event.buttons & 1) {
      const deltaX = event.clientX - pointerState.lastClientX;
      const deltaY = event.clientY - pointerState.lastClientY;
      pointerState.lastClientX = event.clientX;
      pointerState.lastClientY = event.clientY;
      pointerState.moved ||= Math.hypot(deltaX, deltaY) > 0;
      updatePointerLockedLook(deltaX, deltaY);
    }
    updateModelHoverAtReticle();
  });
  document.addEventListener('mousemove', (event) => {
    if (!viewerReady || !isPointerLockedToViewer()) return;
    if (isInspectingGardenTool && gardenToolInspectRightDrag) {
      gardenToolViewer?.rotateInspection(event.movementX, event.movementY);
      return;
    }
    if (pointerState) pointerState.moved ||= Math.hypot(event.movementX, event.movementY) > 0;
    updatePointerLockedLook(event.movementX, event.movementY);
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = isPointerLockedToViewer();
    dom.viewerShell?.classList.toggle('is-pointer-locked', locked);
    if (dom.viewerHint) {
      dom.viewerHint.textContent = locked
        ? '第一人称环视已开启 · 鼠标无限旋转 · Esc 释放光标'
        : '点击 3DGS 场景进入第一人称环视 · Esc 释放光标';
    }
    if (!locked) pointerState = null;
    updateModelHoverAtReticle({ force: true });
  });
  document.addEventListener('pointerlockerror', () => {
    dom.viewerShell?.classList.remove('is-pointer-locked');
    if (dom.viewerHint) dom.viewerHint.textContent = '浏览器拒绝了鼠标锁定：先点击场景使页面获得焦点，再试一次。';
  });
  dom.viewer.addEventListener('pointerup', (event) => {
    if (event.button === 2) {
      gardenToolInspectRightDrag = false;
      pointerState = null;
      return;
    }
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    const state = pointerState;
    pointerState = null;
    if (state.moved || !viewerReady) return;
    handleInjectedModelClick(event, {
      // 已锁定的第一人称模式始终从中心准星交互；直接点中的对象保持真实坐标。
      useReticle: isPointerLockedToViewer() && !state.directInteraction,
    });
  });
  dom.viewer.addEventListener('pointercancel', () => {
    pointerState = null;
    gardenToolInspectRightDrag = false;
  });
  dom.viewer.addEventListener('contextmenu', (event) => {
    if (isInspectingGardenTool) event.preventDefault();
  });
  dom.viewer.addEventListener('wheel', (event) => {
    event.preventDefault();
    markCameraInteraction();
    orbit.radius = Math.max(0.8, Math.min(16, orbit.radius * (event.deltaY > 0 ? 1.12 : 0.89)));
    updateCamera();
  }, { passive: false });
  window.addEventListener('resize', () => {
    if (!camera) return;
    const rect = dom.viewer.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    updateCamera();
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isMovementCode(code) {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(code);
}

function movePlayer(deltaSeconds) {
  if (!camera || !movementBounds) return;
  const forwardX = orbit.target.x - camera.position.x;
  const forwardZ = orbit.target.z - camera.position.z;
  const forwardLength = Math.hypot(forwardX, forwardZ);
  if (forwardLength < 1e-4) return;

  const forward = { x: forwardX / forwardLength, z: forwardZ / forwardLength };
  // 点云的相机坐标系 Y 轴翻转，屏幕观察到的横向也需反向映射。
  const right = { x: forward.z, z: -forward.x };
  const localForward = Number(pressedMovementKeys.has('KeyW')) - Number(pressedMovementKeys.has('KeyS'));
  const localRight = Number(pressedMovementKeys.has('KeyD')) - Number(pressedMovementKeys.has('KeyA'));
  const localUp = Number(pressedMovementKeys.has('KeyE')) - Number(pressedMovementKeys.has('KeyQ'));
  const magnitude = Math.hypot(localForward, localRight, localUp);
  if (magnitude === 0) return;

  const speed = PLAYER_MOVE_SPEED;
  const step = (speed * deltaSeconds) / magnitude;
  orbit.target.x = clamp(orbit.target.x + (forward.x * localForward + right.x * localRight) * step, movementBounds.minX, movementBounds.maxX);
  orbit.target.z = clamp(orbit.target.z + (forward.z * localForward + right.z * localRight) * step, movementBounds.minZ, movementBounds.maxZ);
  // Aholo 该 PLY 的视觉向上为 -Y，因此 E 上升，Q 下降。
  orbit.target.y = clamp(orbit.target.y - localUp * step, movementBounds.minY, movementBounds.maxY);
}

function runMovementFrame(timestamp) {
  movementFrame = null;
  if (!pressedMovementKeys.size) {
    movementLastTimestamp = null;
    return;
  }
  const elapsed = Math.min((timestamp - (movementLastTimestamp ?? timestamp)) / 1_000, 0.05);
  movementLastTimestamp = timestamp;
  movePlayer(elapsed);
  markCameraInteraction();
  updateCamera();
  movementFrame = window.requestAnimationFrame(runMovementFrame);
}

function startMovementLoop() {
  if (movementFrame !== null) return;
  movementFrame = window.requestAnimationFrame(runMovementFrame);
}

function attachKeyboardMovement() {
  window.addEventListener('keydown', (event) => {
    if (isEditableTarget(event.target) || !isMovementCode(event.code)) return;
    event.preventDefault();
    const isNewPress = !pressedMovementKeys.has(event.code);
    pressedMovementKeys.add(event.code);
    // 首帧立即前进，避免键盘操作要等到下一帧才有反馈；持续按住再交给帧循环。
    if (isNewPress) {
      movePlayer(1 / 60);
      markCameraInteraction();
      updateCamera();
    }
    startMovementLoop();
  });
  window.addEventListener('keyup', (event) => {
    if (!isMovementCode(event.code)) return;
    pressedMovementKeys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    pressedMovementKeys.clear();
  });
}

async function startViewer() {
  setStatus('正在加载 3DGS 流式首屏…');
  // 正式体验只使用 SPZ LOD 分块；30MB 原始 PLY 仅保留给隐藏的锚点编辑器按需拾取，
  // 绝不能在每次进入花园时预读，否则既拖慢首屏又让评审包背上不必要的下载量。
  viewer = createViewer('backyard-garden-viewer', dom.viewer, {});
  const rect = dom.viewer.getBoundingClientRect();
  camera = new PerspectiveCamera(64, rect.width / rect.height, 0.1, 1_500);
  camera.up.set(0, -1, 0);
  ray = new Ray();
  interactionRaycaster = new Raycaster();
  viewer.setCamera(camera);
  setViewerConfig(viewer, {
    pipeline: {
      Background: { background: { active: BackgroundMode.BasicBackground, basic: { color: new Color('#122216') } }, ground: { enabled: false } },
      Splatting: {
        enabled: true,
        pack: {
          precalculateEnabled: false,
          cameraRelativeEnabled: false,
          highPrecisionEnabled: true,
          sortedLayoutEnabled: true,
        },
        raster: {
          focalAdjustment: 2,
          preBlurAmount: 0.3,
          blurAmount: 0,
          detailCullingThreshold: 3,
          maxPixelRadius: 256,
          maxStdDev: Math.sqrt(5),
        },
        sort: { minIntervalMs: 160 },
      },
      TAA: { enabled: false },
      // 仅被准星命中的 GLB 会切进 OutlineRenderMode.Default；3DGS 点云保持禁用，
      // 因而不会给整个温室描边，也不会引入遮挡视野的交互框。
      Outline: {
        enabled: true,
        highQuality: false,
        outlineColor: new Color('#c9ff94'),
        edgeThickness: 1,
        normalEdgeThickness: 1,
        depthEdgeThickness: 1,
      },
    },
  });
  viewer.requestRenderHandler = updateCamera;
  const meta = await withTimeout(
    loadLodMeta(),
    LOD_LOAD_TIMEOUT_MS,
    'LOD 元数据读取超过 35 秒。请检查开发服务器是否正在提供 lod-v1 目录。',
  );
  lodMaxLevel = meta.levels - 1;
  frameCameraFromForwardBox(meta);
  updateCameraNow();

  lodSplat = new SplatUtils.LodSplat(
    meta,
    {
      minLevel: lodMaxLevel,
      maxBudget: LOD_BOOT_SPLAT_BUDGET,
      backgroundPenalty: 0.35,
      schedulerParallelCounts: 6,
      schedulerExistingTaskLimit: 64,
    },
    createViewerContext(viewer),
    loadLodResource,
  );
  viewer.getScene().add(lodSplat.container);
  updateCameraNow();
  lodSplat.start();
  await withTimeout(
    lodSplat.onFinishSchedule(),
    LOD_LOAD_TIMEOUT_MS,
    'LOD 首屏加载超过 35 秒。请刷新页面；若仍复现，请检查浏览器控制台的分块请求。',
  );
  viewerReady = true;
  dom.loading.hidden = true;
  setStatus(`3DGS 后花园已就绪 · 行走与静止均保持高精度 · ${meta.tree.length} 个空间分块`, true);
  // 初始首屏停在最低 LOD；这里显式切到统一的高精度档。
  lodInteractionActive = true;
  setLodInteractionMode(false);
  updateCameraNow();
  renderUi();
  await syncPlantVisuals();
  syncPlotInteractionVisuals();
  await syncDaveVisual();
  await syncHeldGardenTool();
  showGardenOnboarding();
  monitorMysterySeedSprouts();
}

async function tickGrowth() {
  if (growthTickBusy) return;
  growthTickBusy = true;
  try {
    const commands = getPendingGrowthCommands(runtime.getManifest());
    if (commands.length) await execute(commands, '按已保存的种植时间推进植物阶段');
    renderUi();
  } finally {
    growthTickBusy = false;
  }
}

dom.plantPea.addEventListener('click', () => plant('peaShooter'));
dom.plantCorn.addEventListener('click', () => plant('cornPult'));
dom.waterPlant.addEventListener('click', () => waterPlantAt());
dom.seedBagClose?.addEventListener('click', () => setSeedBagOpen(false));
document.querySelectorAll('[data-quick-plant]').forEach((button) => {
  button.addEventListener('click', () => {
    void plant(button.dataset.quickPlant, selectedPlotId);
  });
});
document.querySelectorAll('[data-garden-tool]').forEach((button) => {
  button.addEventListener('click', () => setActiveGardenTool(button.dataset.gardenTool));
});
dom.backpackToggle.addEventListener('click', () => setBackpackOpen(dom.backpack.hidden));
dom.backpackClose.addEventListener('click', () => setBackpackOpen(false));
dom.daveToggle?.addEventListener('click', () => setDaveDialogOpen(dom.daveDialog.hidden));
dom.daveDialogClose?.addEventListener('click', () => setDaveDialogOpen(false));
dom.daveForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void askDave(dom.daveInput.value);
});
dom.daveQuickPrompts?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-dave-prompt]');
  if (!button || daveBusy) return;
  dom.daveInput.value = button.dataset.davePrompt;
  void askDave(dom.daveInput.value);
});
dom.daveOpenTaskStation?.addEventListener('click', () => {
  setDaveDialogOpen(true, { mode: 'tasks' });
  setDaveReply('歪比巴布！任务台已打开。播种、浇水、收获都只会走这里的明确按钮和本地状态机。');
});
dom.daveTaskPlantPea?.addEventListener('click', () => { void dispatchDaveTask('plant-pea'); });
dom.daveTaskPlantCorn?.addEventListener('click', () => { void dispatchDaveTask('plant-corn'); });
dom.daveTaskPlantMystery?.addEventListener('click', () => { void dispatchDaveTask('plant-mystery'); });
dom.daveTaskWater?.addEventListener('click', () => { void dispatchDaveTask('water'); });
dom.daveTaskHarvest?.addEventListener('click', () => { void dispatchDaveTask('harvest'); });
dom.onboardingClose?.addEventListener('click', () => setGardenOnboardingOpen(false));
dom.onboarding?.addEventListener('click', (event) => {
  if (event.target === dom.onboarding) setGardenOnboardingOpen(false);
});
window.addEventListener('keydown', (event) => {
  if (!dom.onboarding?.hidden) {
    if (event.key === 'Escape' || event.key === 'Enter') setGardenOnboardingOpen(false);
    event.preventDefault();
    return;
  }
  if (!isEditableTarget(event.target) && event.code === 'KeyP') {
    event.preventDefault();
    toggleGardenMusic();
    return;
  }
  if (!isEditableTarget(event.target) && event.code === 'KeyM') {
    event.preventDefault();
    setWorldMapOpen(dom.mapOverlay?.hidden);
    return;
  }
  if (!isEditableTarget(event.target) && event.code === 'Enter') {
    event.preventDefault();
    const open = dom.daveDialog?.hidden;
    setDaveDialogOpen(open, { mode: 'chat' });
    if (open) {
      setDaveReply('阿喔柔！这里是纯聊天：我会分析花圃与植物状态，不会从你的话里执行任何园艺操作。需要做事请用任务台。');
    }
    return;
  }
  if (!isEditableTarget(event.target) && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
    event.preventDefault();
    setActiveGardenTool({ Digit1: 'glove', Digit2: 'wateringCan', Digit3: 'shovel' }[event.code]);
    return;
  }
  if (!isEditableTarget(event.target) && event.code === 'KeyV') {
    event.preventDefault();
    if (GARDEN_TOOL_ASSETS[activeGardenTool]) {
      setGardenToolInspection(!isInspectingGardenTool);
    } else {
      dom.daveMessage.textContent = '当前工具的手持模型尚未准备好；请稍候或切换工具后再检视。';
    }
    return;
  }
  if (!isEditableTarget(event.target) && event.code === 'Escape' && isInspectingGardenTool) {
    setGardenToolInspection(false);
    return;
  }
  if (event.code !== 'Tab' || isEditableTarget(event.target)) return;
  event.preventDefault();
  setBackpackOpen(dom.backpack.hidden);
  void refreshGameState();
});
dom.focusGarden.addEventListener('click', () => {
  if (!roomOrbit) return;
  orbit = { ...roomOrbit, target: roomOrbit.target.clone() };
  updateCamera();
});
if (dom.mapToggle && dom.mapClose && dom.mapOverlay) {
  dom.mapToggle.addEventListener('click', () => setWorldMapOpen(dom.mapOverlay.hidden));
  dom.mapClose.addEventListener('click', () => setWorldMapOpen(false));
  dom.mapOverlay.addEventListener('click', (event) => {
    if (event.target === dom.mapOverlay) setWorldMapOpen(false);
  });
}
dom.musicToggle?.addEventListener('click', toggleGardenMusic);
document.addEventListener('pointerdown', () => { void resumeGardenMusic(); }, { capture: true });
dom.panelToggle.addEventListener('click', () => {
  releaseGardenPointerLock();
  const collapsed = document.body.classList.toggle('panel-collapsed');
  dom.panelToggle.textContent = collapsed ? '打开面板' : '收起面板';
  dom.panelToggle.setAttribute('aria-expanded', String(!collapsed));
});
runtime.subscribe(() => {
  renderUi();
  monitorMysterySeedSprouts();
  Promise.all([syncPlantVisuals(), syncPlotInteractionVisuals(), syncDaveVisual()]).catch((error) => {
    console.error(error);
    dom.daveMessage.textContent = `花园动态模型加载失败：${error.message}`;
  });
});

attachViewerControls();
attachKeyboardMovement();
renderUi();
renderWorldMap();
updateGardenMusicToggle();
setActiveGardenTool('glove');
void refreshGameState({ announceFailure: true });
setInterval(tickGrowth, 1_000);
startViewer().catch((error) => {
  console.error(error);
  dom.loading.hidden = true;
  setStatus('场景加载失败：请检查浏览器控制台和 LOD 资源包', false);
  dom.daveMessage.textContent = `3DGS 流式载入失败：${error.message}`;
});
