export const gardenSupplyShopScene = {
  schemaVersion: '1.0',
  sceneId: 'garden-supply-shop-001',
  revision: 1,
  sourceRefs: ['Original MySpace garden-market concept assets, 2026-08-28'],
  assets: [
    {
      id: 'garden-supply-shop-empty-panorama-v1',
      kind: 'texture',
      uri: '/assets/garden-supply-shop-empty-panorama-v1.png',
      format: 'png',
      metadata: {
        projection: 'equirectangular',
        width: 1774,
        height: 887,
        role: 'panorama-background',
      },
    },
    {
      id: 'garden-supply-truck-interactive-v1',
      kind: 'texture',
      uri: '/assets/garden-supply-truck-interactive-v1.png',
      format: 'png',
      metadata: {
        alpha: true,
        role: 'interactive-sprite',
      },
    },
    {
      id: 'plant-fusion-workbench-v1',
      kind: 'texture',
      uri: '/assets/shop/plant-fusion-workbench-v1.png',
      format: 'png',
      metadata: {
        alpha: true,
        role: 'interactive-sprite',
      },
    },
  ],
  entities: [
    {
      id: 'garden-supply-truck',
      label: '园艺小卡车',
      kind: 'interactive-shop',
      assetRefs: ['garden-supply-truck-interactive-v1'],
      interactive: true,
      tags: ['shop', 'seeds', 'fertilizer', 'garden-supplies'],
      components: {
        semantic: {
          category: 'shop',
          role: 'garden-supply-counter',
          abilities: ['browse-seeds', 'browse-fertilizer', 'open-shop-ui'],
        },
        // 向下落到背景的阴影带，避免悬浮在空中。
        panoramaMarker: { yaw: 24, pitch: -20, tone: 'gold' },
        panoramaSprite: {
          assetId: 'garden-supply-truck-interactive-v1',
          cssClass: 'shop-truck-sprite',
          label: '进入园艺补给小卡车',
          // HTML marker 默认是固定屏幕尺寸；显式随 PSV zoom 级别缩放，才像场景中的物件。
          scale: { zoom: [0.82, 1.86] },
        },
        interaction: {
          title: '园艺小卡车',
          copy: '小卡车是独立透明资产，叠加在空的 360° 商店底图中；它可以独立点击、替换或移动，而不是烘焙在全景背景里。',
          actionLabel: '查看补给清单',
          actionType: 'open-shop-catalog',
        },
      },
    },
    {
      id: 'plant-fusion-workbench',
      label: '植物合成台',
      kind: 'interactive-crafting-station',
      assetRefs: ['plant-fusion-workbench-v1'],
      interactive: true,
      tags: ['crafting', 'fusion', 'plant-upgrade', 'inventory'],
      components: {
        semantic: {
          category: 'crafting-station',
          role: 'plant-fusion-workbench',
          abilities: ['inspect-recipes', 'combine-plants', 'preview-upgrade-path'],
        },
        // 相对小卡车向右布置，对应商店背景中被圈出的空地。
        panoramaMarker: { yaw: -18, pitch: -21, tone: 'violet' },
        panoramaSprite: {
          assetId: 'plant-fusion-workbench-v1',
          cssClass: 'fusion-station-sprite',
          label: '打开植物合成台',
          scale: { zoom: [0.8, 1.72] },
        },
        interaction: {
          title: '植物合成台',
          copy: '三件同阶植物可以向上一阶合成。它是独立叠加在全景商店里的交互资产，后续可替换为真实 3D 合成台。',
          actionLabel: '打开合成系统',
          actionType: 'open-fusion-station',
        },
      },
    },
  ],
  behaviors: [
    {
      id: 'open-garden-supply-shop',
      name: '打开园艺小卡车补给界面',
      handler: 'show-interaction-detail',
      targetEntityIds: ['garden-supply-truck'],
      trigger: { eventType: 'click', source: 'user' },
    },
    {
      id: 'open-plant-fusion-workbench',
      name: '打开植物合成台',
      handler: 'show-interaction-detail',
      targetEntityIds: ['plant-fusion-workbench'],
      trigger: { eventType: 'click', source: 'user' },
    },
  ],
  interactions: [
    {
      id: 'click-garden-supply-truck',
      inputType: 'pointer',
      eventType: 'click',
      behaviorId: 'open-garden-supply-shop',
    },
    {
      id: 'click-plant-fusion-workbench',
      inputType: 'pointer',
      eventType: 'click',
      behaviorId: 'open-plant-fusion-workbench',
    },
  ],
  environment: {
    ambience: 'golden afternoon garden supply market',
    audio: 'not-configured',
  },
  metadata: {
    title: '园艺小卡车商店',
    subtitle: '360° 全景底图与独立交互资产分层：先搭建空间，再放入可操作的小卡车。',
    startView: { yaw: 0, pitch: -5, zoom: 48 },
  },
};
