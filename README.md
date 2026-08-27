# Spatial Intelligence Core

这是一个纯核心框架，不包含前端页面、示例房间、固定交互或具体渲染实现。

产品目标是把一段文字、一张图片或一段视频交给生成服务，得到结构化、可交互的真实 3D 场景；随后用户可以继续定义场景中的对象、属性、行为、事件和变化，并由运行时以可验证、可回滚的方式持续执行。

## 框架边界

框架负责：

- 统一文字、图片、视频输入为 `GenerationRequest`。
- 通过可替换 Provider 执行 3D 场景生成。
- 将生成结果规范化为通用 `SceneManifest`。
- 用白名单 `SceneCommand` 修改实体、组件、环境和行为。
- 以事务、revision、undo/redo 和事件订阅管理持续变化。
- 注册并触发用户定义的 Behavior。
- 为渲染器、生成服务和持久化提供抽象适配器。

框架不负责：

- 决定产品页面、控制面板或编辑器长什么样。
- 固定使用 React、Three.js、Unity、Unreal 或其他渲染技术。
- 假设场景一定是房间、看房、家装或任何单一行业。
- 内置任何案例对象、视觉预设或输入设备逻辑。
- 在核心包中绑定 Aholo、Lux3D 或特定模型服务。

## 核心数据流

```text
Text / Image / Video
        ↓
GenerationRequest
        ↓
GenerationPipeline → Provider Adapter
        ↓
SceneManifest（资产、实体、组件、行为、环境）
        ↓
SpatialRuntime ← SceneCommand / Behavior Trigger
        ↓
Renderer Adapter / Persistence Adapter / Event Subscribers
```

## 目录

```text
src/
  schema/       输入、Scene Manifest 和命令协议
  generation/   Provider 注册与生成管线
  runtime/      事务执行、revision、历史与事件
  behavior/     用户行为处理器注册表
  adapters/     Renderer 与 Persistence 抽象契约
  errors/       框架错误类型
  index.js      公共导出
scripts/
  check-framework.mjs
Docs/
  SpatialHome_AI_完整提案与开发交接_v0.2.docx
  Spatial_Intelligence_通用框架提案与开发交接_v0.3.docx
```

## 使用

```bash
pnpm install
pnpm test
pnpm check
```

框架目前没有 `dev` 或 `build` 页面命令，因为界面与渲染技术尚未确定。

## 扩展方式

1. 实现 Generation Provider，把某一种生成服务的输出转成 `SceneManifest`。
2. 实现 Renderer Adapter，把 Manifest 和变更记录映射到选定的 3D 引擎。
3. 注册 Behavior Handler，让用户定义的触发器产生受限命令。
4. 实现 Persistence Adapter，保存资产、Manifest、revision 与事件记录。
5. 最后再由独立应用层决定 UI、输入设备和具体商业场景。

看房只是未来可建立在该框架之上的业务案例之一，与展览、培训、零售、游戏化叙事、数字孪生等场景处于同一层级。
