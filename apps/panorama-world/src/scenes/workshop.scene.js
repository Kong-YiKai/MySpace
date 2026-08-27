export const workshopScene = {
  schemaVersion: '1.0',
  sceneId: 'world-gate-workshop-001',
  revision: 0,
  sourceRefs: ['Aholo World generation: 3FO4K4XPMJHG'],
  assets: [
    {
      id: 'workshop-panorama',
      kind: 'texture',
      uri: '/assets/workshop-panorama.jpg',
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
      id: 'portal-door',
      label: '世界之门',
      kind: 'portal',
      interactive: true,
      components: {
        panoramaMarker: { yaw: 0, pitch: -4, tone: 'gold' },
        interaction: {
          title: '世界之门',
          copy: '门后连接着预制的“明亮客厅”。点击进入第二个全景节点，过程中不需要加载高斯泼溅。',
          actionLabel: '进入明亮客厅',
          targetSceneId: 'bright-apartment-002',
        },
      },
    },
    {
      id: 'guide-anchor',
      label: '向导出现位',
      kind: 'guide-anchor',
      interactive: true,
      components: {
        panoramaMarker: { yaw: -38, pitch: -7, tone: 'cyan' },
        interaction: {
          title: '向导出现位',
          copy: '这里不是烙死在底图中的人物，而是前端可叠加的角色锚点。之后 Grokbot 可以在这里出现、移动、换表情或参与对话。',
          actionLabel: '查看角色层说明',
        },
      },
    },
    {
      id: 'workshop-caretaker',
      label: '守门人·伊恩',
      kind: 'character',
      interactive: true,
      components: {
        panoramaMarker: { yaw: 54, pitch: -12, tone: 'cyan' },
        character: {
          displayName: '守门人·伊恩',
          sprites: {
            idle: '/characters/workshop-caretaker-idle-v2.png',
            speaking: '/characters/workshop-caretaker-speaking-v2.png',
            surprised: '/characters/workshop-caretaker-surprised-v2.png',
            listening: '/characters/workshop-caretaker-listening-v2.png',
          },
          initialState: 'idle',
          availableStates: ['idle', 'speaking', 'surprised', 'listening', 'absent'],
          openingLine: '这扇门很久没有等来访客了。你想去门后的世界，还是先弄清展台为何会发光？',
        },
        interaction: {
          title: '守门人·伊恩',
          copy: '这是一个叠加在全景之上的角色资产：他有独立状态、对话与剧情变量，不被烘焙进背景。',
          actionLabel: '与守门人交谈',
        },
      },
    },
    {
      id: 'display-plinth',
      label: '可检视物件展台',
      kind: 'inspectable-object-anchor',
      interactive: true,
      components: {
        panoramaMarker: { yaw: 30, pitch: -12, tone: 'violet' },
        interaction: {
          title: '可检视物件展台',
          copy: '全景里的展台只负责提供空间语境。第一版点击后应打开独立 GLB 检视舞台，不把 3D 模型硬塞进全景底图。',
          actionLabel: '查看 3D 物件策略',
        },
      },
    },
  ],
  behaviors: [
    {
      id: 'show-interaction-detail',
      name: '显示热点说明',
      handler: 'show-interaction-detail',
      targetEntityIds: ['portal-door', 'guide-anchor', 'workshop-caretaker', 'display-plinth'],
      trigger: { eventType: 'click', source: 'user' },
    },
  ],
  interactions: [
    {
      id: 'click-panorama-hotspot',
      inputType: 'pointer',
      eventType: 'click',
      behaviorId: 'show-interaction-detail',
    },
  ],
  environment: {
    ambience: 'rainy twilight workshop',
    audio: 'not-configured',
  },
  metadata: {
    title: '世界之门前厅',
    subtitle: '一张普通场景图经 Aholo 生成的 2:1 等距柱状全景图。',
    startView: { yaw: 0, pitch: -3, zoom: 48 },
    guide: {
      name: 'Grokbot',
      greeting: '世界之门已展开。要先穿过门去客厅，还是看看这座展台？',
      hints: [
        {
          label: '带我去世界之门',
          entityId: 'portal-door',
          leadingCopy: '锁定世界之门。跟着我的视线走。',
          copy: '门后连接着明亮客厅。这个跳转是预制场景节点，不依赖高斯泼溅。',
        },
        {
          label: '看看展台',
          entityId: 'display-plinth',
          leadingCopy: '让我把视线移向展台。',
          copy: '展台目前是独立 3D 物件检视的预留锚点；全景底图本身不会假装成可移动模型。',
        },
        {
          label: '去找守门人',
          entityId: 'workshop-caretaker',
          leadingCopy: '守门人就在书桌旁。让我把视线转过去。',
          copy: '伊恩是第一位空间角色测试对象。点击他可以进入视觉小说式对话，并让他的状态随剧情变化。',
        },
      ],
    },
  },
};
