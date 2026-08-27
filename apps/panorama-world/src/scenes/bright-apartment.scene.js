export const brightApartmentScene = {
  schemaVersion: '1.0',
  sceneId: 'bright-apartment-002',
  revision: 0,
  sourceRefs: ['Aholo World generation: 3FO4K4XPJO6L'],
  assets: [
    {
      id: 'bright-apartment-panorama',
      kind: 'texture',
      uri: '/assets/bright-apartment-panorama.jpg',
      format: 'jpeg',
      metadata: {
        projection: 'equirectangular',
        width: 2880,
        height: 1440,
      },
    },
  ],
  entities: [
    {
      id: 'apartment-door',
      label: '返回世界之门',
      kind: 'scene-exit',
      interactive: true,
      components: {
        panoramaMarker: { yaw: 0, pitch: -8, tone: 'gold' },
        interaction: {
          title: '返回世界之门',
          copy: '这是一条真正可用的场景边。点击后回到工坊前厅，证明节点切换不依赖高斯泼溅。',
          actionLabel: '返回工坊前厅',
          targetSceneId: 'world-gate-workshop-001',
        },
      },
    },
    {
      id: 'apartment-sofa',
      label: '沙发',
      kind: 'context-object',
      interactive: true,
      components: {
        panoramaMarker: { yaw: 28, pitch: -12, tone: 'cyan' },
        interaction: {
          title: '静态背景物件',
          copy: '沙发保留在全景底图中，第一版仅提供说明热点。它不被伪装成可自由移动的 3D 模型。',
          actionLabel: '背景物件规则',
        },
      },
    },
    {
      id: 'apartment-table',
      label: '茶几',
      kind: 'inspectable-object-anchor',
      interactive: true,
      components: {
        panoramaMarker: { yaw: -4, pitch: -20, tone: 'violet' },
        interaction: {
          title: '可替换的物件锚点',
          copy: '茶几现在仍是场景视觉的一部分。后续可在这里叠加独立 GLB 或将点击行为接到物件检视舞台。',
          actionLabel: '查看物件检视策略',
        },
      },
    },
  ],
  behaviors: [
    {
      id: 'show-apartment-detail',
      name: '显示客厅热点说明',
      handler: 'show-interaction-detail',
      targetEntityIds: ['apartment-door', 'apartment-sofa', 'apartment-table'],
      trigger: { eventType: 'click', source: 'user' },
    },
  ],
  interactions: [
    {
      id: 'click-apartment-hotspot',
      inputType: 'pointer',
      eventType: 'click',
      behaviorId: 'show-apartment-detail',
    },
  ],
  environment: {
    ambience: 'quiet bright apartment',
    audio: 'not-configured',
  },
  metadata: {
    title: '明亮客厅',
    subtitle: '规则户型对照场景：用于验证普通图到全景图的最小可控路径。',
    startView: { yaw: 0, pitch: -8, zoom: 48 },
  },
};
