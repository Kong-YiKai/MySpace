import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { consumeFirstVisit, createGameStateClient, GAME_WEAPONS, resolveMySpaceAppRoute } from 'spatial-intelligence-core';
import { BEACH_DEFENSE_CONFIG, clampPlayerPosition } from './scene-config.js';
import { createBattleEnvironment } from './battle-environment.js';
import { DEFENSE_RULES, PLANT_STATS, TIDE_LEVELS, ZOMBIE_STATS } from './battle-balance.js';
import { completeLevel, createInitialLevelProgress, isLevelUnlocked, LEVEL_PROGRESS_STORAGE_KEY, restoreLevelProgress } from './level-progression.js';
import { estimateLobRange, getLobChargeProgress, getLobShotProfile } from './lob-charge.js';
import { createTideMaterial, updateTideMaterial } from './ocean-material.js';
import { getWeaponMotion } from './weapon-motion.js';
import './styles.css';

const MODEL_CATALOG = Object.freeze({
  weapons: Object.freeze({
    peaShooter: Object.freeze({
      label: '豌豆射手',
      uri: '/assets/models/pea-shooter-lux3d-v1.glb',
      targetHeight: 0.9,
      yaw: Math.PI,
      status: 'ready',
      attack: Object.freeze({
        style: 'direct',
        projectileId: 'pea',
        speed: BEACH_DEFENSE_CONFIG.projectile.speed,
        gravity: 0,
        hitRadius: BEACH_DEFENSE_CONFIG.projectile.hitRadius,
        projectileCount: PLANT_STATS.peaShooter.projectileCount,
        spread: PLANT_STATS.peaShooter.spread,
        cooldownMs: PLANT_STATS.peaShooter.cooldownMs,
        damage: PLANT_STATS.peaShooter.damage,
      }),
    }),
    doublePeaShooter: Object.freeze({
      label: '双发射手',
      uri: '/assets/models/double-pea-shooter-lux3d-v1.glb',
      targetHeight: 0.92,
      yaw: Math.PI,
      status: 'ready',
      attack: Object.freeze({ style: 'direct', projectileId: 'pea', speed: BEACH_DEFENSE_CONFIG.projectile.speed, gravity: 0, hitRadius: BEACH_DEFENSE_CONFIG.projectile.hitRadius, projectileCount: PLANT_STATS.doublePeaShooter.projectileCount, spread: PLANT_STATS.doublePeaShooter.spread, cooldownMs: PLANT_STATS.doublePeaShooter.cooldownMs, damage: PLANT_STATS.doublePeaShooter.damage }),
    }),
    gatlingPeaShooter: Object.freeze({
      label: '机枪射手',
      uri: '/assets/models/gatling-pea-shooter-lux3d-v1.glb',
      targetHeight: 1.02,
      yaw: Math.PI,
      status: 'ready',
      attack: Object.freeze({ style: 'direct', projectileId: 'pea', speed: BEACH_DEFENSE_CONFIG.projectile.speed, gravity: 0, hitRadius: BEACH_DEFENSE_CONFIG.projectile.hitRadius, projectileCount: PLANT_STATS.gatlingPeaShooter.projectileCount, spread: PLANT_STATS.gatlingPeaShooter.spread, cooldownMs: PLANT_STATS.gatlingPeaShooter.cooldownMs, damage: PLANT_STATS.gatlingPeaShooter.damage }),
    }),
    cornPult: Object.freeze({
      label: '玉米投手',
      uri: '/assets/models/corn-pult-lux3d-v1.glb',
      targetHeight: 0.94,
      yaw: Math.PI,
      status: 'ready',
      attack: Object.freeze({
        style: 'lob',
        projectileId: 'butter',
        // 让抛射弹在最远潮沟也能落到目标高度；旧值只够飞约 10m，常在僵尸前提前落水。
        horizontalSpeed: 14.4,
        minimumHorizontalSpeed: 5.2,
        upwardSpeed: 6.9,
        minimumUpwardSpeed: 2.6,
        chargeDurationMs: 980,
        minimumDamageMultiplier: 0.58,
        maximumDamageMultiplier: 1.55,
        aimLift: 1,
        gravity: 10.4,
        lifetime: 2.35,
        hitRadius: 1.18,
        projectileCount: 1,
        spread: 0,
        cooldownMs: 780,
        // 三维手瞄抛物线的命中成本高于直线豌豆；两发击退普通冲浪僵尸，一发击退小鬼。
        damage: 52,
      }),
    }),
    watermelonPult: Object.freeze({
      label: '西瓜投手',
      uri: '/assets/models/watermelon-pult-lux3d-v1.glb',
      targetHeight: 1.04,
      yaw: Math.PI,
      status: 'ready',
      attack: Object.freeze({
        style: 'lob',
        projectileId: 'watermelon',
        horizontalSpeed: PLANT_STATS.watermelonPult.horizontalSpeed,
        minimumHorizontalSpeed: 4.8,
        upwardSpeed: PLANT_STATS.watermelonPult.upwardSpeed,
        minimumUpwardSpeed: 2.45,
        chargeDurationMs: 1_100,
        minimumDamageMultiplier: 0.62,
        maximumDamageMultiplier: 1.45,
        aimLift: 1,
        gravity: PLANT_STATS.watermelonPult.gravity,
        lifetime: PLANT_STATS.watermelonPult.lifetime,
        hitRadius: 0.92,
        splashRadius: PLANT_STATS.watermelonPult.splashRadius,
        splashDamage: PLANT_STATS.watermelonPult.splashDamage,
        projectileCount: 1,
        spread: 0,
        cooldownMs: PLANT_STATS.watermelonPult.cooldownMs,
        damage: PLANT_STATS.watermelonPult.damage,
      }),
    }),
  }),
  enemies: Object.freeze({
    surferZombie: Object.freeze({
      label: ZOMBIE_STATS.surferZombie.label,
      uri: '/assets/models/tide-rider-temporary.glb',
      targetHeight: ZOMBIE_STATS.surferZombie.targetHeight,
      yaw: 0,
      status: 'ready',
    }),
    giantZombie: Object.freeze({ label: ZOMBIE_STATS.giantZombie.label, uri: '/assets/models/giant-surfer-zombie-lux3d-v1.glb', targetHeight: ZOMBIE_STATS.giantZombie.targetHeight, yaw: 0, status: 'ready' }),
    impZombie: Object.freeze({ label: ZOMBIE_STATS.impZombie.label, uri: '/assets/models/imp-surfer-zombie-lux3d-v1.glb', targetHeight: ZOMBIE_STATS.impZombie.targetHeight, yaw: 0, status: 'ready' }),
  }),
});

// 不承担碰撞或行走限制：实际可活动范围始终以 scene-config.js 的玩家边界为准。
// 这些 Lux3D 模型只负责把“边界”做得可信，不影响僵尸三条潮沟的通行路线。
const ENVIRONMENT_MODEL_CATALOG = Object.freeze({
  fence: Object.freeze({
    label: '海滩围栏',
    uri: '/assets/environment/beach-fence-lux3d-v1.glb',
    targetAxis: 'x',
    // 单段短围栏连续轻微交叠，替代旧的程序化长木栏杆。
    targetSize: 2.7,
    placements: Object.freeze([
      Object.freeze({ position: [-5.25, 0, -5.17], yaw: 0 }),
      Object.freeze({ position: [-2.63, 0, -5.17], yaw: 0 }),
      Object.freeze({ position: [2.63, 0, -5.17], yaw: 0 }),
      Object.freeze({ position: [5.25, 0, -5.17], yaw: 0 }),
    ]),
  }),
  cornCannon: Object.freeze({
    label: '玉米加农炮',
    uri: '/assets/models/corn-cannon-lux3d-v1.glb',
    targetAxis: 'max',
    // 替换中间短围栏。模型仅右侧带眼睛，绕 Y 轴转 90° 后正好让带眼睛的一侧朝向玩家。
    // 加农炮是可接近的设施，不是玩家武器；缩小到不会吞掉第一人称中央视野的尺度。
    targetSize: 1.58,
    placements: Object.freeze([
      Object.freeze({ position: [0, 0, -5.16], yaw: Math.PI / 2 }),
    ]),
  }),
  rearRock: Object.freeze({
    label: '后方岩石',
    uri: '/assets/environment/rear-rock-lux3d-v1.glb',
    targetAxis: 'max',
    // 后方与侧边的高岩承担真正的视觉封边：它们放在可移动范围外，并连续重叠。
    targetSize: 4.4,
    placements: Object.freeze([
      // 后墙：相邻岩体刻意重叠，避免视角贴近边界时从缝隙看到空域。
      Object.freeze({ position: [-9.0, 0, -11.15], yaw: 0.28, scale: 0.92 }),
      Object.freeze({ position: [-6.0, 0, -11.2], yaw: -0.16, scale: 1.04 }),
      Object.freeze({ position: [-3.0, 0, -11.12], yaw: 0.24, scale: 0.98 }),
      Object.freeze({ position: [0, 0, -11.24], yaw: -0.14, scale: 1.1 }),
      Object.freeze({ position: [3.0, 0, -11.15], yaw: 0.18, scale: 0.99 }),
      Object.freeze({ position: [6.0, 0, -11.2], yaw: -0.28, scale: 1.05 }),
      Object.freeze({ position: [9.0, 0, -11.14], yaw: -0.36, scale: 0.94 }),
      // 左右岩壁：从玩家身后一直延展至敌方潮沟尾端，始终保持在活动区之外。
      Object.freeze({ position: [-8.6, 0, -8.3], yaw: 0.68, scale: 0.9 }),
      Object.freeze({ position: [-8.65, 0, -4.3], yaw: 0.36, scale: 1.02 }),
      Object.freeze({ position: [-8.7, 0, -0.3], yaw: 0.64, scale: 0.92 }),
      Object.freeze({ position: [-8.65, 0, 3.7], yaw: 0.28, scale: 1.02 }),
      Object.freeze({ position: [-8.7, 0, 7.7], yaw: 0.62, scale: 0.94 }),
      Object.freeze({ position: [-8.65, 0, 11.5], yaw: 0.38, scale: 1.02 }),
      // 补缝岩略向场内错位，填掉侧岩体轮廓较窄时露出的蓝色空隙。
      Object.freeze({ position: [-8.18, 0, -6.3], yaw: -0.18, scale: 0.92 }),
      Object.freeze({ position: [-8.2, 0, -2.3], yaw: 0.52, scale: 0.86 }),
      Object.freeze({ position: [-8.16, 0, 1.7], yaw: -0.26, scale: 0.94 }),
      Object.freeze({ position: [-8.22, 0, 5.7], yaw: 0.44, scale: 0.88 }),
      Object.freeze({ position: [-8.18, 0, 9.6], yaw: -0.32, scale: 0.92 }),
      Object.freeze({ position: [8.6, 0, -8.3], yaw: -0.68, scale: 0.9 }),
      Object.freeze({ position: [8.65, 0, -4.3], yaw: -0.36, scale: 1.02 }),
      Object.freeze({ position: [8.7, 0, -0.3], yaw: -0.64, scale: 0.92 }),
      Object.freeze({ position: [8.65, 0, 3.7], yaw: -0.28, scale: 1.02 }),
      Object.freeze({ position: [8.7, 0, 7.7], yaw: -0.62, scale: 0.94 }),
      Object.freeze({ position: [8.65, 0, 11.5], yaw: -0.38, scale: 1.02 }),
      Object.freeze({ position: [8.18, 0, -6.3], yaw: 0.18, scale: 0.92 }),
      Object.freeze({ position: [8.2, 0, -2.3], yaw: -0.52, scale: 0.86 }),
      Object.freeze({ position: [8.16, 0, 1.7], yaw: 0.26, scale: 0.94 }),
      Object.freeze({ position: [8.22, 0, 5.7], yaw: -0.44, scale: 0.88 }),
      Object.freeze({ position: [8.18, 0, 9.6], yaw: 0.32, scale: 0.92 }),
    ]),
  }),
});

const CORN_CANNON_POSITION = Object.freeze(new THREE.Vector3(0, 0, -5.16));
// 出生点距离炮位约 1.84m；半径必须小于它，才能形成真正“走近才提示”的交互。
const CORN_CANNON_INTERACTION_RADIUS = 1.25;

const gameStateClient = createGameStateClient();
let gameState = null;
let activeWeaponId = null;
let activeWeaponModel = null;

const WEAPON_POSES = Object.freeze({
  combat: Object.freeze({
    position: new THREE.Vector3(0.52, -0.5, -0.96),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, -0.18, 0.08)),
    scale: new THREE.Vector3(1, 1, 1),
  }),
  inspect: Object.freeze({
    position: new THREE.Vector3(0, -0.12, -1.3),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.02, 0.18, 0)),
    scale: new THREE.Vector3(1.52, 1.52, 1.52),
  }),
});

const app = document.querySelector('#battle-app');
const canvas = document.querySelector('#battle-canvas');
const startPanel = document.querySelector('#start-panel');
const pausedPanel = document.querySelector('#paused-panel');
const startButton = document.querySelector('#start-button');
const resumeButton = document.querySelector('#resume-button');
const healthValue = document.querySelector('#health-value');
const healthBar = document.querySelector('#health-bar');
const enemyState = document.querySelector('#enemy-state');
const enemyCopy = document.querySelector('#enemy-copy');
const levelState = document.querySelector('#level-state');
const waveState = document.querySelector('#wave-state');
const enemiesRemaining = document.querySelector('#enemies-remaining');
const startTitle = document.querySelector('#start-title');
const startCopy = startPanel.querySelector('p');
const assetStatus = document.querySelector('.asset-status');
const assetStatusText = document.querySelector('#asset-status-text');
const inventoryToggle = document.querySelector('#inventory-toggle');
const inventoryPanel = document.querySelector('#battle-inventory');
const inventoryClose = document.querySelector('#inventory-close');
const inventorySummary = document.querySelector('#inventory-summary');
const inventoryItems = document.querySelector('#inventory-items');
const levelSelectToggle = document.querySelector('#level-select-toggle');
const levelSelect = document.querySelector('#level-select');
const levelSelectClose = document.querySelector('#level-select-close');
const levelSelectSummary = document.querySelector('#level-select-summary');
const levelSelectItems = document.querySelector('#level-select-items');
const waveAcceleratorToggle = document.querySelector('#wave-accelerator-toggle');
const cornCannonPrompt = document.querySelector('#corn-cannon-prompt');
const cornCannonPromptTitle = cornCannonPrompt?.querySelector('strong') ?? null;
const cornCannonPromptDetail = cornCannonPrompt?.querySelector('small') ?? null;
const lobChargeMeter = document.querySelector('#lob-charge-meter');
const lobChargeLabel = lobChargeMeter?.querySelector('[data-lob-charge-label]') ?? null;
const lobChargeFill = lobChargeMeter?.querySelector('[data-lob-charge-fill]') ?? null;
const lobChargeDetail = lobChargeMeter?.querySelector('[data-lob-charge-detail]') ?? null;
const worldMapToggle = document.querySelector('#world-map-toggle');
const worldMap = document.querySelector('#world-map');
const worldMapClose = document.querySelector('#world-map-close');
const sceneMusic = document.querySelector('#scene-music');
const musicToggle = document.querySelector('#music-toggle');
const daveOnboarding = document.querySelector('#dave-onboarding');
const daveOnboardingClose = document.querySelector('#dave-onboarding-close');
const APP_ROUTES = Object.freeze({
  panorama: resolveMySpaceAppRoute('panorama', { override: import.meta.env.VITE_MYSPACE_PANORAMA_URL }),
  garden: resolveMySpaceAppRoute('garden', { override: import.meta.env.VITE_MYSPACE_GARDEN_URL }),
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8acde0');
scene.fog = new THREE.Fog('#a9dbe0', 15, 37);

// 天空穹顶半径为 128m；远裁剪面必须超过它，否则会把穹顶截成显眼的“圆形空气墙”。
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 220);
camera.position.set(
  BEACH_DEFENSE_CONFIG.player.start.x,
  BEACH_DEFENSE_CONFIG.player.eyeHeight,
  BEACH_DEFENSE_CONFIG.player.start.z,
);
// Three.js 相机默认看向 -Z，而潮沟和僵尸生成点位在玩家的 +Z 正前方。
// 明确朝向海面，避免旧的后景删除后开场误对着背后空域。
camera.lookAt(0, BEACH_DEFENSE_CONFIG.player.eyeHeight, BEACH_DEFENSE_CONFIG.field.defenseLineZ + 7.2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;

const controls = new PointerLockControls(camera, document.body);
const timer = new THREE.Timer();
timer.connect(document);
const keys = new Set();
const projectiles = [];
const watermelonImpacts = [];
let playerHealth = DEFENSE_RULES.maxIntegrity;
let weapon;
let isDefeated = false;
let isInspectingWeapon = false;
let inspectManualYaw = 0;
let inspectManualPitch = 0;
let isInspectRightDrag = false;
let isInventoryOpen = false;
let battleSettled = false;
let lastShotAt = 0;
let isLobCharging = false;
let lobChargeStartedAt = 0;
let pendingLobShotTimer = null;
let currentLevelIndex = 0;
let advanceLevelOnReset = false;
let levelProgress = loadLevelProgress();
let activeWaveIndex = -1;
let pendingSpawns = [];
let nextSpawnAt = 0;
let nextWaveAt = 0;
let battleStarted = false;
let isWaveAccelerationEnabled = false;
let cornCannonUsed = false;
let cornCannonFiring = false;
let cornCannonPulseUntil = 0;
let cornCannonPromptSignature = 'hidden';
const cornMissiles = [];
let cornMissilePrototype = null;
let cornMissilePrototypePromise = null;
let isBattleMusicEnabled = true;
const enemies = [];
const enemyPrototypeCache = new Map();
const enemyPrototypePromises = new Map();
const enemyLoadFailures = new Set();
const environmentPrototypeCache = new Map();
const environmentPrototypePromises = new Map();
const environmentModelRoot = new THREE.Group();
environmentModelRoot.name = 'lux3d-environment-boundaries';
let nextEnemyId = 1;
const assetLoadState = {
  weapon: 'waiting',
  enemy: 'waiting',
};

const MAX_SAFE_POINTER_DELTA = 180;

function loadLevelProgress() {
  try {
    return restoreLevelProgress(JSON.parse(localStorage.getItem(LEVEL_PROGRESS_STORAGE_KEY)), TIDE_LEVELS);
  } catch {
    return createInitialLevelProgress(TIDE_LEVELS);
  }
}

function saveLevelProgress() {
  localStorage.setItem(LEVEL_PROGRESS_STORAGE_KEY, JSON.stringify(levelProgress));
}

scene.add(new THREE.HemisphereLight('#e8fcff', '#3f7655', 2.1));
const sun = new THREE.DirectionalLight('#fff1bd', 3.2);
sun.position.set(-8, 14, -5);
scene.add(sun);
const battleEnvironment = createBattleEnvironment({ scene, camera });

const cornCannonPulse = new THREE.Mesh(
  new THREE.RingGeometry(0.45, 0.62, 64),
  new THREE.MeshBasicMaterial({ color: '#fff1a1', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
cornCannonPulse.rotation.x = -Math.PI / 2;
// 与中间围栏位的加农炮模型对齐；开炮后会移动到潮沟落点作为爆炸光圈。
cornCannonPulse.position.set(CORN_CANNON_POSITION.x, 0.045, CORN_CANNON_POSITION.z);
cornCannonPulse.visible = false;
scene.add(cornCannonPulse);

// 玉米投手的轨迹预览完全复用真实开火的初速度、重力与寿命：线走到哪里，弹体就会落到哪里。
const CORN_AIM_GUIDE_STEPS = 30;
const cornAimGuidePositions = new Float32Array((CORN_AIM_GUIDE_STEPS + 1) * 3);
const cornAimGuideGeometry = new THREE.BufferGeometry();
const cornAimGuideAttribute = new THREE.BufferAttribute(cornAimGuidePositions, 3);
cornAimGuideAttribute.setUsage(THREE.DynamicDrawUsage);
cornAimGuideGeometry.setAttribute('position', cornAimGuideAttribute);
cornAimGuideGeometry.setDrawRange(0, 0);
const cornAimGuide = new THREE.Line(
  cornAimGuideGeometry,
  new THREE.LineDashedMaterial({ color: '#ffe98b', transparent: true, opacity: 0.78, dashSize: 0.18, gapSize: 0.16, depthTest: false, depthWrite: false }),
);
cornAimGuide.name = 'corn-pult-trajectory-guide';
cornAimGuide.frustumCulled = false;
cornAimGuide.renderOrder = 7;
cornAimGuide.visible = false;
scene.add(cornAimGuide);

const cornAimMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.23, 24),
  new THREE.MeshBasicMaterial({ color: '#ffe98b', transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
);
cornAimMarker.name = 'corn-pult-trajectory-impact-marker';
cornAimMarker.rotation.x = -Math.PI / 2;
cornAimMarker.renderOrder = 7;
cornAimMarker.visible = false;
scene.add(cornAimMarker);

function createSandTexture() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 160;
  textureCanvas.height = 160;
  const context = textureCanvas.getContext('2d');
  context.fillStyle = '#d6ad68';
  context.fillRect(0, 0, 160, 160);
  for (let index = 0; index < 920; index += 1) {
    const alpha = 0.08 + ((index * 37) % 11) * 0.012;
    context.fillStyle = index % 3 === 0 ? `rgba(104, 69, 31, ${alpha})` : `rgba(255, 238, 177, ${alpha})`;
    const x = (index * 73) % 160;
    const y = (index * 43) % 160;
    const size = 0.6 + ((index * 19) % 3) * 0.34;
    context.fillRect(x, y, size, size);
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 15);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createPlane(width, height, material, x, z, y = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function addRearSandBackdrop(material) {
  const { field } = BEACH_DEFENSE_CONFIG;
  // 原始沙地只覆盖玩家 2:8 分区的近端；后方岩墙落在它之外时会悬空。
  // 单独向后延展同一张沙地贴图，既承接玩家脚下，也给后方岩石提供落地面。
  const rearDepth = 21;
  const backdrop = createPlane(42, rearDepth, material, 0, field.minZ - rearDepth / 2, -0.006);
  backdrop.name = 'rear-sand-backdrop';
  return backdrop;
}

function addSideSandBackdrops(material) {
  const { field } = BEACH_DEFENSE_CONFIG;
  // 两侧高岩位于原始 12m 沙地之外。给它们铺一层更宽的沙质基座，
  // 只覆盖玩家后方的沙滩带；透明水材质无法可靠遮住下层网格，
  // 所以绝不能把沙地延伸到潮沟，避免海面出现悬浮沙块。
  const sideWidth = 16;
  const overlap = 2;
  const sideDepth = field.defenseLineZ - field.minZ;
  const centerZ = field.minZ + sideDepth / 2;
  const centerOffset = field.width / 2 + sideWidth / 2 - overlap;

  for (const side of [-1, 1]) {
    const backdrop = createPlane(sideWidth, sideDepth, material, side * centerOffset, centerZ, -0.006);
    backdrop.name = side < 0 ? 'left-sand-backdrop' : 'right-sand-backdrop';
  }
}

function addLanes() {
  const { enemy, field } = BEACH_DEFENSE_CONFIG;
  const laneMaterial = new THREE.LineDashedMaterial({ color: '#d9f3bd', dashSize: 0.32, gapSize: 0.24, transparent: true, opacity: 0.36 });
  for (const x of enemy.lanes) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.03, field.defenseLineZ + 0.18),
      new THREE.Vector3(x, 0.03, field.waterEndZ - 0.35),
    ]);
    const lane = new THREE.Line(geometry, laneMaterial);
    lane.computeLineDistances();
    scene.add(lane);
  }
}

function prepareEnvironmentModel(model, definition) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const referenceSize = definition.targetAxis === 'x'
    ? size.x
    : Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(referenceSize) || referenceSize < 0.0001) {
    throw new Error(`${definition.label}没有可用的模型尺寸`);
  }
  model.scale.multiplyScalar(definition.targetSize / referenceSize);
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  // 每个实例以“脚底/沙地接触面”为原点，再由布置表决定它在海滩中的真实位置。
  model.position.set(-center.x, -normalizedBounds.min.y, -center.z);
  model.updateMatrixWorld(true);
  return model;
}

async function loadEnvironmentPrototype(assetId) {
  if (environmentPrototypeCache.has(assetId)) return environmentPrototypeCache.get(assetId);
  if (environmentPrototypePromises.has(assetId)) return environmentPrototypePromises.get(assetId);
  const definition = ENVIRONMENT_MODEL_CATALOG[assetId];
  const pending = (async () => {
    const gltf = await new GLTFLoader().loadAsync(definition.uri);
    const importedModel = gltf.scene ?? gltf.scenes[0];
    if (!importedModel) throw new Error(`${definition.label} GLB 中没有可加载的场景`);
    const normalized = prepareEnvironmentModel(importedModel, definition);
    environmentPrototypeCache.set(assetId, normalized);
    return normalized;
  })().finally(() => environmentPrototypePromises.delete(assetId));
  environmentPrototypePromises.set(assetId, pending);
  return pending;
}

async function hydrateEnvironmentModel(assetId) {
  const definition = ENVIRONMENT_MODEL_CATALOG[assetId];
  try {
    const prototype = await loadEnvironmentPrototype(assetId);
    const group = new THREE.Group();
    group.name = `lux3d-${assetId}`;
    definition.placements.forEach((placement) => {
      // 原型自身已经在局部坐标中完成居中和贴地；用外层实例承载世界坐标，不能覆盖它的局部校准。
      const instance = new THREE.Group();
      const visual = prototype.clone(true);
      instance.add(visual);
      instance.position.set(...placement.position);
      instance.rotation.y = placement.yaw ?? 0;
      instance.scale.multiplyScalar(placement.scale ?? 1);
      group.add(instance);
    });
    environmentModelRoot.add(group);
  } catch (error) {
    // 旧的低模边界仍在场，因此单个环境资产失败不会破坏战斗或制造不可走的死角。
    console.warn(`未能加载 Lux3D ${definition.label}，保留既有低模环境。`, error);
  }
}

function hydrateEnvironmentModels() {
  scene.add(environmentModelRoot);
  return Promise.all(Object.keys(ENVIRONMENT_MODEL_CATALOG).map(hydrateEnvironmentModel));
}

function createCornMissilePlaceholder() {
  const group = new THREE.Group();
  const kernel = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16, 0.52, 6, 14),
    new THREE.MeshStandardMaterial({ color: '#ffd85a', emissive: '#8c5113', emissiveIntensity: 0.52, roughness: 0.45 }),
  );
  kernel.rotation.x = Math.PI / 2;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    new THREE.MeshBasicMaterial({ color: '#fff3a8', transparent: true, opacity: 0.86 }),
  );
  glow.position.z = 0.32;
  group.add(kernel, glow);
  return group;
}

function prepareCornMissileModel(model) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const referenceSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(referenceSize) || referenceSize < 0.0001) throw new Error('玉米导弹没有可用的模型尺寸');
  model.scale.multiplyScalar(0.78 / referenceSize);
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -center.y, -center.z);
  model.updateMatrixWorld(true);
  return model;
}

async function loadCornMissilePrototype() {
  if (cornMissilePrototype) return cornMissilePrototype;
  if (cornMissilePrototypePromise) return cornMissilePrototypePromise;
  cornMissilePrototypePromise = new GLTFLoader().loadAsync('/assets/models/corn-missile-lux3d-v1.glb')
    .then((gltf) => {
      const model = gltf.scene ?? gltf.scenes[0];
      if (!model) throw new Error('玉米导弹 GLB 中没有可加载的场景');
      cornMissilePrototype = prepareCornMissileModel(model);
      return cornMissilePrototype;
    })
    .catch((error) => {
      console.warn('玉米导弹模型加载失败，暂时使用低模弹体。', error);
      return null;
    })
    .finally(() => { cornMissilePrototypePromise = null; });
  return cornMissilePrototypePromise;
}

function clearCornMissiles() {
  for (const missile of cornMissiles) scene.remove(missile.root);
  cornMissiles.length = 0;
}

function launchCornMissile() {
  const root = new THREE.Group();
  root.name = 'corn-cannon-missile';
  // 场景中的炮体缩小后，导弹也从新的炮口高度起飞。
  const start = new THREE.Vector3(CORN_CANNON_POSITION.x, 0.86, CORN_CANNON_POSITION.z);
  const target = new THREE.Vector3(0, 0.08, BEACH_DEFENSE_CONFIG.field.defenseLineZ + 8.2);
  const flightSeconds = 1.12;
  const gravity = 18.5;
  const velocity = target.clone().sub(start).multiplyScalar(1 / flightSeconds);
  velocity.y = (target.y - start.y + (0.5 * gravity * flightSeconds * flightSeconds)) / flightSeconds;
  root.position.copy(start);
  root.add(createCornMissilePlaceholder());
  scene.add(root);
  const missile = { root, visual: root.children[0], velocity, gravity, target, elapsed: 0 };
  cornMissiles.push(missile);
  void loadCornMissilePrototype().then((prototype) => {
    if (!prototype || !cornMissiles.includes(missile)) return;
    root.remove(missile.visual);
    missile.visual = prototype.clone(true);
    root.add(missile.visual);
  });
}

function resolveCornCannonImpact(missile) {
  scene.remove(missile.root);
  const index = cornMissiles.indexOf(missile);
  if (index >= 0) cornMissiles.splice(index, 1);
  clearEnemies();
  clearProjectiles();
  cornCannonPulse.position.set(missile.target.x, 0.045, missile.target.z);
  cornCannonPulseUntil = performance.now() + 620;
  cornCannonPulse.visible = true;
  cornCannonPulse.scale.setScalar(1);
  enemyState.textContent = '玉米加农炮清场';
  enemyCopy.textContent = `第 ${activeWaveIndex + 1} 波潮沟已清空。`;
  cornCannonFiring = false;
  updateBattleHud();
  updateCornCannonUi();
}

function updateCornMissiles(delta) {
  for (const missile of [...cornMissiles]) {
    missile.elapsed += delta;
    missile.velocity.y -= missile.gravity * delta;
    missile.root.position.addScaledVector(missile.velocity, delta);
    missile.root.rotation.x += delta * 7.6;
    missile.root.rotation.z += delta * 3.2;
    if (missile.elapsed >= 1.12 || missile.root.position.y <= 0.08) resolveCornCannonImpact(missile);
  }
}

function addSea() {
  const { field } = BEACH_DEFENSE_CONFIG;
  // 战斗逻辑仍只使用 16m 潮沟；渲染海面向远方和两翼延展，以有限活动区营造开阔海域。
  const waterDepth = field.waterEndZ - field.defenseLineZ;
  const horizonExtension = 156;
  const visualWaterWidth = 156;
  const totalVisualDepth = waterDepth + horizonExtension;
  const tideMaterial = createTideMaterial({
    tileScale: new THREE.Vector2(
      visualWaterWidth * (4.4 / (field.width + 10)),
      totalVisualDepth * (3.2 / (waterDepth + 18)),
    ),
  });
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(visualWaterWidth, totalVisualDepth, 112, 144),
    tideMaterial,
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.02, field.defenseLineZ + totalVisualDepth / 2);
  scene.add(ocean);

  const shoreFoam = createPlane(
    field.width + 1,
    0.65,
    new THREE.MeshBasicMaterial({ color: '#d9f8ee', transparent: true, opacity: 0.42, depthWrite: false }),
    0,
    field.defenseLineZ + 0.08,
    0.04,
  );
  shoreFoam.renderOrder = 2;
  return tideMaterial;
}

function updateAssetStatus() {
  const states = Object.values(assetLoadState);
  const hasFallback = states.includes('fallback');
  const isReady = states.every((state) => state === 'ready');
  assetStatus.dataset.state = hasFallback ? 'fallback' : (isReady ? 'ready' : 'loading');
  if (!activeWeaponModel) {
    assetStatusText.textContent = '按 Tab 打开背包，选择已收获的植物';
  } else if (isReady) {
    assetStatusText.textContent = `${activeWeaponModel.label}与三类潮沟敌人模型已接入`;
  } else if (hasFallback) {
    assetStatusText.textContent = '部分 Lux3D 模型加载失败 · 正使用程序占位体';
  } else {
    assetStatusText.textContent = `正在加载 ${activeWeaponModel.label} 与潮沟敌人模型`;
  }
}

function renderInventory() {
  if (!gameState) {
    inventorySummary.textContent = '正在连接共享背包…';
    inventoryItems.replaceChildren();
    return;
  }
  const equippedLabel = activeWeaponId ? GAME_WEAPONS[activeWeaponId].label : '未装备';
  inventorySummary.textContent = `阳光 ${gameState.sun} · 当前装备：${equippedLabel} · 胜场 ${gameState.battle.victories}`;
  const plantItems = Object.entries(GAME_WEAPONS).map(([weaponId, definition]) => {
    const count = gameState.inventory.plants[weaponId] ?? 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `inventory-weapon${weaponId === activeWeaponId ? ' is-equipped' : ''}`;
    button.disabled = count === 0;
    button.innerHTML = `<span>★${definition.tier}</span><strong>${definition.label}</strong><em>×${count}</em><small>${weaponId === activeWeaponId ? '已装备' : count ? '装备' : '未拥有'}</small>`;
    button.addEventListener('click', () => equipFromInventory(weaponId));
    return button;
  });
  const cannonCount = gameState.inventory.consumables?.cornCannon ?? 0;
  const cannon = document.createElement('div');
  cannon.className = 'inventory-weapon inventory-weapon--consumable';
  cannon.innerHTML = `<span>一次性</span><strong>玉米导弹</strong><em>×${cannonCount}</em><small>9 个玉米投手合成；靠近海岸加农炮后按 E 装填，清空当前波次。</small>`;
  inventoryItems.replaceChildren(...plantItems, cannon);
  updateCornCannonUi();
}

function getCornCannonCount() {
  return gameState?.inventory?.consumables?.cornCannon ?? 0;
}

function isNearCornCannon() {
  const dx = camera.position.x - CORN_CANNON_POSITION.x;
  const dz = camera.position.z - CORN_CANNON_POSITION.z;
  return (dx * dx) + (dz * dz) <= CORN_CANNON_INTERACTION_RADIUS * CORN_CANNON_INTERACTION_RADIUS;
}

function updateCornCannonUi() {
  if (!cornCannonPrompt || !cornCannonPromptTitle || !cornCannonPromptDetail) return;
  const shouldShow = controls.isLocked && isNearCornCannon();
  if (!shouldShow) {
    if (cornCannonPromptSignature !== 'hidden') {
      cornCannonPrompt.hidden = true;
      cornCannonPromptSignature = 'hidden';
    }
    return;
  }

  const count = getCornCannonCount();
  let state = 'unavailable';
  let title = '';
  let detail = '';
  if (cornCannonUsed) {
    title = '玉米加农炮 · 本局已完成清场';
    detail = '每局仅可发射一次。';
  } else if (!count) {
    title = '玉米加农炮 · 缺少玉米导弹';
    detail = '前往合成台：9 个玉米投手可合成 1 枚玉米导弹。';
  } else if (!battleStarted || isDefeated || activeWaveIndex < 0 || (!enemies.length && !pendingSpawns.length)) {
    title = `玉米加农炮 · 玉米导弹 ×${count}`;
    detail = '等待敌人波次推进后再装填。';
  } else {
    state = 'ready';
    title = `玉米加农炮 · 玉米导弹 ×${count}`;
    detail = '按 E 装填并发射 · 清空当前波次的全部敌人。';
  }

  const signature = `${state}|${title}|${detail}`;
  if (signature === cornCannonPromptSignature) return;
  cornCannonPrompt.hidden = false;
  cornCannonPrompt.dataset.state = state;
  cornCannonPromptTitle.textContent = title;
  cornCannonPromptDetail.textContent = detail;
  cornCannonPromptSignature = signature;
}

function setInventoryOpen(open) {
  isInventoryOpen = Boolean(open);
  inventoryPanel.hidden = !isInventoryOpen;
  inventoryToggle.setAttribute('aria-expanded', String(isInventoryOpen));
  if (isInventoryOpen) renderInventory();
}

function updateBattleMusicToggle() {
  if (!musicToggle) return;
  musicToggle.textContent = `音乐：${isBattleMusicEnabled ? '暂停' : '播放'} · P`;
  musicToggle.setAttribute('aria-pressed', String(isBattleMusicEnabled));
}

async function resumeBattleMusic() {
  if (!isBattleMusicEnabled || !sceneMusic) return;
  sceneMusic.volume = 0.3;
  try {
    await sceneMusic.play();
  } catch {
    // 首次自动播放会被浏览器拦截，后续用户手势仍会再试一次。
  }
  updateBattleMusicToggle();
}

function toggleBattleMusic() {
  isBattleMusicEnabled = !isBattleMusicEnabled;
  if (!isBattleMusicEnabled) sceneMusic?.pause();
  else void resumeBattleMusic();
  updateBattleMusicToggle();
}

function setWorldMapOpen(open) {
  const nextOpen = Boolean(open);
  if (nextOpen && controls.isLocked) controls.unlock();
  worldMap.hidden = !nextOpen;
  worldMapToggle.setAttribute('aria-expanded', String(nextOpen));
}

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function setBattleOnboardingOpen(open) {
  if (!daveOnboarding) return;
  daveOnboarding.hidden = !open;
  if (open) window.requestAnimationFrame(() => daveOnboardingClose?.focus());
}

function showBattleOnboarding() {
  if (!daveOnboarding || !consumeFirstVisit(getBrowserStorage(), 'tide-defense-001')) return;
  setBattleOnboardingOpen(true);
}

function goToMapDestination(destination) {
  const targets = {
    'grave-gate': `${APP_ROUTES.panorama}?scene=grave-gate-001`,
    shop: `${APP_ROUTES.panorama}?scene=garden-supply-shop-001`,
    garden: APP_ROUTES.garden,
  };
  const target = targets[destination];
  if (target) window.location.assign(target);
}

async function refreshGameState({ announceFailure = false } = {}) {
  try {
    gameState = await gameStateClient.getState();
    const nextWeaponId = gameState.loadout.equippedWeaponId;
    if (nextWeaponId && nextWeaponId !== activeWeaponId) await applyWeaponSelection(nextWeaponId);
    renderInventory();
    // 之前每次按 Tab 打开背包都会无条件 resetDefense()：波次队列被清空，
    // 但用户点击“继续守住防线”后开始面板已隐藏，于是出现“准备第 1 波、0 敌人”
    // 的假运行状态。战斗进行中只刷新背包，不触碰波次状态机。
    if (!battleStarted && !isDefeated) resetDefense();
    updateCornCannonUi();
  } catch (error) {
    if (announceFailure) assetStatusText.textContent = `共享背包不可用：${error.message}`;
  }
}

function createWeaponPlaceholderVisual() {
  const visual = new THREE.Group();
  const stemMaterial = new THREE.MeshStandardMaterial({ color: '#287f49', roughness: 0.78 });
  const podMaterial = new THREE.MeshStandardMaterial({ color: '#67d14c', roughness: 0.58, emissive: '#103d18', emissiveIntensity: 0.16 });
  const muzzleMaterial = new THREE.MeshStandardMaterial({ color: '#c8f16b', roughness: 0.45, emissive: '#4a8d33', emissiveIntensity: 0.36 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.82, 10), stemMaterial);
  stem.rotation.z = -0.74;
  stem.position.set(0.08, -0.24, -0.13);
  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), podMaterial);
  pod.scale.set(1.25, 0.84, 1.08);
  pod.position.set(0.38, -0.08, -0.51);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.34, 16), muzzleMaterial);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0.41, -0.08, -0.82);
  visual.add(stem, pod, muzzle);
  return visual;
}

function createWeaponPlaceholder() {
  const weapon = new THREE.Group();
  const visual = createWeaponPlaceholderVisual();
  weapon.add(visual);
  weapon.userData.visual = visual;
  weapon.position.copy(WEAPON_POSES.combat.position);
  weapon.quaternion.copy(WEAPON_POSES.combat.quaternion);
  camera.add(weapon);
  scene.add(camera);
  return weapon;
}

function showWeaponPlaceholder() {
  const oldVisual = weapon.userData.visual;
  if (oldVisual) weapon.remove(oldVisual);
  const visual = createWeaponPlaceholderVisual();
  weapon.add(visual);
  weapon.userData.visual = visual;
  weapon.userData.usingPlaceholder = true;
}

function createEnemyPlaceholderVisual(type) {
  const group = new THREE.Group();
  const palette = type === 'giantZombie'
    ? { board: '#9e4f3f', skin: '#b4675f', cloth: '#893a35' }
    : type === 'impZombie'
      ? { board: '#2b9db2', skin: '#8dc983', cloth: '#527f9a' }
      : { board: '#e2834f', skin: '#9ab877', cloth: '#4e6478' };
  const boardMaterial = new THREE.MeshStandardMaterial({ color: palette.board, roughness: 0.6, emissive: '#1d5c62', emissiveIntensity: 0.08 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.9 });
  const clothMaterial = new THREE.MeshStandardMaterial({ color: palette.cloth, roughness: 0.86 });
  const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.16, 6, 14), boardMaterial);
  board.rotation.z = Math.PI / 2;
  board.position.y = 0.18;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.76, 5, 10), clothMaterial);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 12), skinMaterial);
  head.position.y = 1.66;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: '#e7ff9b' }));
  eye.position.set(0.16, 1.7, -0.19);
  group.add(board, torso, head, eye);
  group.scale.setScalar(ZOMBIE_STATS[type].targetHeight / 1.95);
  return group;
}

function prepareImportedEnemyModel(model, definition) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });

  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y < 0.001) {
    throw new Error('Lux3D 模型没有可用的垂直尺寸');
  }

  const scale = definition.targetHeight / initialSize.y;
  model.scale.multiplyScalar(scale);
  model.rotation.y = definition.yaw;
  model.updateMatrixWorld(true);

  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -normalizedBounds.min.y, -center.z);
  model.updateMatrixWorld(true);
}

function prepareImportedWeaponModel(model, definition) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });

  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y < 0.001) {
    throw new Error('Lux3D 武器模型没有可用的垂直尺寸');
  }

  model.scale.multiplyScalar(definition.targetHeight / initialSize.y);
  model.rotation.y = definition.yaw;
  model.updateMatrixWorld(true);

  // 手持武器以几何中心作为 rig 原点；V 键检视时可以完整看到它。
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -center.y, -center.z);
  model.updateMatrixWorld(true);
}

function updateEnemyAssetStatus() {
  assetLoadState.enemy = enemyLoadFailures.size ? 'fallback' : 'ready';
  updateAssetStatus();
}

async function loadEnemyPrototype(type) {
  if (enemyPrototypeCache.has(type)) return enemyPrototypeCache.get(type);
  if (enemyPrototypePromises.has(type)) return enemyPrototypePromises.get(type);

  const definition = MODEL_CATALOG.enemies[type];
  const promise = (async () => {
    try {
      if (!definition?.uri) throw new Error(`${definition?.label ?? type}尚未配置 GLB`);
      const gltf = await new GLTFLoader().loadAsync(definition.uri);
      const importedModel = gltf.scene ?? gltf.scenes[0];
      if (!importedModel) throw new Error('GLB 中没有可加载的场景');
      prepareImportedEnemyModel(importedModel, definition);
      enemyPrototypeCache.set(type, importedModel);
      enemyLoadFailures.delete(type);
      updateEnemyAssetStatus();
      return importedModel;
    } catch (error) {
      // 资产失败只降级该单位，波次与数值依然可完整试玩。
      console.warn(`未能加载 Lux3D ${definition?.label ?? type}，将继续使用占位训练体。`, error);
      enemyLoadFailures.add(type);
      updateEnemyAssetStatus();
      return null;
    } finally {
      enemyPrototypePromises.delete(type);
    }
  })();
  enemyPrototypePromises.set(type, promise);
  return promise;
}

function createEnemyHealthBar(enemy) {
  const group = new THREE.Group();
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 0.13),
    new THREE.MeshBasicMaterial({ color: '#18282a', transparent: true, opacity: 0.92, depthTest: false }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.24, 0.075),
    new THREE.MeshBasicMaterial({ color: enemy.type === 'giantZombie' ? '#ff865f' : '#a9ee73', depthTest: false }),
  );
  fill.position.z = 0.012;
  group.add(background, fill);
  group.position.y = enemy.stats.targetHeight + 0.3;
  group.renderOrder = 8;
  group.traverse((node) => {
    if (node.isMesh) node.renderOrder = 8;
  });
  enemy.root.add(group);
  enemy.healthBar = { group, fill };
  updateEnemyHealthBar(enemy);
}

function updateEnemyHealthBar(enemy) {
  if (!enemy.healthBar) return;
  const ratio = Math.max(0, Math.min(1, enemy.health / enemy.maxHealth));
  enemy.healthBar.fill.scale.x = ratio;
  enemy.healthBar.fill.position.x = -((1 - ratio) * 1.24) / 2;
}

function createEnemy(type) {
  const stats = ZOMBIE_STATS[type];
  const lane = BEACH_DEFENSE_CONFIG.enemy.lanes[Math.floor(Math.random() * BEACH_DEFENSE_CONFIG.enemy.lanes.length)];
  const root = new THREE.Group();
  root.position.set(lane, 0, BEACH_DEFENSE_CONFIG.enemy.spawnZ);
  root.rotation.y = Math.PI;
  const enemy = {
    id: `${type}-${nextEnemyId++}`,
    type,
    stats,
    root,
    health: stats.hp,
    maxHealth: stats.hp,
    lane,
    bobOffset: Math.random() * Math.PI * 2,
    visual: createEnemyPlaceholderVisual(type),
    healthBar: null,
  };
  root.add(enemy.visual);
  createEnemyHealthBar(enemy);
  scene.add(root);
  enemies.push(enemy);
  void hydrateEnemyVisual(enemy);
  return enemy;
}

async function hydrateEnemyVisual(enemy) {
  const prototype = await loadEnemyPrototype(enemy.type);
  if (!prototype || !enemies.includes(enemy)) return;
  const oldVisual = enemy.visual;
  const visual = prototype.clone(true);
  enemy.root.remove(oldVisual);
  enemy.root.add(visual);
  enemy.visual = visual;
}

async function loadActiveWeaponModel() {
  const selectedWeaponId = activeWeaponId;
  const selectedWeapon = activeWeaponModel;
  if (!selectedWeapon) {
    showWeaponPlaceholder();
    assetLoadState.weapon = 'waiting';
    updateAssetStatus();
    return;
  }
  const loader = new GLTFLoader();
  try {
    if (!selectedWeapon.uri) throw new Error(`${selectedWeapon.label}尚未配置 GLB`);
    const gltf = await loader.loadAsync(selectedWeapon.uri);
    const importedModel = gltf.scene ?? gltf.scenes[0];
    if (!importedModel) throw new Error('GLB 中没有可加载的场景');

    prepareImportedWeaponModel(importedModel, selectedWeapon);
    if (selectedWeaponId !== activeWeaponId) return;
    const oldVisual = weapon.userData.visual;
    if (oldVisual) weapon.remove(oldVisual);
    weapon.add(importedModel);
    weapon.userData.visual = importedModel;
    weapon.userData.usingPlaceholder = false;
    assetLoadState.weapon = 'ready';
    updateAssetStatus();
  } catch (error) {
    console.warn(`未能加载 Lux3D ${selectedWeapon.label}，将继续使用占位训练体。`, error);
    if (selectedWeaponId !== activeWeaponId) return;
    showWeaponPlaceholder();
    assetLoadState.weapon = 'fallback';
    weapon.userData.usingPlaceholder = true;
    updateAssetStatus();
  }
}

async function applyWeaponSelection(weaponId) {
  const nextWeapon = MODEL_CATALOG.weapons[weaponId];
  if (!nextWeapon) throw new Error('这个背包植物暂时不能进入战斗场');
  activeWeaponId = weaponId;
  activeWeaponModel = nextWeapon;
  assetLoadState.weapon = 'loading';
  showWeaponPlaceholder();
  updateAssetStatus();
  await loadActiveWeaponModel();
  // 允许战斗中从背包换装，但绝不能为了换装清空正在进行的波次。
  if (!battleStarted && !isDefeated) resetDefense();
}

async function equipFromInventory(weaponId) {
  try {
    gameState = await gameStateClient.command('equipWeapon', { weaponId });
    await applyWeaponSelection(weaponId);
    renderInventory();
    setInventoryOpen(false);
    assetStatusText.textContent = `${GAME_WEAPONS[weaponId].label} 已从背包装备。`;
  } catch (error) {
    inventorySummary.textContent = error.message;
  }
}

function setPlayerHealth(value) {
  playerHealth = Math.max(0, Math.min(DEFENSE_RULES.maxIntegrity, value));
  healthValue.textContent = playerHealth;
  healthBar.style.width = `${(playerHealth / DEFENSE_RULES.maxIntegrity) * 100}%`;
}

function clearProjectiles() {
  for (const projectile of projectiles) scene.remove(projectile.mesh);
  projectiles.length = 0;
  for (const impact of watermelonImpacts) scene.remove(impact.mesh);
  watermelonImpacts.length = 0;
}

function removeEnemy(enemy) {
  scene.remove(enemy.root);
  const index = enemies.indexOf(enemy);
  if (index >= 0) enemies.splice(index, 1);
}

function clearEnemies() {
  for (const enemy of [...enemies]) removeEnemy(enemy);
}

function getCurrentLevel() {
  return TIDE_LEVELS[currentLevelIndex];
}

function renderLevelSelect() {
  const unlockedCount = TIDE_LEVELS.filter((level) => isLevelUnlocked(levelProgress, level.id)).length;
  levelSelectSummary.textContent = `已解锁 ${unlockedCount} / ${TIDE_LEVELS.length} 关 · 通关会自动保存并解锁下一关。`;
  levelSelectItems.replaceChildren(...TIDE_LEVELS.map((level, index) => {
    const unlocked = isLevelUnlocked(levelProgress, level.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level-select__item${unlocked ? ' is-unlocked' : ''}${index === currentLevelIndex ? ' is-current' : ''}`;
    button.disabled = !unlocked;
    button.innerHTML = `<span>第 ${index + 1} 关</span><strong>${level.name}</strong><small>${level.waves.length} 波 · 推荐${MODEL_CATALOG.weapons[level.recommendedWeapon]?.label ?? '植物'}</small><em>${unlocked ? (index === currentLevelIndex ? '当前关卡' : '前往挑战') : '尚未解锁'}</em>`;
    if (unlocked) button.addEventListener('click', () => selectLevel(index));
    return button;
  }));
}

function setLevelSelectOpen(open) {
  const nextOpen = Boolean(open);
  if (nextOpen && controls.isLocked) controls.unlock();
  levelSelect.hidden = !nextOpen;
  levelSelectToggle.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen) renderLevelSelect();
}

function updateWaveAccelerationUi() {
  if (!waveAcceleratorToggle) return;
  waveAcceleratorToggle.textContent = `波次加速：${isWaveAccelerationEnabled ? '开' : '关'} · K`;
  waveAcceleratorToggle.setAttribute('aria-pressed', String(isWaveAccelerationEnabled));
  waveAcceleratorToggle.title = isWaveAccelerationEnabled
    ? '当前波次清空后立刻进入下一波'
    : '开启后，当前波次清空会跳过蓄潮等待';
}

function toggleWaveAcceleration() {
  isWaveAccelerationEnabled = !isWaveAccelerationEnabled;
  updateWaveAccelerationUi();
  assetStatusText.textContent = isWaveAccelerationEnabled
    ? '波次加速已开启：清空当前波次后会立刻进入下一波。'
    : '波次加速已关闭：下一波将保留蓄潮时间。';
}

function selectLevel(index) {
  const targetLevel = TIDE_LEVELS[index];
  if (!targetLevel || !isLevelUnlocked(levelProgress, targetLevel.id)) return;
  if (controls.isLocked) controls.unlock();
  currentLevelIndex = index;
  advanceLevelOnReset = false;
  resetDefense();
  setLevelSelectOpen(false);
  startPanel.setAttribute('aria-hidden', 'false');
  pausedPanel.setAttribute('aria-hidden', 'true');
}

function getRemainingEnemyCount() {
  return enemies.length + pendingSpawns.length;
}

function updateBattleHud() {
  const level = getCurrentLevel();
  if (levelState) levelState.textContent = level.name;
  if (enemiesRemaining) enemiesRemaining.textContent = `剩余敌人 ${getRemainingEnemyCount()}`;
  if (!waveState) return;
  if (isDefeated) {
    waveState.textContent = advanceLevelOnReset ? `第 ${level.waves.length} 波已守住` : '本关待重新部署';
    return;
  }
  if (!battleStarted) {
    waveState.textContent = `准备第 1 / ${level.waves.length} 波`;
    return;
  }
  if (nextWaveAt) {
    waveState.textContent = `第 ${activeWaveIndex + 1} 波清场 · 下一波蓄潮中`;
    return;
  }
  waveState.textContent = `第 ${Math.max(1, activeWaveIndex + 1)} / ${level.waves.length} 波`;
}

function updateEnemyCallout() {
  if (isDefeated || !enemies.length) return;
  const nearest = enemies.reduce((closest, current) => (
    current.root.position.z < closest.root.position.z ? current : closest
  ));
  const remaining = Math.max(0, nearest.root.position.z - BEACH_DEFENSE_CONFIG.enemy.escapeZ);
  enemyState.textContent = `${nearest.stats.label} · ${remaining.toFixed(1)}m`;
  enemyCopy.textContent = `潮沟内 ${enemies.length} 个推进中 · 本波尚余 ${getRemainingEnemyCount()} 个`;
}

function resetDefense({ advanceLevel = false } = {}) {
  if (advanceLevel) currentLevelIndex = (currentLevelIndex + 1) % TIDE_LEVELS.length;
  isDefeated = false;
  battleSettled = false;
  battleStarted = false;
  advanceLevelOnReset = false;
  activeWaveIndex = -1;
  pendingSpawns = [];
  nextSpawnAt = 0;
  nextWaveAt = 0;
  cornCannonUsed = false;
  cornCannonFiring = false;
  cornCannonPulseUntil = 0;
  cornCannonPulse.visible = false;
  clearCornMissiles();
  setWeaponInspection(false);
  setPlayerHealth(DEFENSE_RULES.maxIntegrity);
  clearEnemies();
  clearProjectiles();
  const level = getCurrentLevel();
  startTitle.textContent = level.name;
  startCopy.textContent = activeWeaponModel
    ? `第 ${currentLevelIndex + 1} 关「${level.name}」共有 ${level.waves.length} 波潮沟敌人。当前已装备${activeWeaponModel.label}；守住防线可获得 ${level.clearSunReward} 阳光，并为花园水壶补 1 格水。`
    : '先按 Tab 打开共享背包，选择一株从后花园收获或合成完成的植物武器。';
  startButton.textContent = activeWeaponModel ? `拿起${activeWeaponModel.label}` : '打开背包选择植物';
  enemyState.textContent = '潮沟待命';
  enemyCopy.textContent = '冲浪僵尸、小鬼僵尸与巨人僵尸将按波次出现';
  updateBattleHud();
  updateCornCannonUi();
}

function enterDefense() {
  if (!activeWeaponModel) {
    setInventoryOpen(true);
    void refreshGameState({ announceFailure: true });
    return;
  }
  if (isDefeated) resetDefense({ advanceLevel: advanceLevelOnReset });
  if (!battleStarted) startCurrentLevel();
  controls.lock();
}

function startCurrentLevel() {
  battleStarted = true;
  activeWaveIndex = -1;
  pendingSpawns = [];
  nextWaveAt = 0;
  nextSpawnAt = performance.now();
  startNextWave(performance.now());
  updateCornCannonUi();
}

function startNextWave(now) {
  const level = getCurrentLevel();
  activeWaveIndex += 1;
  const nextWave = level.waves[activeWaveIndex];
  // 关卡配置异常时不能把“空数组”伪装成一波已经开始的战斗；直接跳过该坏波，
  // 并保留可继续推进的状态，避免试玩时卡死。
  if (!Array.isArray(nextWave) || !nextWave.length) {
    pendingSpawns = [];
    nextSpawnAt = 0;
    nextWaveAt = now;
    enemyState.textContent = `第 ${activeWaveIndex + 1} 波配置为空，已跳过`;
    enemyCopy.textContent = '波次导演已自动修复，正在推进到下一波。';
    updateBattleHud();
    return;
  }
  pendingSpawns = [...nextWave];
  nextSpawnAt = now;
  nextWaveAt = 0;
  enemyState.textContent = `第 ${activeWaveIndex + 1} 波来袭`;
  enemyCopy.textContent = `本波将出现 ${pendingSpawns.length} 个潮沟敌人`;
  updateBattleHud();
}

function finishBattle(result) {
  if (isDefeated) return;
  const level = getCurrentLevel();
  isDefeated = true;
  battleStarted = false;
  pendingSpawns = [];
  nextSpawnAt = 0;
  nextWaveAt = 0;
  clearCornMissiles();
  clearProjectiles();
  if (result === 'defeat') {
    clearEnemies();
    advanceLevelOnReset = false;
    enemyState.textContent = '防线失守';
    enemyCopy.textContent = `巨浪突破了防线；第 ${currentLevelIndex + 1} 关可立即重试。`;
    startTitle.textContent = '防线需要重整';
    startCopy.textContent = `「${level.name}」尚未守住。重新进入后会从第 1 波开始，防线恢复为 ${DEFENSE_RULES.maxIntegrity} 格。`;
    startButton.textContent = '重新部署';
  } else {
    levelProgress = completeLevel(levelProgress, TIDE_LEVELS, level.id);
    saveLevelProgress();
    renderLevelSelect();
    advanceLevelOnReset = true;
    enemyState.textContent = '防线守住';
    enemyCopy.textContent = `已获得 ${level.clearSunReward} 阳光与 1 格水壶补给。`;
    startTitle.textContent = `${level.name}已守住`;
    const nextLevel = TIDE_LEVELS[(currentLevelIndex + 1) % TIDE_LEVELS.length];
    const nextLevelUnlocked = currentLevelIndex < TIDE_LEVELS.length - 1;
    startCopy.textContent = nextLevelUnlocked
      ? `本次防守已结算 ${level.clearSunReward} 阳光，并解锁「${nextLevel.name}」。可按“选关”自由重打已解锁关卡，或直接进入下一关。`
      : `本次防守已结算 ${level.clearSunReward} 阳光。全部演示关卡已解锁，可按“选关”自由重打。`;
    startButton.textContent = `进入${nextLevel.name}`;
  }
  updateBattleHud();
  updateCornCannonUi();
  void settleBattle(result, result === 'victory' ? level.clearSunReward : 0);
  if (controls.isLocked) controls.unlock();
}

function updateWaveDirector(now) {
  if (!controls.isLocked || isDefeated || !battleStarted) return;
  // 玉米导弹正在飞行时，当前波次的剩余敌人和待生成队列已经锁定，
  // 绝不能提前把下一波刷出来再一起误伤。
  if (cornCannonFiring || cornMissiles.length) return;
  if (pendingSpawns.length && now >= nextSpawnAt) {
    createEnemy(pendingSpawns.shift());
    nextSpawnAt = now + DEFENSE_RULES.spawnIntervalMs;
    updateBattleHud();
    return;
  }
  if (pendingSpawns.length || enemies.length) return;
  const level = getCurrentLevel();
  if (activeWaveIndex >= level.waves.length - 1) {
    finishBattle('victory');
    return;
  }
  if (!nextWaveAt) {
    if (isWaveAccelerationEnabled) {
      startNextWave(now);
      return;
    }
    nextWaveAt = now + DEFENSE_RULES.waveRestMs;
    enemyState.textContent = '潮汐间歇';
    enemyCopy.textContent = `${Math.round(DEFENSE_RULES.waveRestMs / 1000)} 秒后下一波将进入潮沟`;
    updateBattleHud();
    return;
  }
  if (now >= nextWaveAt) startNextWave(now);
}

function createProjectileMesh(projectileId) {
  if (projectileId === 'butter') {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.12, 0.22, 2, 2, 2),
      new THREE.MeshStandardMaterial({ color: '#ffe06a', emissive: '#ab7c0a', emissiveIntensity: 0.22, roughness: 0.46 }),
    );
  }
  if (projectileId === 'watermelon') {
    // 第一版弹药刻意不新增 GLB：程序化条纹西瓜球既能清楚识别，也不会拖慢
    // 后续调节抛物线与爆炸半径。确认手感后可直接替换本函数为专属西瓜弹药模型。
    const visual = new THREE.Group();
    const rind = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 18, 14),
      new THREE.MeshStandardMaterial({ color: '#8fd64e', emissive: '#275f28', emissiveIntensity: 0.2, roughness: 0.42 }),
    );
    rind.scale.set(1.08, 0.92, 1.08);
    visual.add(rind);
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: '#2f7f37', emissive: '#123819', emissiveIntensity: 0.18, roughness: 0.48 });
    for (const yaw of [0, Math.PI / 3, -Math.PI / 3]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.224, 0.018, 6, 20), stripeMaterial);
      stripe.rotation.y = yaw;
      visual.add(stripe);
    }
    return visual;
  }
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 10),
    new THREE.MeshStandardMaterial({ color: '#c3f05e', emissive: '#4d8d22', emissiveIntensity: 0.6, roughness: 0.5 }),
  );
}

function getActiveLobCharge(now = performance.now()) {
  const attack = activeWeaponModel?.attack;
  if (attack?.style !== 'lob') return 0;
  if (!isLobCharging) return 0;
  return getLobChargeProgress({
    startedAt: lobChargeStartedAt,
    now,
    durationMs: attack.chargeDurationMs,
  });
}

function getActiveLobShotProfile(now = performance.now()) {
  const attack = activeWeaponModel?.attack;
  if (attack?.style !== 'lob') return attack;
  return getLobShotProfile(attack, getActiveLobCharge(now));
}

function cancelLobCharge() {
  isLobCharging = false;
  lobChargeStartedAt = 0;
}

function cancelPendingLobShot() {
  if (pendingLobShotTimer !== null) window.clearTimeout(pendingLobShotTimer);
  pendingLobShotTimer = null;
}

function getLobCooldownRemaining(attack, now = performance.now()) {
  return Math.max(0, (lastShotAt + attack.cooldownMs) - now);
}

function queueLobShot(lobCharge) {
  const attack = activeWeaponModel?.attack;
  if (!controls.isLocked || isInspectingWeapon || attack?.style !== 'lob') return;
  const remaining = getLobCooldownRemaining(attack);
  if (remaining <= 0) {
    fireWeapon({ lobCharge });
    return;
  }

  const weaponId = activeWeaponId;
  cancelPendingLobShot();
  // 蓄力过程中可能刚好还差几十毫秒冷却。松开时排入同一把武器的下一次可用帧，
  // 避免输入已完成却被静默吞掉；重新按住则会取消这次排队。
  pendingLobShotTimer = window.setTimeout(() => {
    pendingLobShotTimer = null;
    if (activeWeaponId !== weaponId || !controls.isLocked || isInspectingWeapon) return;
    const activeAttack = activeWeaponModel?.attack;
    if (activeAttack?.style !== 'lob') return;
    const nextRemaining = getLobCooldownRemaining(activeAttack);
    if (nextRemaining > 0) {
      queueLobShot(lobCharge);
      return;
    }
    fireWeapon({ lobCharge });
  }, Math.ceil(remaining) + 12);
}

function startLobCharge() {
  const attack = activeWeaponModel?.attack;
  if (!controls.isLocked || isInspectingWeapon || attack?.style !== 'lob' || isLobCharging) return;
  cancelPendingLobShot();
  isLobCharging = true;
  lobChargeStartedAt = performance.now();
}

function releaseLobCharge() {
  const attack = activeWeaponModel?.attack;
  if (!isLobCharging || attack?.style !== 'lob') return;
  const charge = Math.max(0.12, getActiveLobCharge());
  cancelLobCharge();
  queueLobShot(charge);
}

function resolveLaunchVelocity(direction, attack) {
  if (attack.style !== 'lob') return direction.multiplyScalar(attack.speed);
  const horizontal = new THREE.Vector3(direction.x, 0, direction.z);
  if (horizontal.lengthSq() < 0.0001) horizontal.set(0, 0, -1);
  horizontal.normalize().multiplyScalar(attack.horizontalSpeed);
  horizontal.y = attack.upwardSpeed + Math.max(direction.y, 0) * attack.aimLift;
  return horizontal;
}

function fireWeapon({ lobCharge = 1 } = {}) {
  if (!controls.isLocked || isInspectingWeapon) return false;
  if (!activeWeaponModel) return false;
  const attack = activeWeaponModel.attack.style === 'lob'
    ? getLobShotProfile(activeWeaponModel.attack, lobCharge)
    : activeWeaponModel.attack;
  const now = performance.now();
  if (now - lastShotAt < attack.cooldownMs) return false;
  lastShotAt = now;
  const center = (attack.projectileCount - 1) / 2;
  for (let index = 0; index < attack.projectileCount; index += 1) {
    const projectile = createProjectileMesh(attack.projectileId);
    const direction = controls.getDirection(new THREE.Vector3()).applyAxisAngle(camera.up, (index - center) * attack.spread);
    projectile.position.copy(camera.position).addScaledVector(direction, 0.86);
    projectile.position.y -= 0.18;
    scene.add(projectile);
    projectiles.push({
      mesh: projectile,
      velocity: resolveLaunchVelocity(direction, attack),
      gravity: attack.gravity,
      hitRadius: attack.hitRadius,
      damage: attack.damage,
      splashRadius: attack.splashRadius ?? 0,
      splashDamage: attack.splashDamage ?? attack.damage,
      lifetime: attack.lifetime ?? BEACH_DEFENSE_CONFIG.projectile.lifetime,
      charge: attack.charge ?? 1,
    });
  }
  return true;
}

function updateCornAimGuide() {
  const attack = activeWeaponModel?.attack;
  const shouldShow = controls.isLocked && !isInspectingWeapon && attack?.style === 'lob';
  if (!shouldShow) {
    cornAimGuide.visible = false;
    cornAimMarker.visible = false;
    return;
  }

  const direction = controls.getDirection(new THREE.Vector3());
  const start = camera.position.clone().addScaledVector(direction, 0.86);
  start.y -= 0.18;
  const chargedAttack = getActiveLobShotProfile();
  const velocity = resolveLaunchVelocity(direction, chargedAttack);
  const lifetime = chargedAttack.lifetime ?? BEACH_DEFENSE_CONFIG.projectile.lifetime;
  let pointCount = 0;
  const lastPoint = new THREE.Vector3();

  for (let step = 0; step <= CORN_AIM_GUIDE_STEPS; step += 1) {
    const time = (lifetime * step) / CORN_AIM_GUIDE_STEPS;
    const x = start.x + velocity.x * time;
    const rawY = start.y + velocity.y * time - (0.5 * chargedAttack.gravity * time * time);
    const y = Math.max(0.045, rawY);
    const z = start.z + velocity.z * time;
    const offset = pointCount * 3;
    cornAimGuidePositions[offset] = x;
    cornAimGuidePositions[offset + 1] = y;
    cornAimGuidePositions[offset + 2] = z;
    lastPoint.set(x, y, z);
    pointCount += 1;
    if (rawY <= 0.045) break;
  }

  cornAimGuideAttribute.needsUpdate = true;
  cornAimGuideGeometry.setDrawRange(0, pointCount);
  cornAimGuide.computeLineDistances();
  cornAimGuide.visible = pointCount > 1;
  cornAimMarker.position.set(lastPoint.x, 0.052, lastPoint.z);
  cornAimMarker.visible = pointCount > 1;
}

function updateLobChargeMeter() {
  const attack = activeWeaponModel?.attack;
  const active = controls.isLocked && !isInspectingWeapon && attack?.style === 'lob';
  if (!lobChargeMeter) return;
  lobChargeMeter.hidden = !active;
  if (!active) return;

  const chargedAttack = getActiveLobShotProfile();
  const charge = chargedAttack.charge ?? 0;
  const range = estimateLobRange({
    startHeight: Math.max(0, camera.position.y - 0.18),
    horizontalSpeed: chargedAttack.horizontalSpeed,
    upwardSpeed: chargedAttack.upwardSpeed,
    gravity: chargedAttack.gravity,
  });
  if (lobChargeFill) lobChargeFill.style.width = `${Math.round(charge * 100)}%`;
  if (lobChargeLabel) lobChargeLabel.textContent = isLobCharging
    ? `蓄力 ${Math.round(charge * 100)}% · ${chargedAttack.damage} 伤害`
    : '投手瞄准 · 短按近投';
  if (lobChargeDetail) lobChargeDetail.textContent = isLobCharging
    ? `预计落点 ${range.toFixed(1)}m · 松开左键投掷`
    : `当前近投 ${range.toFixed(1)}m · 按住左键蓄力拉长轨迹`;
}

async function useCornCannon() {
  if (cornCannonFiring || !controls.isLocked || !battleStarted || isDefeated || cornCannonUsed) return;
  if (!isNearCornCannon()) {
    assetStatusText.textContent = '请靠近海岸的玉米加农炮后再装填。';
    return;
  }
  if (activeWaveIndex < 0 || (!enemies.length && !pendingSpawns.length)) {
    assetStatusText.textContent = '玉米加农炮需要在敌人波次中使用。';
    return;
  }
  if (!getCornCannonCount()) {
    assetStatusText.textContent = '背包中没有玉米加农炮。';
    updateCornCannonUi();
    return;
  }
  cornCannonFiring = true;
  try {
    gameState = await gameStateClient.command('useCornCannon');
    cornCannonUsed = true;
    // 此后本波不会再补怪；已有敌人等导弹实际落地后才一起清除。
    pendingSpawns = [];
    nextSpawnAt = 0;
    launchCornMissile();
    enemyState.textContent = '玉米导弹升空';
    enemyCopy.textContent = '锁定本波潮沟，导弹即将落下。';
    renderInventory();
    updateBattleHud();
  } catch (error) {
    assetStatusText.textContent = `玉米加农炮未能使用：${error.message}`;
  } finally {
    cornCannonFiring = false;
    updateCornCannonUi();
  }
}

function updateCornCannonPulse(now) {
  if (!cornCannonPulse.visible) return;
  const remaining = Math.max(0, cornCannonPulseUntil - now);
  if (!remaining) {
    cornCannonPulse.visible = false;
    return;
  }
  const progress = 1 - remaining / 620;
  cornCannonPulse.scale.setScalar(1 + progress * 22);
  cornCannonPulse.material.opacity = (1 - progress) * 0.76;
}

function setWeaponInspection(value) {
  isInspectingWeapon = Boolean(value && controls.isLocked && !isDefeated);
  if (isInspectingWeapon) {
    cancelLobCharge();
    cancelPendingLobShot();
  }
  if (!isInspectingWeapon) {
    inspectManualYaw = 0;
    inspectManualPitch = 0;
    isInspectRightDrag = false;
  }
  app.classList.toggle('is-inspecting', isInspectingWeapon);
}

function updateWeaponPose(delta, elapsed) {
  if (!weapon) return;
  const now = performance.now();
  const motion = getWeaponMotion({
    elapsedMs: elapsed * 1000,
    inspecting: isInspectingWeapon,
    timeSinceLastShotMs: lastShotAt ? Math.max(0, now - lastShotAt) : Infinity,
    inspectYaw: inspectManualYaw,
    inspectPitch: inspectManualPitch,
  });
  const targetPose = isInspectingWeapon ? WEAPON_POSES.inspect : WEAPON_POSES.combat;
  const targetPosition = targetPose.position.clone();
  if (!isInspectingWeapon) targetPosition.add(new THREE.Vector3(
    motion.positionOffset.x,
    motion.positionOffset.y,
    motion.positionOffset.z,
  ));
  const rotationOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    motion.rotationOffset.x,
    motion.rotationOffset.y,
    motion.rotationOffset.z,
  ));
  const targetQuaternion = targetPose.quaternion.clone().multiply(rotationOffset);
  const targetScale = targetPose.scale.clone().multiplyScalar(motion.scaleMultiplier);
  const blend = 1 - Math.exp(-14 * delta);
  weapon.position.lerp(targetPosition, blend);
  weapon.quaternion.slerp(targetQuaternion, blend);
  weapon.scale.lerp(targetScale, blend);
}

function updatePlayer(delta) {
  if (!controls.isLocked) return;
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  if (forward || right) {
    const length = Math.hypot(forward, right);
    controls.moveForward((forward / length) * BEACH_DEFENSE_CONFIG.player.speed * delta);
    controls.moveRight((right / length) * BEACH_DEFENSE_CONFIG.player.speed * delta);
  }
  const clamped = clampPlayerPosition(camera.position);
  camera.position.set(clamped.x, BEACH_DEFENSE_CONFIG.player.eyeHeight, clamped.z);
}

function updateEnemies(delta, elapsed) {
  if (!controls.isLocked || isDefeated) return;
  for (const enemy of [...enemies]) {
    enemy.root.position.z -= enemy.stats.speed * delta;
    enemy.root.position.y = Math.sin(elapsed * 4.2 + enemy.bobOffset) * 0.075;
    enemy.root.rotation.z = Math.sin(elapsed * 3.1 + enemy.bobOffset) * 0.052;
    enemy.root.rotation.x = Math.cos(elapsed * 2.2 + enemy.bobOffset) * 0.032;
    enemy.healthBar.group.quaternion.copy(camera.quaternion);
    if (enemy.root.position.z > BEACH_DEFENSE_CONFIG.enemy.escapeZ) continue;
    const nextHealth = playerHealth - enemy.stats.defenseDamage;
    removeEnemy(enemy);
    setPlayerHealth(nextHealth);
    if (playerHealth <= 0) {
      finishBattle('defeat');
      break;
    }
    enemyState.textContent = enemy.stats.defenseDamage === 2 ? '巨人重击防线' : '敌人突破防线';
    enemyCopy.textContent = `防线剩余 ${playerHealth} 格；仍有 ${getRemainingEnemyCount()} 个潮沟敌人。`;
    updateBattleHud();
  }
  updateEnemyCallout();
}

async function settleBattle(result, reward = 0) {
  if (battleSettled) return;
  battleSettled = true;
  try {
    gameState = await gameStateClient.command('resolveBattleReward', {
      result,
      reward,
    });
    renderInventory();
  } catch (error) {
    assetStatusText.textContent = `结算未写入共享背包：${error.message}`;
  }
}

function getEnemyHitPoint(enemy) {
  return new THREE.Vector3(
    enemy.root.position.x,
    enemy.root.position.y + enemy.stats.targetHeight * 0.48,
    enemy.root.position.z,
  );
}

function applyProjectileDamage(enemy, damage) {
  if (!enemies.includes(enemy)) return { defeated: false, label: enemy.stats.label };
  enemy.health -= damage;
  updateEnemyHealthBar(enemy);
  enemy.root.scale.setScalar(0.94);
  window.setTimeout(() => {
    if (enemies.includes(enemy)) enemy.root.scale.setScalar(1);
  }, 90);
  if (enemy.health > 0) return { defeated: false, label: enemy.stats.label };
  const label = enemy.stats.label;
  removeEnemy(enemy);
  return { defeated: true, label };
}

function createWatermelonImpact(position, radius) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.38, 32),
    new THREE.MeshBasicMaterial({
      color: '#9fe95a',
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(position.x, 0.058, position.z);
  scene.add(mesh);
  watermelonImpacts.push({ mesh, radius, duration: 0.42, remaining: 0.42 });
}

function updateWatermelonImpacts(delta) {
  for (let index = watermelonImpacts.length - 1; index >= 0; index -= 1) {
    const impact = watermelonImpacts[index];
    impact.remaining -= delta;
    const progress = 1 - Math.max(0, impact.remaining) / impact.duration;
    impact.mesh.scale.setScalar(1 + progress * impact.radius * 3.8);
    impact.mesh.material.opacity = Math.max(0, 0.82 * (1 - progress));
    if (impact.remaining > 0) continue;
    scene.remove(impact.mesh);
    watermelonImpacts.splice(index, 1);
  }
}

function detonateWatermelon(projectile, directTarget = null) {
  const impact = projectile.mesh.position.clone();
  const radius = projectile.splashRadius;
  createWatermelonImpact(impact, radius);

  const affected = enemies.filter((enemy) => {
    const dx = enemy.root.position.x - impact.x;
    const dz = enemy.root.position.z - impact.z;
    return Math.hypot(dx, dz) <= radius + enemy.stats.collisionRadius;
  });
  if (directTarget && enemies.includes(directTarget) && !affected.includes(directTarget)) affected.unshift(directTarget);

  let defeatedCount = 0;
  for (const enemy of [...affected]) {
    const damage = enemy === directTarget ? projectile.damage : projectile.splashDamage;
    if (applyProjectileDamage(enemy, damage).defeated) defeatedCount += 1;
  }
  return { affectedCount: affected.length, defeatedCount };
}

function updateProjectiles(delta) {
  if (!controls.isLocked || isDefeated) return;
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    projectile.velocity.y -= projectile.gravity * delta;
    projectile.mesh.position.addScaledVector(projectile.velocity, delta);
    projectile.lifetime -= delta;
    projectile.mesh.rotation.x += delta * 14;
    projectile.mesh.rotation.y += delta * 10;
    const hitEnemy = enemies.find((enemy) => {
      const target = getEnemyHitPoint(enemy);
      return projectile.mesh.position.distanceTo(target) < projectile.hitRadius + enemy.stats.collisionRadius;
    });
    if (hitEnemy) {
      if (projectile.splashRadius > 0) {
        const result = detonateWatermelon(projectile, hitEnemy);
        enemyState.textContent = `西瓜爆裂命中 ${result.affectedCount} 个敌人`;
        enemyCopy.textContent = result.defeatedCount
          ? `范围伤害击退 ${result.defeatedCount} 个敌人；本波尚余 ${getRemainingEnemyCount()} 个潮沟敌人。`
          : `溅射已命中附近敌人；本波尚余 ${getRemainingEnemyCount()} 个潮沟敌人。`;
      } else {
        const result = applyProjectileDamage(hitEnemy, projectile.damage);
        enemyState.textContent = result.defeated ? `${result.label}已击退` : `${result.label}已命中`;
        enemyCopy.textContent = `本波尚余 ${getRemainingEnemyCount()} 个潮沟敌人`;
      }
      scene.remove(projectile.mesh);
      projectiles.splice(index, 1);
      updateBattleHud();
      continue;
    }
    // 抛物线西瓜即使没有直接撞到模型，也会在落点爆裂。这样它是真正可用的
    // 地面范围武器，而不是“必须精确命中一个碰撞球”的伪群攻。
    if (projectile.splashRadius > 0 && (projectile.lifetime <= 0 || projectile.mesh.position.y <= 0.055)) {
      const result = detonateWatermelon(projectile);
      enemyState.textContent = result.affectedCount ? `西瓜落地波及 ${result.affectedCount} 个敌人` : '西瓜落在空潮沟';
      enemyCopy.textContent = result.defeatedCount
        ? `范围伤害击退 ${result.defeatedCount} 个敌人；本波尚余 ${getRemainingEnemyCount()} 个潮沟敌人。`
        : `本波尚余 ${getRemainingEnemyCount()} 个潮沟敌人。`;
      scene.remove(projectile.mesh);
      projectiles.splice(index, 1);
      updateBattleHud();
      continue;
    }
    if (projectile.lifetime <= 0 || projectile.mesh.position.y < -1) {
      scene.remove(projectile.mesh);
      projectiles.splice(index, 1);
    }
  }
}

const sandMaterial = new THREE.MeshStandardMaterial({ map: createSandTexture(), roughness: 0.94, metalness: 0 });
const beachDepth = BEACH_DEFENSE_CONFIG.field.defenseLineZ - BEACH_DEFENSE_CONFIG.field.minZ;
createPlane(
  BEACH_DEFENSE_CONFIG.field.width,
  beachDepth,
  sandMaterial,
  0,
  BEACH_DEFENSE_CONFIG.field.minZ + beachDepth / 2,
);
addRearSandBackdrop(sandMaterial);
addSideSandBackdrops(sandMaterial);
addLanes();
const tideMaterial = addSea();
void hydrateEnvironmentModels();
weapon = createWeaponPlaceholder();
updateAssetStatus();
updateWaveAccelerationUi();
resetDefense();
showBattleOnboarding();

controls.addEventListener('lock', () => {
  keys.clear();
  void resumeBattleMusic();
  app.classList.add('is-playing');
  startPanel.setAttribute('aria-hidden', 'true');
  pausedPanel.setAttribute('aria-hidden', 'true');
  updateCornCannonUi();
});
controls.addEventListener('unlock', () => {
  keys.clear();
  cancelLobCharge();
  cancelPendingLobShot();
  app.classList.remove('is-playing');
  setWeaponInspection(false);
  updateCornCannonUi();
  if (isDefeated) {
    startPanel.setAttribute('aria-hidden', 'false');
    pausedPanel.setAttribute('aria-hidden', 'true');
    return;
  }
  startPanel.setAttribute('aria-hidden', 'true');
  pausedPanel.setAttribute('aria-hidden', 'false');
});

startButton.addEventListener('click', enterDefense);
resumeButton.addEventListener('click', () => {
  // 兼容旧版本“打开背包后波次被重置”的存档页：继续时若发现没有活跃波次，
  // 重新从当前关卡第 1 波开始，而不是锁鼠标后留在 0 敌人的假战斗里。
  if (!battleStarted && !isDefeated) startCurrentLevel();
  controls.lock();
});
inventoryToggle.addEventListener('click', () => {
  if (controls.isLocked) controls.unlock();
  setInventoryOpen(!isInventoryOpen);
  void refreshGameState({ announceFailure: true });
});
inventoryClose.addEventListener('click', () => setInventoryOpen(false));
levelSelectToggle.addEventListener('click', () => setLevelSelectOpen(levelSelect.hidden));
levelSelectClose.addEventListener('click', () => setLevelSelectOpen(false));
waveAcceleratorToggle?.addEventListener('click', toggleWaveAcceleration);
worldMapToggle.addEventListener('click', () => setWorldMapOpen(worldMap.hidden));
worldMapClose.addEventListener('click', () => setWorldMapOpen(false));
worldMap.addEventListener('click', (event) => {
  if (event.target === worldMap) setWorldMapOpen(false);
});
daveOnboardingClose?.addEventListener('click', () => setBattleOnboardingOpen(false));
daveOnboarding?.addEventListener('click', (event) => {
  if (event.target === daveOnboarding) setBattleOnboardingOpen(false);
});
document.querySelectorAll('[data-map-route]').forEach((button) => {
  button.addEventListener('click', () => goToMapDestination(button.dataset.mapRoute));
});
musicToggle.addEventListener('click', toggleBattleMusic);
document.addEventListener('pointerdown', () => { void resumeBattleMusic(); }, { capture: true });
window.addEventListener('keydown', (event) => {
  const isEditableTarget = event.target instanceof HTMLElement && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'));
  if (!daveOnboarding?.hidden) {
    if (event.key === 'Escape' || event.key === 'Enter') setBattleOnboardingOpen(false);
    event.preventDefault();
    return;
  }
  if (!isEditableTarget && event.code === 'KeyM') {
    event.preventDefault();
    setWorldMapOpen(worldMap.hidden);
    return;
  }
  if (!isEditableTarget && event.code === 'KeyP') {
    event.preventDefault();
    toggleBattleMusic();
    return;
  }
  if (!isEditableTarget && event.code === 'KeyJ') {
    event.preventDefault();
    setLevelSelectOpen(levelSelect.hidden);
    return;
  }
  if (!isEditableTarget && event.code === 'KeyK') {
    event.preventDefault();
    if (!event.repeat) toggleWaveAcceleration();
    return;
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    if (controls.isLocked) controls.unlock();
    setInventoryOpen(!isInventoryOpen);
    void refreshGameState({ announceFailure: true });
    return;
  }
  if (event.code === 'KeyV') {
    if (!event.repeat) setWeaponInspection(!isInspectingWeapon);
    return;
  }
  if (event.code === 'KeyE') {
    event.preventDefault();
    if (!event.repeat) void useCornCannon();
    return;
  }
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  cancelLobCharge();
  cancelPendingLobShot();
});
// PointerLockControls 直接消费浏览器给出的 movementX/Y。窗口重新获得焦点、
// 鼠标越过系统边缘时偶发的异常大 delta 会被误解为一次旋转瞬移；在捕获阶段丢弃它。
document.addEventListener('mousemove', (event) => {
  if (!controls.isLocked) return;
  if (isInspectingWeapon && isInspectRightDrag) {
    inspectManualYaw += event.movementX * 0.008;
    inspectManualPitch = THREE.MathUtils.clamp(inspectManualPitch + event.movementY * 0.006, -0.68, 0.68);
    event.stopImmediatePropagation();
    return;
  }
  if (Math.abs(event.movementX) <= MAX_SAFE_POINTER_DELTA && Math.abs(event.movementY) <= MAX_SAFE_POINTER_DELTA) return;
  event.stopImmediatePropagation();
}, { capture: true });
document.addEventListener('pointerdown', (event) => {
  if (event.button !== 2 || !controls.isLocked || !isInspectingWeapon) return;
  isInspectRightDrag = true;
  event.preventDefault();
}, { capture: true });
document.addEventListener('pointerup', (event) => {
  if (event.button === 2) isInspectRightDrag = false;
}, { capture: true });
document.addEventListener('contextmenu', (event) => {
  if (controls.isLocked && isInspectingWeapon) event.preventDefault();
});
window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (event.target === canvas && Number.isInteger(event.pointerId)) {
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer Lock 环境可能不支持捕获，window 监听仍会兜底。 */ }
  }
  if (activeWeaponModel?.attack?.style === 'lob') startLobCharge();
  else fireWeapon();
});
window.addEventListener('pointerup', (event) => {
  if (event.button === 0) releaseLobCharge();
});
window.addEventListener('pointercancel', () => cancelLobCharge());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
window.addEventListener('beforeunload', () => battleEnvironment.dispose(), { once: true });

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.05);
  const elapsed = timer.getElapsed();
  updatePlayer(delta);
  updateCornCannonUi();
  updateEnemies(delta, elapsed);
  updateWaveDirector(performance.now());
  updateProjectiles(delta);
  updateWatermelonImpacts(delta);
  updateCornMissiles(delta);
  updateTideMaterial(tideMaterial, elapsed);
  battleEnvironment.update(elapsed);
  updateCornCannonPulse(performance.now());
  updateWeaponPose(delta, elapsed);
  updateCornAimGuide();
  updateLobChargeMeter();
  renderer.render(scene, camera);
});

void refreshGameState({ announceFailure: true });
