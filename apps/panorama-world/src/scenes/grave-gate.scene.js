export const graveGateScene = {
  schemaVersion: '1.0',
  sceneId: 'grave-gate-001',
  revision: 1,
  sourceRefs: ['Original MySpace moonlit grave-gate panorama, 2026-08-28'],
  assets: [
    {
      id: 'grave-gate-panorama-v1',
      kind: 'texture',
      uri: '/assets/grave-gate-panorama-v1.png',
      format: 'png',
      metadata: {
        projection: 'equirectangular',
        width: 1774,
        height: 887,
        role: 'panorama-background',
      },
    },
  ],
  entities: [
    {
      id: 'grave-gate',
      label: '月夜墓园大门',
      kind: 'world-entrance',
      interactive: true,
      tags: ['entrance', 'graveyard', 'story-start'],
      components: {
        semantic: {
          category: 'world-entrance',
          role: 'adventure-start-gate',
          abilities: ['enter-garden-supply-shop'],
        },
        panoramaMarker: { yaw: 0, pitch: -11, tone: 'gold' },
        interaction: {
          title: '月夜墓园大门',
          copy: '墓园是整段冒险的入口。穿过大门后，先到园艺小卡车补给种子与肥料，再前往戴夫的 3DGS 后花园。',
          actionLabel: '进入园艺补给站',
          targetSceneId: 'garden-supply-shop-001',
        },
      },
    },
  ],
  behaviors: [
    {
      id: 'enter-garden-supply-shop',
      name: '穿过墓园大门进入补给站',
      handler: 'switch-panorama-scene',
      targetEntityIds: ['grave-gate'],
      trigger: { eventType: 'click', source: 'user' },
    },
  ],
  interactions: [
    {
      id: 'click-grave-gate',
      inputType: 'pointer',
      eventType: 'click',
      behaviorId: 'enter-garden-supply-shop',
    },
  ],
  environment: {
    ambience: 'moonlit whimsical memorial garden',
    audio: 'not-configured',
  },
  metadata: {
    title: '月夜墓园入口',
    subtitle: '从这里开始：补给、种植、合成，再到潮汐防线。',
    startView: { yaw: 0, pitch: -4, zoom: 46 },
  },
};
