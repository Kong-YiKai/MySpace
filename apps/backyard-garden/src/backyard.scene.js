export const PLOT_PLANT_YAWS = Object.freeze({
  'plot-a': Math.PI,
  'plot-b': Math.PI,
  'plot-c': Math.PI,
  'plot-d': 0,
  'plot-e': 0,
  'plot-f': 0,
});

// 3DGS 温室使用的是米级坐标。花圃的可点区域必须与实际土床接近，不能沿用
// 早期 PLY 原始坐标下的 14×12 大范围，否则六个区域会彼此吞没并总是先命中 A。
export const PLOT_INTERACTION_FOOTPRINT = Object.freeze({ width: 1.25, depth: 1.25 });

const plot = (id, label, position) => ({
  id,
  label,
  kind: 'spatial-anchor',
  transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  tags: ['plot', 'garden', 'planting-bed'],
  interactive: true,
  components: {
    semantic: { category: 'plot', role: 'planting-bed', abilities: ['plant', 'inspect-growth'] },
    spatialAnchor: {
      type: 'plot',
      capacity: 1,
      footprint: { ...PLOT_INTERACTION_FOOTPRINT },
      // A/B/C 面向与后三块相反；仅影响注入的植物模型，不移动花圃锚点。
      plantYaw: PLOT_PLANT_YAWS[id],
    },
    occupancy: { entityId: null },
  },
});

// 这是已烘焙进项目的正式温室布局，直接贴合画面里的六块土床。
// 用户本地通过调试锚点工具校准过的坐标仍会被保留，但无痕/新玩家绝不再
// 使用按场景边界均分出来的临时草稿坐标。
export const INITIAL_PLOT_POSITIONS = {
  'plot-a': [-5.25, 1.2, -1.95],
  'plot-b': [-3.7, 1.2, -2.15],
  'plot-c': [-1.75, 1.25, -1.95],
  'plot-d': [-5.25, 1.22, 1],
  'plot-e': [-3, 1.23, 1.35],
  'plot-f': [-1.4, 1.28, 0.45],
};

// 戴夫是一个独立 GLB，不写入 3DGS 点云。这里是按照当前温室点云边界烘焙的
// 正式地面锚点（温室右侧走道），而不是早期 PLY 坐标系中的 [-42, -12, 20]。
// 本地调试面板仍可覆盖它；无痕窗口和新玩家则从这个可见的地面位置起步。
export const DAVE_DEFAULT_ANCHOR = [1.5814271697613933, 1.384367252651644, -0.8899380607718483];

export const createBackyardManifest = (plotPositions = INITIAL_PLOT_POSITIONS) => ({
  schemaVersion: '1.0',
  sceneId: 'backyard-garden-001',
  revision: 0,
  coordinateSystem: { upAxis: 'Y', unit: 'meter', handedness: 'right' },
  sourceRefs: ['aholo-world:dd72660424934be7b71f7975a56506e0'],
  assets: [
    {
      id: 'backyard-garden-3dgs-v1',
      kind: 'splat',
      uri: '/assets/backyard/backyard-garden-3dgs-v1.ply',
      format: 'ply',
      metadata: { pointCount: 572202, provider: 'Aholo World / EGS' },
    },
    {
      id: 'shared-seedling-v1',
      kind: 'mesh',
      uri: '/assets/plants/shared-seedling-v1.glb',
      format: 'glb',
      metadata: { stage: 'seed', role: 'shared-growth-visual', provider: 'Lux3D' },
    },
    {
      id: 'shared-sprout-v1',
      kind: 'mesh',
      uri: '/assets/plants/shared-sprout-v1.glb',
      format: 'glb',
      // 这是豌豆系的青年期形态。保留原文件名以兼容旧资源，但不再把它错误复用于全部作物。
      metadata: { stage: 'sprout', speciesId: 'peaShooter', role: 'garden-growth-visual', provider: 'Lux3D' },
    },
    {
      id: 'corn-pult-sprout-v1',
      kind: 'mesh',
      uri: '/assets/plants/corn-pult-sprout-v1.glb',
      format: 'glb',
      metadata: { stage: 'sprout', speciesId: 'cornPult', role: 'garden-growth-visual', provider: 'Lux3D' },
    },
    {
      id: 'watermelon-pult-sprout-v1',
      kind: 'mesh',
      uri: '/assets/plants/watermelon-pult-sprout-v1.glb',
      format: 'glb',
      metadata: { stage: 'sprout', speciesId: 'watermelonPult', role: 'garden-growth-visual', provider: 'Lux3D' },
    },
    {
      id: 'pea-shooter-adult-v1',
      kind: 'mesh',
      uri: '/assets/plants/pea-shooter-adult-v1.glb',
      format: 'glb',
      metadata: { stage: 'mature', speciesId: 'peaShooter', role: 'garden-grown-weapon', provider: 'Lux3D' },
    },
    {
      id: 'corn-pult-adult-v1',
      kind: 'mesh',
      uri: '/assets/plants/corn-pult-adult-v1.glb',
      format: 'glb',
      metadata: { stage: 'mature', speciesId: 'cornPult', role: 'garden-grown-weapon', provider: 'Lux3D' },
    },
    {
      id: 'watermelon-pult-adult-v1',
      kind: 'mesh',
      uri: '/assets/plants/watermelon-pult-adult-v1.glb',
      format: 'glb',
      metadata: { stage: 'mature', speciesId: 'watermelonPult', role: 'garden-grown-weapon', provider: 'Lux3D' },
    },
    {
      id: 'crazy-dave-gardener-v1',
      kind: 'mesh',
      uri: '/assets/characters/crazy-dave-gardener-v1.glb',
      format: 'glb',
      metadata: { role: 'garden-steward', provider: 'Lux3D' },
    },
  ],
  entities: [
    plot('plot-a', '花圃 A', plotPositions['plot-a']),
    plot('plot-b', '花圃 B', plotPositions['plot-b']),
    plot('plot-c', '花圃 C', plotPositions['plot-c']),
    plot('plot-d', '花圃 D', plotPositions['plot-d']),
    plot('plot-e', '花圃 E', plotPositions['plot-e']),
    plot('plot-f', '花圃 F', plotPositions['plot-f']),
    {
      id: 'player-loadout',
      label: '玩家装备库',
      kind: 'player-state',
      components: { inventory: { weapons: [] } },
      tags: ['player', 'inventory'],
    },
    {
      id: 'crazy-dave-guide',
      label: '疯狂戴夫（花园管家）',
      kind: 'guide-character',
      transform: { position: DAVE_DEFAULT_ANCHOR, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      assetRefs: ['crazy-dave-gardener-v1'],
      tags: ['dave', 'guide', 'garden-steward'],
      interactive: true,
      components: {
        semantic: {
          category: 'guide',
          role: 'garden-steward',
          abilities: ['inspect-growth', 'recommend-plot'],
          affordances: ['inspect', 'open-task-station'],
        },
      },
    },
  ],
  behaviors: [],
  interactions: [],
  environment: { mode: 'garden', anchorDraft: false },
  metadata: { name: '戴夫的后花园', semanticLayer: 'garden.v1' },
});

export const getPlots = (manifest) => manifest.entities.filter((entity) => entity.kind === 'spatial-anchor');

// 兼容已经存入 localStorage 的旧版锚点：即使旧草稿未含 plantYaw，A/B/C 仍会立即翻转。
export const getPlotPlantYaw = (plotEntity) => (
  plotEntity.components.spatialAnchor?.plantYaw ?? PLOT_PLANT_YAWS[plotEntity.id] ?? 0
);
