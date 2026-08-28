import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { EquirectangularAdapter, Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { consumeFirstVisit, createGameStateClient, parseSceneManifest, resolveMySpaceAppRoute } from 'spatial-intelligence-core';
import { getPanoramaDescriptor } from './panorama-source.js';
import { gardenSupplyShopScene } from './scenes/garden-supply-shop.scene.js';
import { graveGateScene } from './scenes/grave-gate.scene.js';
import './styles.css';

// 正式路线只保留墓园入口与园艺补给站；旧工坊、角色试验与六面体对照均不参与交付包。
const scenes = [graveGateScene, gardenSupplyShopScene].map(parseSceneManifest);
const scenesById = new Map(scenes.map((scene) => [scene.sceneId, scene]));
const requestedSceneId = new URLSearchParams(window.location.search).get('scene');
let activeScene = scenesById.get(requestedSceneId) ?? scenesById.get('grave-gate-001');
const loadingLayer = document.querySelector('#loading-layer');
const progressValue = document.querySelector('#progress-value');
const progressLabel = document.querySelector('#progress-label');
const recenterButton = document.querySelector('#recenter-button');
const mapToggle = document.querySelector('#map-toggle');
const worldMap = document.querySelector('#world-map');
const mapClose = document.querySelector('#map-close');
const sceneMusic = document.querySelector('#scene-music');
const musicToggle = document.querySelector('#music-toggle');
const interactionHint = document.querySelector('#interaction-hint');
const panel = document.querySelector('#scene-panel');
const panelClose = document.querySelector('#panel-close');
const panelKicker = document.querySelector('#panel-kicker');
const panelTitle = document.querySelector('#panel-title');
const panelCopy = document.querySelector('#panel-copy');
const panelAction = document.querySelector('#panel-action');
const shopCatalog = document.querySelector('#shop-catalog');
const shopCatalogItems = document.querySelector('#shop-catalog-items');
const shopCatalogClose = document.querySelector('#shop-catalog-close');
const shopCartSummary = document.querySelector('#shop-cart-summary');
const shopClearCart = document.querySelector('#shop-clear-cart');
const fusionBoard = document.querySelector('#fusion-board');
const fusionBoardClose = document.querySelector('#fusion-board-close');
const fusionInventory = document.querySelector('#fusion-inventory');
const fusionRecipes = document.querySelector('#fusion-recipes');
const shopBattleLink = document.querySelector('#shop-battle-link');
const daveOnboarding = document.querySelector('#dave-onboarding');
const daveOnboardingTitle = document.querySelector('#dave-onboarding-title');
const daveOnboardingLine = document.querySelector('#dave-onboarding-line');
const daveOnboardingCopy = document.querySelector('#dave-onboarding-copy');
const daveOnboardingClose = document.querySelector('#dave-onboarding-close');
const APP_ROUTES = Object.freeze({
  garden: resolveMySpaceAppRoute('garden', { override: import.meta.env.VITE_MYSPACE_GARDEN_URL }),
  battle: resolveMySpaceAppRoute('battle', { override: import.meta.env.VITE_MYSPACE_BATTLE_URL }),
});

const SHOP_ITEMS = [
  {
    id: 'pea-shooter-seed',
    kind: '种子包',
    title: '豌豆射手种子包',
    description: '成熟后成为可手持的直线射击植物。',
    price: 150,
    image: '/assets/shop/pea-shooter-seed-packet-v1.png',
  },
  {
    id: 'corn-pult-seed',
    kind: '种子包',
    title: '玉米投手种子包',
    description: '成熟后可用叶片弹射玉米粒，攻击走抛物线。',
    price: 180,
    image: '/assets/shop/corn-pult-seed-packet-v3-lux-reference.png',
  },
  {
    id: 'mystery-seed',
    kind: '稀有种子',
    title: '神秘种子',
    description: '播种时随机变为豌豆、玉米，或低概率开出西瓜投手。西瓜不会单独出售。',
    price: 280,
    icon: '?',
    tone: 'mystery',
  },
  {
    id: 'quick-grow-fertilizer',
    kind: '园艺道具',
    title: '速生肥',
    description: '原型规则：让一株植物直接推进一个生长阶段。',
    price: 60,
    icon: '✦',
    tone: 'mint',
  },
  {
    id: 'harvest-fertilizer',
    kind: '园艺道具',
    title: '丰收肥',
    description: '成熟时额外获得一份同类种子。',
    price: 90,
    icon: '☘',
    tone: 'gold',
  },
];

const FUSION_RECIPES = [
  {
    id: 'pea-to-double',
    sourceId: 'peaShooter',
    sourceTitle: '一星 · 豌豆射手',
    resultId: 'doublePeaShooter',
    resultTitle: '二星 · 双发豌豆射手',
  },
  {
    id: 'double-to-gatling',
    sourceId: 'doublePeaShooter',
    sourceTitle: '二星 · 双发豌豆射手',
    resultId: 'gatlingPeaShooter',
    resultTitle: '三星 · 机枪豌豆射手',
  },
  {
    id: 'corn-to-cannon',
    sourceId: 'cornPult',
    sourceCount: 9,
    sourceTitle: '一星 · 玉米投手',
    resultId: 'cornCannon',
    resultTitle: '玉米加农炮（单局道具）',
  },
];

// 这里只是“合成材料抽屉”，而非完整背包。西瓜投手是神秘种子的稀有战斗作物，
// 暂无合成路线，不应在此干扰合成决策。
const FUSION_INVENTORY_PLANT_IDS = Object.freeze([
  ...new Set(FUSION_RECIPES.flatMap(({ sourceId, resultId }) => [sourceId, resultId])),
]);

const gameStateClient = createGameStateClient();
let gameState = null;
let viewer;
let markersPlugin;
let isMusicEnabled = true;
let initialPanoramaFinished = false;

const SCENE_MUSIC = Object.freeze({
  'grave-gate-001': '/assets/audio/zombies-on-your-lawn.mp3',
  'garden-supply-shop-001': '/assets/audio/zen-garden.mp3',
});

const SCENE_ONBOARDING = Object.freeze({
  'grave-gate-001': Object.freeze({
    title: '月夜墓园入口',
    line: '歪比巴布，阿喔柔！墓碑铃铛响啦！',
    copy: '（这里是冒险入口。点击正前方的墓园大门，先到园艺小卡车准备种子和工具。）',
  }),
  'garden-supply-shop-001': Object.freeze({
    title: '园艺小卡车商店',
    line: '啊吧啊吧，小卡车转圈圈！',
    copy: '（右边小卡车卖普通种子、神秘种子和肥料；左边合成台能把三株相同植物升级。准备好后，前往后花园播种。）',
  }),
});

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function setDaveOnboardingOpen(open) {
  if (!daveOnboarding) return;
  daveOnboarding.hidden = !open;
  if (open) window.requestAnimationFrame(() => daveOnboardingClose?.focus());
}

function showSceneOnboarding(sceneId) {
  const copy = SCENE_ONBOARDING[sceneId];
  if (!copy || !daveOnboarding || !consumeFirstVisit(getBrowserStorage(), sceneId)) return;
  daveOnboardingTitle.textContent = copy.title;
  daveOnboardingLine.textContent = copy.line;
  daveOnboardingCopy.textContent = copy.copy;
  setDaveOnboardingOpen(true);
}

function getMarkerClass(tone) {
  return `world-marker world-marker--${tone}`;
}

function createMarker(entity) {
  const marker = entity.components.panoramaMarker;
  const sprite = entity.components.panoramaSprite;
  if (sprite) {
    const asset = activeScene.assets.find((candidate) => candidate.id === sprite.assetId);
    if (!asset) throw new Error(`找不到全景精灵资源：${sprite.assetId}`);
    return {
      id: entity.id,
      position: { yaw: `${marker.yaw}deg`, pitch: `${marker.pitch}deg` },
      html: `<button class="panorama-sprite ${sprite.cssClass ?? ''}" type="button" data-entity-id="${entity.id}" aria-label="${sprite.label ?? entity.label}"><img src="${asset.uri}" alt="" draggable="false"><span>${entity.label}</span></button>`,
      anchor: 'bottom center',
      scale: sprite.scale,
      data: { entityId: entity.id },
    };
  }
  return {
    id: entity.id,
    position: { yaw: `${marker.yaw}deg`, pitch: `${marker.pitch}deg` },
    html: `<button class="${getMarkerClass(marker.tone)}" type="button" aria-label="${entity.label}"><span></span></button>`,
    anchor: 'bottom center',
    data: { entityId: entity.id },
  };
}

function getMarkers(scene) {
  return scene.entities
    .filter((entity) => entity.interactive && entity.components.panoramaMarker)
    .map(createMarker);
}

function getEntity(entityId) {
  return activeScene.entities.find((entity) => entity.id === entityId);
}

function updateSceneTitle() {
  document.querySelector('#scene-title').textContent = activeScene.metadata.title;
  interactionHint.textContent = activeScene.sceneId === 'grave-gate-001'
    ? '点击墓园大门开始冒险'
    : '点击小卡车或合成台互动';
}

function updateMusicToggle() {
  if (!musicToggle) return;
  musicToggle.textContent = `音乐：${isMusicEnabled ? '暂停' : '播放'} · P`;
  musicToggle.setAttribute('aria-pressed', String(isMusicEnabled));
}

async function resumeSceneMusic() {
  if (!isMusicEnabled || !sceneMusic) return;
  try {
    await sceneMusic.play();
  } catch {
    // 浏览器必须先收到一次用户手势；按钮和第一次点击都会再次尝试播放。
  }
  updateMusicToggle();
}

function syncSceneMusic({ autoplay = false } = {}) {
  if (!sceneMusic) return;
  const nextSource = SCENE_MUSIC[activeScene.sceneId];
  if (nextSource && sceneMusic.getAttribute('src') !== nextSource) {
    sceneMusic.src = nextSource;
    sceneMusic.load();
  }
  sceneMusic.volume = 0.34;
  if (autoplay) void resumeSceneMusic();
  else updateMusicToggle();
}

function toggleSceneMusic() {
  isMusicEnabled = !isMusicEnabled;
  if (!isMusicEnabled) sceneMusic?.pause();
  else void resumeSceneMusic();
  updateMusicToggle();
}

function setWorldMapOpen(open) {
  if (!worldMap || !mapToggle) return;
  worldMap.hidden = !open;
  mapToggle.setAttribute('aria-expanded', String(open));
}

function renderWorldMap() {
  document.querySelectorAll('[data-panorama-scene]').forEach((button) => {
    const isCurrent = button.dataset.panoramaScene === activeScene.sceneId;
    button.disabled = isCurrent;
    button.classList.toggle('map-destination--current', isCurrent);
    button.classList.toggle('map-destination--ready', !isCurrent);
    const label = button.querySelector('em');
    if (label) label.textContent = isCurrent ? '你在这里' : '进入地点';
  });
}

function transitionToScene(sceneId) {
  const target = scenesById.get(sceneId);
  if (!target || target.sceneId === activeScene.sceneId) return;
  setWorldMapOpen(false);
  loadingLayer.classList.remove('is-hidden');
  progressLabel.textContent = '正在切换全景地点…';
  void useScene(target)
    .then(() => showSceneOnboarding(target.sceneId))
    .catch((error) => {
      loadingLayer.classList.remove('is-hidden');
      progressLabel.textContent = `全景切换失败：${error.message}`;
    });
}

function mountViewer() {
  const panorama = getPanoramaDescriptor(activeScene);
  const startView = activeScene.metadata.startView;

  progressValue.style.width = '4%';
  progressLabel.textContent = '加载全景底图';
  loadingLayer.classList.remove('is-hidden');
  viewer?.destroy();
  viewer = new Viewer({
    container: document.querySelector('#viewer'),
    panorama: panorama.source,
    defaultYaw: `${startView.yaw}deg`,
    defaultPitch: `${startView.pitch}deg`,
    defaultZoomLvl: startView.zoom,
    maxFov: 95,
    minFov: 35,
    adapter: EquirectangularAdapter.withConfig({ resolution: 256 }),
    rendererParameters: { antialias: true, powerPreference: 'high-performance' },
    navbar: ['zoom', 'move', 'fullscreen'],
    plugins: [MarkersPlugin.withConfig({ markers: getMarkers(activeScene) })],
  });

  markersPlugin = viewer.getPlugin(MarkersPlugin);
  const finishInitialPanorama = () => {
    const isFirstPanorama = !initialPanoramaFinished;
    initialPanoramaFinished = true;
    loadingLayer.classList.add('is-hidden');
    progressLabel.textContent = '全景已就绪';
    if (isFirstPanorama) window.setTimeout(() => showSceneOnboarding(activeScene.sceneId), 120);
  };
  viewer.addEventListener('load-progress', ({ progress }) => {
    const percent = Math.round(progress * 100);
    progressValue.style.width = `${percent}%`;
    progressLabel.textContent = `加载全景底图 ${percent}%`;
  });
  viewer.addEventListener('ready', finishInitialPanorama);
  viewer.addEventListener('panorama-loaded', finishInitialPanorama);
  if (viewer.state.ready) finishInitialPanorama();
}

function useScene(scene) {
  const panorama = getPanoramaDescriptor(scene);
  const startView = scene.metadata.startView;
  activeScene = scene;
  closePanel();
  closeShopCatalog();
  closeFusionBoard();
  updateSceneTitle();
  syncSceneMusic({ autoplay: true });
  renderWorldMap();
  markersPlugin.setMarkers(getMarkers(scene));
  return viewer.setPanorama(panorama.source, {
    position: { yaw: `${startView.yaw}deg`, pitch: `${startView.pitch}deg` },
    zoom: startView.zoom,
    transition: { effect: 'fade', speed: 700 },
  });
}

function openPanel(entity) {
  const interaction = entity.components.interaction;
  // 墓园门是入口：点击后立即进入补给站，不再强迫用户再点一次说明面板。
  if (entity.kind === 'world-entrance' && interaction?.targetSceneId) {
    transitionToScene(interaction.targetSceneId);
    return;
  }
  if (interaction?.actionType === 'open-shop-catalog') {
    openShopCatalog();
    return;
  }
  if (interaction?.actionType === 'open-fusion-station') {
    openFusionBoard();
    return;
  }
  panelKicker.textContent = entity.kind.replaceAll('-', ' ').toUpperCase();
  panelTitle.textContent = interaction?.title ?? entity.label;
  panelCopy.textContent = interaction?.copy ?? '此交互暂未配置。';
  panel.dataset.entityId = entity.id;
  panelAction.textContent = interaction?.actionLabel ?? '继续';
  panelAction.hidden = !interaction?.targetSceneId;
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  panel.removeAttribute('data-entity-id');
}

function getGameInventoryCount(group, key) {
  return gameState?.inventory?.[group]?.[key] ?? 0;
}

function reportStoreIssue(message) {
  shopCartSummary.textContent = message;
}

async function refreshGameState({ announceFailure = false } = {}) {
  try {
    gameState = await gameStateClient.getState();
    if (shopCatalog.getAttribute('aria-hidden') === 'false') renderShopCatalog();
    if (fusionBoard.getAttribute('aria-hidden') === 'false') renderFusionBoard();
  } catch (error) {
    if (announceFailure) reportStoreIssue(`本地共享背包未连接：${error.message}`);
  }
}

function renderShopCatalog() {
  shopCatalogItems.replaceChildren();
  for (const item of SHOP_ITEMS) {
    const card = document.createElement('article');
    card.className = 'shop-item';
    const visual = document.createElement('div');
    visual.className = 'shop-item__visual';
    if (item.image) {
      const image = document.createElement('img');
      image.src = item.image;
      image.alt = item.title;
      image.loading = 'lazy';
      visual.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = `shop-item__fertilizer shop-item__fertilizer--${item.tone}`;
      icon.textContent = item.icon;
      icon.setAttribute('aria-hidden', 'true');
      visual.append(icon);
    }
    const content = document.createElement('div');
    content.className = 'shop-item__content';
    const kind = document.createElement('span');
    kind.className = 'shop-item__kind';
    kind.textContent = item.kind;
    const title = document.createElement('h3');
    title.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = item.description;
    content.append(kind, title, description);
    const action = document.createElement('div');
    action.className = 'shop-item__action';
    const price = document.createElement('span');
    price.className = 'shop-item__price';
    price.textContent = `${item.price} 阳光`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shop-item__add';
    button.dataset.shopItemId = item.id;
    button.textContent = gameState ? '购买并放入背包' : '连接库存中…';
    button.disabled = !gameState;
    button.addEventListener('click', () => addShopItem(item.id));
    action.append(price, button);
    card.append(visual, content, action);
    shopCatalogItems.append(card);
  }
  if (!gameState) {
    shopCartSummary.textContent = '正在连接本地共享背包…';
    shopClearCart.disabled = true;
    return;
  }
  shopCartSummary.textContent = `阳光 ${gameState.sun} · 豌豆种子 ${getGameInventoryCount('seeds', 'peaShooter')} · 玉米种子 ${getGameInventoryCount('seeds', 'cornPult')} · 神秘种子 ${getGameInventoryCount('seeds', 'mysterySeed')} · 速生肥 ${getGameInventoryCount('fertilizer', 'quickGrow')}`;
  shopClearCart.textContent = '前往后花园';
  shopClearCart.disabled = false;
}

function openShopCatalog() {
  closePanel();
  renderShopCatalog();
  shopCatalog.setAttribute('aria-hidden', 'false');
  void refreshGameState({ announceFailure: true });
}

function closeShopCatalog() {
  shopCatalog.setAttribute('aria-hidden', 'true');
}

async function addShopItem(itemId) {
  try {
    gameState = await gameStateClient.command('buyShopItem', { itemId });
    renderShopCatalog();
  } catch (error) {
    reportStoreIssue(error.message);
  }
}

function getFusionPlantTitle(plantId) {
  return {
    peaShooter: '一星豌豆射手',
    doublePeaShooter: '二星双发射手',
    gatlingPeaShooter: '三星机枪射手',
    cornPult: '一星玉米投手',
    cornCannon: '玉米加农炮',
  }[plantId] ?? plantId;
}

function renderFusionBoard() {
  fusionInventory.replaceChildren();
  for (const plantId of FUSION_INVENTORY_PLANT_IDS) {
    const quantity = getGameInventoryCount('plants', plantId);
    const token = document.createElement('span');
    token.className = 'fusion-stock-token';
    token.textContent = `${getFusionPlantTitle(plantId)} ×${quantity}`;
    fusionInventory.append(token);
  }
  const cannonToken = document.createElement('span');
  cannonToken.className = 'fusion-stock-token';
  cannonToken.textContent = `玉米加农炮 ×${getGameInventoryCount('consumables', 'cornCannon')}`;
  fusionInventory.append(cannonToken);
  fusionRecipes.replaceChildren();
  for (const recipe of FUSION_RECIPES) {
    const sourceCount = recipe.sourceCount ?? 3;
    const sourceQuantity = getGameInventoryCount('plants', recipe.sourceId);
    const remaining = Math.max(0, sourceCount - sourceQuantity);
    const card = document.createElement('article');
    card.className = 'fusion-recipe';
    const source = document.createElement('p');
    source.className = 'fusion-recipe__formula';
    source.textContent = `${recipe.sourceTitle} ×${sourceCount}  →  ${recipe.resultTitle}`;
    const status = document.createElement('span');
    status.className = sourceQuantity >= sourceCount ? 'fusion-recipe__status is-ready' : 'fusion-recipe__status';
    status.textContent = sourceQuantity >= sourceCount ? '材料齐全' : `还差 ${remaining} 个`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fusion-recipe__button';
    button.textContent = `合成为${recipe.resultTitle.replace(/^.{3} · /, '')}`;
    button.disabled = !gameState || sourceQuantity < sourceCount;
    button.addEventListener('click', () => performFusion(recipe.id));
    card.append(source, status, button);
    fusionRecipes.append(card);
  }
}

function openFusionBoard() {
  closePanel();
  closeShopCatalog();
  renderFusionBoard();
  fusionBoard.setAttribute('aria-hidden', 'false');
  void refreshGameState({ announceFailure: true });
}

function closeFusionBoard() {
  fusionBoard.setAttribute('aria-hidden', 'true');
}

async function performFusion(recipeId) {
  const recipe = FUSION_RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe) return;
  try {
    gameState = await gameStateClient.command('mergePlants', { recipeId });
    renderFusionBoard();
  } catch (error) {
    reportStoreIssue(error.message);
  }
}

updateSceneTitle();
renderWorldMap();
syncSceneMusic();
mountViewer();

markersPlugin.addEventListener('select-marker', ({ marker }) => {
  const entity = getEntity(marker.data.entityId);
  if (entity) openPanel(entity);
});

// HTML 精灵有自己的按钮语义；在 PSV 的泛点击处理前取走事件。
document.querySelector('#viewer').addEventListener('click', (event) => {
  const sprite = event.target.closest('.panorama-sprite[data-entity-id]');
  if (!sprite) return;
  event.preventDefault();
  event.stopPropagation();
  const entity = getEntity(sprite.dataset.entityId);
  if (entity) openPanel(entity);
}, { capture: true });

recenterButton.addEventListener('click', () => {
  const startView = activeScene.metadata.startView;
  viewer.animate({
    yaw: `${startView.yaw}deg`,
    pitch: `${startView.pitch}deg`,
    zoom: startView.zoom,
    speed: '1.2rpm',
  });
});

mapToggle?.addEventListener('click', () => setWorldMapOpen(worldMap?.hidden));
mapClose?.addEventListener('click', () => setWorldMapOpen(false));
musicToggle?.addEventListener('click', toggleSceneMusic);
document.addEventListener('pointerdown', () => { void resumeSceneMusic(); }, { capture: true });
worldMap?.addEventListener('click', (event) => {
  if (event.target === worldMap) setWorldMapOpen(false);
});
document.querySelectorAll('[data-panorama-scene]').forEach((button) => {
  button.addEventListener('click', () => transitionToScene(button.dataset.panoramaScene));
});
document.querySelectorAll('[data-app-route]').forEach((button) => {
  button.addEventListener('click', () => {
    const route = APP_ROUTES[button.dataset.appRoute];
    if (route) window.location.assign(route);
  });
});

panelClose.addEventListener('click', closePanel);
shopCatalogClose.addEventListener('click', closeShopCatalog);
fusionBoardClose.addEventListener('click', closeFusionBoard);
daveOnboardingClose?.addEventListener('click', () => setDaveOnboardingOpen(false));
daveOnboarding?.addEventListener('click', (event) => {
  if (event.target === daveOnboarding) setDaveOnboardingOpen(false);
});
shopClearCart.addEventListener('click', () => {
  window.location.assign(APP_ROUTES.garden);
});
shopBattleLink.addEventListener('click', () => window.location.assign(APP_ROUTES.battle));
document.addEventListener('keydown', (event) => {
  if (!daveOnboarding?.hidden) {
    if (event.key === 'Escape' || event.key === 'Enter') setDaveOnboardingOpen(false);
    event.preventDefault();
    return;
  }
  if (event.code === 'KeyM' && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault();
    setWorldMapOpen(worldMap?.hidden);
    return;
  }
  if (event.code === 'KeyP' && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault();
    toggleSceneMusic();
    return;
  }
  if (event.key === 'Escape') {
    setWorldMapOpen(false);
    closeShopCatalog();
    closeFusionBoard();
  }
});
panelAction.addEventListener('click', () => {
  const entity = getEntity(panel.dataset.entityId);
  const targetScene = entity?.components.interaction?.targetSceneId;
  if (!targetScene) {
    panelAction.hidden = true;
    return;
  }
  const target = scenesById.get(targetScene);
  if (target) void useScene(target).then(() => showSceneOnboarding(target.sceneId));
});

void refreshGameState();
