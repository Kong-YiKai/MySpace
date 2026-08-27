# 栖居：AI 看房装修模拟器工程架构与开发指南

> 状态：产品方向已敲定
>
> 当前版本：0.4
>
> 本文是当前实现与后续研发的唯一 Markdown 主方案；历史“通用 3D 平台优先、暂不做页面”的约束作废。

## 1. 产品定义

本项目是住宅看房与装修模拟器，不是通用场景生成产品的演示集合。用户要完成的是一条连续任务：确定户型、查看毛坯空间、描述装修需求、修改局部对象、进入房屋漫游。

底层仍使用可复用的场景协议和生成管线，但它们服务于当前住宅产品，而不是推迟产品实现的理由。

### 1.1 当前必须成立的体验

- 初始页在模糊的空间背景上显示轻量面板。
- 用户可选“大开间”“标准一居室”，或上传自己的户型图。
- 无关图片、损坏图片和不支持的文件在生成前被拒绝。
- 户型确认后进入同一个 3D 视口，先看到毛坯房，并可自由旋转。
- 右侧 AI 助手随场景进入而出现，默认装修需求为现代奶油风。
- “墙纸”是装修前的明确输入，不隐藏在泛化提示词里。
- AI 分析和生成有可观察状态，生成完成后不跳转页面，只让家具进入现有空间。
- 沙发、茶几、地毯、花瓶、绿植和落地灯可点选并高亮；属性面板可调整低饱和度颜色。
- “沉浸看房”从户型入口切换第一人称视角。
- 键鼠输入是基础通道；直觉式三维手势通过独立服务转换为统一输入事件。

### 1.2 当前明确不做

- 不实现电商购买、报价、施工排期或完整 BIM 编辑。
- 不承诺浏览器端启发式校验可以替代服务端户型识别模型。
- 不在前端内嵌手势视觉模型。
- 不在框架阶段伪造真实 AI Provider 的质量、耗时或成功率。
- 不为尚未确定的管理后台、账号体系和营销页面提前搭建 UI。

## 2. 体验状态机

产品必须由显式状态驱动，禁止用多组互不相干的布尔值拼接流程。

| 状态 | 主视图 | 允许操作 | 下一状态 |
| --- | --- | --- | --- |
| `layout-selection` | 模糊空间 + 户型面板 | 选预设、上传户型图 | `shell-generating` / `validating-plan` |
| `validating-plan` | 上传反馈 | 取消 | `shell-generating` / `layout-selection` |
| `shell-generating` | 毛坯轮廓与进度 | 查看状态 | `shell-ready` |
| `shell-ready` | 可旋转毛坯房 + AI 助手 | 选墙纸、输入需求 | `brief-analyzing` |
| `brief-analyzing` | 原毛坯房 | 查看分析状态 | `decor-generating` |
| `decor-generating` | 家具渐入 | 查看进度 | `decorated` |
| `decorated` | 精装房 | 点选对象、调色、重新生成、沉浸看房 | `immersive` / `brief-analyzing` |
| `immersive` | 第一人称 | 移动、环视、退出 | `decorated` |

异常必须回到最近的可操作状态并保留用户输入。例如户型图校验失败回到 `layout-selection`，装修生成失败回到 `shell-ready`。

## 3. 视觉与交互基线

- 色彩：奶油白、燕麦色、暖灰、柔和橙、低饱和绿；高明度、低对比。
- UI：无重边框，使用轻投影、半透明背景和适度 `backdrop-filter`。
- 场景：`AmbientLight` 提供柔和底光，平行光负责软阴影，浅暖色 `Fog` 拉开空间层次。
- 连续性：毛坯与精装共享相机和场景坐标，不通过新页面伪造“生成完成”。
- 反馈：所有异步步骤提供当前动作、进度或明确错误；按钮禁用与状态一致。
- 可访问性：表单使用原生标签，键盘可操作；降低动态效果偏好时缩短或禁用过渡。

## 4. 工程边界

```text
Web application
  ├─ Experience state machine
  ├─ Three.js renderer and input adapters
  └─ HTTP + SSE/WebSocket client
          │
API service
  ├─ floor-plan validation/session orchestration
  ├─ signed upload metadata
  └─ generation jobs + scene revisions
          │
NATS events / Object storage
  ├─ TypeScript generation worker
  └─ Python vision & gesture compute worker
          │
SceneManifest + revisioned commands
```

### 4.1 `apps/web`

负责住宅体验、渲染、对象选择、属性面板和输入适配。它只能使用公开 API、状态流和受控资产 URL，不直接连接数据库、NATS、MinIO 管理接口或外部 Provider。

### 4.2 `apps/api`

负责鉴权边界、幂等请求、户型会话、生成任务、场景版本和事件发布。当前已有通用生成任务 API；住宅会话接口按第 7 节逐步加入。

### 4.3 `apps/generation-worker`

消费版本化生成事件，调用 Provider，归一化输出并形成 `SceneManifest`。外部服务的私有字段和临时 URL 不得泄漏到前端。

### 4.4 `apps/compute-worker-python`

承担适合 Python 的计算任务：户型图结构识别、视频抽帧、几何恢复、模型推理和手势追踪。手势服务输出高层事件，不直接修改 Three.js 场景。

### 4.5 `packages/spatial-core`

继续表达资产、实体、组件、行为、命令与场景版本。住宅对象通过实体 `kind`、标签和组件表达，不为每一种家具修改核心 Schema。

### 4.6 `packages/contracts`

保存跨进程稳定契约，包括：

- `HousingLayoutSource`
- `HousingExperienceStage`
- `WallpaperPreset`
- `DecorationRequest`
- `GenerationRequest` / `GenerationJob`
- 版本化平台事件与命令信封

## 5. 户型输入与毛坯生成

### 5.1 预设户型

预设只用于快速进入体验，不是静态截图。每个预设最终应映射为结构化的门、墙、窗、地面和入口位置，并可生成 `SceneManifest`。

### 5.2 上传户型图

处理顺序：

1. 浏览器检查 MIME、大小、能否解码和基础结构特征，快速拒绝明显无关内容。
2. API 发放签名 URL，原文件上传对象存储。
3. Vision Worker 识别墙线、门窗、房间分区、比例与置信度。
4. 低置信度或无关图片返回可解释错误，不创建 3D 任务。
5. 合格结果转换为结构化平面，再生成毛坯 `SceneManifest`。

客户端校验不是安全或质量边界。服务端必须重新验证文件签名、解码结果与模型置信度。

## 6. 装修生成与局部修改

装修请求由结构化字段与自然语言共同构成：户型会话、装修 brief、墙纸、参考素材和质量等级。生成结果必须保持原空间结构与实体 ID 稳定，家具只作为新实体或组件变化进入当前场景。

点选物体后的修改走场景命令，不触发整屋重建：

```json
{
  "commandId": "cmd_...",
  "sceneId": "scene_...",
  "baseRevision": 7,
  "command": "SET_COMPONENT",
  "payload": {
    "entityId": "sofa_01",
    "component": "appearance",
    "value": { "color": "#C9B7A5" }
  }
}
```

服务端校验 `baseRevision`，原子提交新 revision，并通过事件或 WebSocket 广播变更。客户端乐观更新失败时必须回滚。

## 7. 目标 API

当前通用 `/v1/generation-jobs` 保留为底层任务 API。住宅应用层逐步补齐：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/assets/upload-intents` | 获取户型图/参考素材上传授权 |
| `POST` | `/v1/floor-plans/validate` | 校验并结构化户型图 |
| `POST` | `/v1/housing-sessions` | 从预设或上传户型创建会话 |
| `GET` | `/v1/housing-sessions/:id` | 恢复状态与当前场景版本 |
| `POST` | `/v1/housing-sessions/:id/decorations` | 提交装修生成请求 |
| `POST` | `/v1/scenes/:id/commands` | 修改单个场景对象 |
| `GET` | `/v1/jobs/:id/events` | SSE 获取分析/生成进度 |

错误统一使用稳定代码，例如 `unsupported_file`、`floor_plan_not_detected`、`low_plan_confidence`、`generation_failed`、`revision_conflict`。

## 8. 沉浸看房与手势服务

第一人称模式必须使用户型入口锚点初始化相机。基础输入映射：

| 意图 | 键鼠 | 手势服务事件 |
| --- | --- | --- |
| 移动 | WASD / 方向键 | `move` |
| 环视 | 鼠标拖动 | `look` |
| 选择 | 单击 | `select` |
| 确认 | Enter | `confirm` |
| 退出 | Esc / 按钮 | `exit` |

手势微服务只产生归一化事件：`sessionId`、`type`、`vector/value`、`confidence`、`timestamp`。Web 输入层再把键鼠、触摸和手势统一映射到相机/交互命令。摄像头画面默认本地或边缘处理，原始视频不进入业务事件。

## 9. 数据与可靠性

- PostgreSQL 保存会话、任务、场景 revision、命令和 Outbox。
- MinIO/S3 保存户型图、参考素材、模型、贴图和诊断证据。
- NATS JetStream 传递版本化任务事件。
- 创建任务必须带幂等键；Worker 采用至少一次投递语义并保证处理幂等。
- 场景命令使用乐观并发；冲突不得静默覆盖。
- 上传使用短期签名 URL、大小限制、MIME 白名单与服务端文件签名检查。
- Provider 密钥仅存在服务端或 Secret Manager。

## 10. 实施阶段

### Iteration 1：连续体验骨架（当前）

- 可运行的户型选择/上传界面。
- 毛坯与精装共享的 3D 场景。
- 显式状态机、模拟分析/生成进度。
- 墙纸选择、对象点选与配色修改。
- 第一人称键鼠漫游。
- 更新契约、文档和测试。

退出门禁：`pnpm test`、`pnpm typecheck`、`pnpm build` 全部通过；主流程可在桌面浏览器完成；无关图片有明确拒绝反馈。

### Iteration 2：真实户型任务闭环

- 签名上传、服务端文件校验与户型识别 Worker。
- 住宅会话 API、PostgreSQL Repository 与 Outbox。
- SSE/WS 代替前端计时模拟。
- 预设和上传户型统一生成毛坯 `SceneManifest`。

### Iteration 3：真实装修与场景版本

- 接入首个装修/资产 Provider。
- 家具资产归一化、碰撞与空间约束。
- 场景命令 API、revision 冲突和撤销/重做。
- 真实生成失败、重试和诊断证据。

### Iteration 4：沉浸交互增强

- 入口锚点、碰撞、房间导航和移动端触控。
- 手势计算服务试点与权限/隐私流程。
- 性能预算、渐进加载和低性能降级。

## 11. 开发规则

- 新功能必须落在上述产品状态机或明确服务边界内。
- 不新增与当前工作流无关的页面、仪表盘或行业案例。
- 不用新增文件覆盖旧方案；过时描述直接删除或改写。
- 通用场景核心保持行业无关，住宅语义停留在应用层和组件数据中。
- 所有跨进程输入先经过共享契约解析。
- 变更至少运行受影响测试与类型检查；渲染变更还要做浏览器截图和主流程验证。

## 12. 完成定义

一个功能只有同时满足以下条件才算完成：用户状态可解释、失败可恢复、契约已验证、无敏感信息泄漏、测试通过、文档与真实实现一致。展示性的“看起来完成”不能替代真实边界和状态。
