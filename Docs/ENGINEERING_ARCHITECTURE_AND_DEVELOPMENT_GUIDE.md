# 栖居：AI 看房装修模拟器工程架构与开发指南

> 状态：产品方向已敲定
>
> 当前版本：0.7
>
> 本文是当前实现与后续研发的唯一 Markdown 主方案；历史“通用 3D 平台优先、暂不做页面”的约束作废。

## 1. 产品定义

本项目是写实住宅看房与装修模拟器，不是通用场景生成产品的演示集合。普通用户的连续任务是：选择或上传户型、生成米制毛坯壳体、上传一张普通装修参考图并用 GPT-5.5 做内部风格提取、继续输入文字补充、确认并锁定空间、立即调用 Aholo 生成整屋 3DGS 视觉层、再为少量重要物体调用 Lux3D 单独建模并叠加到第一人称场景。Aholo 连续影像重建是可选专业入口，不是普通用户前置条件。

Iteration 3 的主链必须真实调用 Aholo、Lux3D 与 RenderCloud/Aholo Viewer 能力。底层仍使用可复用的场景协议和生成管线，但 Provider 抽象不能把比赛要求的真实服务降级为可有可无的示例实现。

### 1.1 产品不可妥协项

- **写实质量**：空间、材质、光照和家具必须以照片级真实感为目标。卡通、动漫、手绘、低多边形和明显游戏化资产即使技术上可加载，也不得通过质量门。
- **空间先锁定、装修后发生**：毛坯房确认后生成不可变的 `SpatialAnchorSet`，记录世界坐标系、尺度、房间范围、墙地顶、门窗、入口、禁放区和碰撞基线。装修任务只能在此约束内修改表面、照明与可移动物体，不能偷偷改变户型。
- **双层场景真相**：Aholo/RenderCloud 3DGS 是写实视觉层；锁定壳体、Lux3D Mesh、碰撞体与稳定实体 ID 是交互语义层。二者共享同一米制变换，不能让视觉结果反向覆盖结构事实。
- **重要物体必须独立**：参考图只提供风格、材质、光照和少量焦点物体候选，不向用户展示为装修报告，也不要求复制图中全部家具。确认后调用 Lux3D 单独建模，作为稳定 `entityId` 的 Mesh 放回场景，必须可拾取、可查看、可执行场景命令。
- **真实 Provider 证据**：成功和失败都要保存 Provider、外部任务 ID、输入资产哈希、阶段时间、重试次数、错误码和输出资产元数据。没有真实任务证据的模拟进度不能计入 Iteration 3 完成度。

### 1.2 当前必须成立的体验

- 初始页在模糊的空间背景上显示轻量面板。
- 用户可选“大开间”“标准一居室”，或上传自己的户型图、房屋图片、视频与 360° 全景素材。
- 无关图片、损坏图片和不支持的文件在生成前被拒绝。
- 户型/实景确认后进入同一个 3D 视口，先看到由 Aholo 重建或生成的毛坯房，并可自由旋转和检查空间范围。
- 右侧 AI 助手随场景进入而出现，默认装修需求为现代奶油风。
- 单张普通写实参考图和文字补充是装修前的明确输入；两者可以同时存在。参考图不是全景，也不能被伪造成 20 张重建素材。
- AI 分析是内部编排输入，只用于生成 Aholo prompt、负面约束和 Lux3D 候选，不作为用户侧装修报告展示。
- 装修生成阶段先提交 Aholo 生成整屋写实 3DGS 空间；Lux3D 单体家具生成是后续或并行任务，不能阻塞 3DGS 的产生和验收。
- AI 生成有可观察状态，生成完成后不跳转页面；3DGS 空间保持已锁定的尺度与边界，装修 Mesh 在同一坐标系内进入场景。
- Lux3D 生成的沙发、茶几、灯具等重要物体可点选并高亮；属性面板可查看来源和状态，并通过场景命令执行允许的修改。
- “沉浸看房”从户型入口切换第一人称视角。
- 键鼠输入是基础通道；直觉式三维手势通过独立服务转换为统一输入事件。

### 1.3 当前明确不做

- 不实现电商购买、报价、施工排期或完整 BIM 编辑。
- 不承诺浏览器端启发式校验可以替代服务端户型识别模型。
- 不在前端内嵌手势视觉模型。
- 不在框架阶段伪造真实 AI Provider 的质量、耗时或成功率。
- 不把现有预制家具、纯色材质或程序化盒体包装成“真实装修生成”。
- 不用一张二维装修效果图贴在墙面或背景上伪造可漫游的三维装修结果。
- 不为尚未确定的管理后台、账号体系和营销页面提前搭建 UI。

## 2. 体验状态机

产品必须由显式状态驱动，禁止用多组互不相干的布尔值拼接流程。

| 状态 | 主视图 | 允许操作 | 下一状态 |
| --- | --- | --- | --- |
| `layout-selection` | 模糊空间 + 输入面板 | 选预设/上传户型图；可选进入 Aholo 专业采集 | `shell-generating` / `validating-plan` |
| `validating-plan` | 上传与捕获质量反馈 | 取消、补充素材 | `shell-generating` / `layout-selection` |
| `shell-generating` | Aholo 重建/生成进度 | 查看 Provider 阶段 | `shell-ready` |
| `shell-ready` | 可旋转毛坯空间 + 空间范围 + AI 助手 | 上传一张参考图做内部风格提取、输入文字补充、确认锁定并生成 3DGS | `brief-analyzing` / `decor-generating` |
| `brief-analyzing` | 毛坯实景 | 内部提取风格、材质、负面约束和少量 Lux3D 候选 | `shell-ready` / `decor-generating` |
| `decor-generating` | 锁定空间 + Aholo 3DGS 进度 | 查看 Aholo worldId、PENDING/PREPROCESSING/RUNNING/SUCCEEDED/FAILED 与诊断证据 | `decorated` |
| `decorated` | 精装房 | 点选对象、调色、重新生成、沉浸看房 | `immersive` / `brief-analyzing` |
| `immersive` | 第一人称 | 移动、环视、退出 | `decorated` |

异常必须回到最近的可操作状态并保留用户输入。例如捕获素材不足时回到 `layout-selection`，Aholo 装修失败或 Lux3D 部分物体失败时回到 `shell-ready` 或可恢复的 `decor-generating`；不能因单个物体失败丢弃已完成的实景和其他资产。

## 3. 视觉与交互基线

- 风格：所有用户选择的装修风格都必须写实；“现代奶油风”只是默认示例，不是对色彩与风格的产品限制。
- 质量：材质遵循 PBR 语义，比例符合真实住宅尺度，纹理、法线、粗糙度、金属度和光照不得呈现卡通化或塑料玩具感。
- UI：无重边框，使用轻投影、半透明背景和适度 `backdrop-filter`。
- 场景：优先保留 Aholo 3DGS 的实景外观和空间氛围；新增 Mesh 使用环境光、PBR 材质、接触阴影和色调映射与实景融合，不能依赖一组固定灯光掩盖资产质量问题。
- 连续性：毛坯与精装共享相机和场景坐标，不通过新页面伪造“生成完成”。
- 反馈：所有异步步骤提供当前动作、进度或明确错误；按钮禁用与状态一致。
- 可访问性：表单使用原生标签，键盘可操作；降低动态效果偏好时缩短或禁用过渡。

## 4. 工程边界

```text
Web application
  ├─ Experience state machine
  ├─ Aholo Viewer integration, selection and input adapters
  └─ HTTP + SSE/WebSocket client
          │
API service
  ├─ floor-plan validation/session orchestration
  ├─ signed upload metadata
  └─ generation jobs + scene revisions
          │
NATS events / Object storage
  ├─ World generation service ─ Aholo World / SpatialGen
  ├─ Asset generation service ─ crop + Lux3D + GLB normalization
  ├─ Python vision compute ─ floor plan + image/text understanding
  ├─ Scene service ─ commands + revisions + constraints
  └─ Render service (later) ─ RenderCloud + visual QA
          │
Aholo 3DGS + Lux3D Mesh + SceneManifest + revisioned commands
```

### 4.1 `apps/web`

负责住宅体验、Aholo Viewer 集成、3DGS 与 Mesh 展示、对象选择、属性面板和输入适配。它只能使用公开 API、状态流和受控资产 URL，不直接连接数据库、NATS、MinIO 管理接口或外部 Provider。现有 React Three Fiber 视口需在 Iteration 3 迁移或收敛为 Aholo Viewer 的宿主/叠加层，避免维护两个互相漂移的场景真相。

### 4.2 `apps/api`

负责鉴权边界、幂等请求、户型会话、生成任务、场景版本和事件发布。当前已有通用生成任务 API；住宅会话接口按第 7 节逐步加入。

### 4.3 `apps/generation-worker`

消费空间生成事件，调用 Aholo World/SpatialGen 并形成 3DGS 视觉层与 `SceneManifest`。它不再承担家具资产和最终渲染的所有职责。

### 4.4 `apps/asset-generation-service`

消费 `asset-generation.*.v1`，负责物体裁切、Lux3D image-guided/text-to-3D、真实 task 轮询、GLB 下载/校验、米制与 floor-center 归一化、S3 持久化和 Provider 证据。裁图、轮询、重试、校验与归一化属于同一资产生命周期，不能继续拆成多个网络服务。

### 4.5 `apps/compute-worker-python`

承担适合 Python 的计算任务：户型图结构识别、视频抽帧、捕获质量检查、普通参考图/纯文字装修理解、重要物体检测与几何校验。它输出结构化结果，不直接修改浏览器场景。

### 4.6 `apps/scene-service`

拥有 `scene_service` 数据库 schema，消费 `generation.completed` 与 `scene.constraints-locked` 投影，原子执行命令信封、空间质量门、revision 乐观并发和服务端撤销/重做。API 服务只做代理，不跨边界直接写 Scene Service 表。

### 4.7 `packages/spatial-core`

继续表达资产、实体、组件、行为、命令与场景版本。住宅对象通过实体 `kind`、标签和组件表达，不为每一种家具修改核心 Schema。

### 4.8 `packages/contracts`

保存跨进程稳定契约，包括：

- `HousingLayoutSource`
- `HousingExperienceStage`
- `DecorationRequest`
- `GenerationRequest` / `GenerationJob`
- 版本化平台事件与命令信封

### 4.9 微服务拆分原则

本项目可以采用微服务，但按业务所有权拆分，而不是按函数或供应商 endpoint 拆分。Iteration 3 控制在 API/Orchestrator、Vision Compute、World Generation、Asset Generation、Scene、Render 六个粗粒度边界；初期共用 PostgreSQL 集群、NATS 与对象存储，但分别拥有 schema，禁止跨服务直接写表。只有当一个边界需要独立扩缩容、故障隔离或不同运行时，才值得成为服务。一个模型一个服务、裁图一个服务、轮询一个服务、重试一个服务会增加分布式事务与诊断成本，明确不采用。

## 5. 实景输入、毛坯生成与空间锁定

### 5.1 预设户型

预设只用于快速进入体验，不是静态截图。每个预设最终应映射为结构化的门、墙、窗、地面和入口位置，并提交 Aholo AI 空间生成，获得可真实浏览的毛坯结果。程序化几何只用于碰撞、约束、加载占位和故障诊断，不作为最终可见实景。

### 5.2 上传户型图

处理顺序：

1. 浏览器只检查 MIME、大小和能否解码。
2. API 发放签名 URL，原文件上传对象存储。
3. Vision Worker 调用一次 GPT：先判断是不是户型图，同时提取房间、墙体、门窗和入口。
4. 明确不是户型图才拒绝；一旦判断为户型图，几何不确定性只记录为 warnings，不能阻止生成。
5. 本地阶段吸附墙线并补足最小可生成结构，输出 `StructuredFloorPlan` 后立即创建毛坯任务。

规则只有两条：不是户型图则拒绝；是户型图则必须生成。低置信度结果可以使用图像范围或最小外轮廓继续构建，但必须保留 warnings，且不得偷偷切换到预设户型。SceneManifest 的 `metadata.floorPlan` 必须来自本次上传资产，前端只渲染该 Manifest。

### 5.3 图片、视频与 360° 实景输入

这是专业可选路径，不是普通用户的默认输入。Aholo 单图 SpatialGen 可以承担风格概念/视觉生成，但单张普通室内图不能作为真实多视角空间重建证据。

1. 客户上传同一房屋的图片序列、视频或 360° 视频；服务端完成格式、时长、清晰度、覆盖率和隐私检查。
2. Generation Worker 通过 Aholo Asset/World SDK 上传素材并创建空间重建任务。
3. 完成后保存 3DGS 原始资产、适合交付的压缩格式、相机/项目元数据和外部任务 ID。
4. 计算可行走区域、地面、墙面、入口、遮挡和碰撞代理，并与户型结构（若有）对齐。
5. 低覆盖、尺度异常、漂浮伪影或不可形成闭合可行走区域时进入人工确认/补拍流程，不得自动宣布成功。

### 5.4 空间锁定

毛坯确认产生 `SpatialAnchorSet` 和 `shellRevision`。它们是装修阶段的只读基线，至少包含：

- 世界坐标系、米制尺度、轴向和原点；
- 房间/区域边界、墙地顶表面、门窗洞口与入口相机锚点；
- 可行走区域、不可穿越碰撞体、家具禁放区和安全间距；
- Aholo 世界/项目 ID、3DGS 资产版本、内容哈希和质量 diagnostics。

任何装修输出都必须与该基线比较。超过容差的墙体漂移、门窗遮挡、尺度变化或可行走区域破坏必须阻止发布，而不是用新场景覆盖原场景。

客户端校验不是安全或质量边界。服务端必须重新验证文件签名、解码结果与模型置信度。

### 5.5 禁止伪造多视角

不得让 GPT 从一张参考图独立补出 20 张图片后提交 Aholo 重建：这些图片通常不共享可验证几何、相机内外参和遮挡关系，会把视觉幻觉固化为错误户型。可接受的高质量替代是先完成锁定户型、语义 Mesh 与材质场景，再由 RenderCloud 从同一个 3D 场景输出 20–60 张一致且带相机参数的视图；仅在 Aholo 服务条款与比赛规则允许渲染输入时，将其作为最终 3DGS 精炼路径。

## 6. 写实装修、重要物体建模与局部修改

装修请求由结构化字段与自然语言共同构成：户型会话、锁定的 `shellRevision`、装修 brief、零或一张普通写实参考图、负面风格约束和质量等级。生成结果必须保持原空间结构与实体 ID 稳定。

### 6.1 Provider 主链

1. **单图/文字理解**：Vision Worker 从一张普通参考图提取风格、主材、光照、布局关系、负面 prompt 和最多 0-3 个重要物体候选；无图片时只基于文字形成待确认候选，不声称看见不存在的证据。该结果是内部编排数据，不在主 UI 当作装修报告展示。
2. **Aholo 整屋 3DGS 视觉层**：API 将锁定空间、用户 brief、参考图风格、负面约束和“参考图只作风格，不复制全部物体”的规则合成为 Aholo prompt，Generation Worker 立即调用 Aholo `generations.create`。这一步不等待 Lux3D，成功后即可得到整屋写实 3DGS 视觉层。
3. **重要物体单体化**：Asset Generation Service 对被确认的图片候选执行裁切和方形规范化后，使用 Lux3D text-to-3D 的可选 `img` 参考能力，因此图像、物体 prompt 与 `photorealistic` 可同时生效；文字候选走无图 text-to-3D。两者固定 PBR、GLB，不得使用 cartoon、anime、hand-painted 等风格。
4. **资产归一化**：下载并持久化 GLB/必要导出，统一米制尺度、轴向、原点、PBR 材质、纹理色彩空间、LOD、包围盒、碰撞体和资产许可证/来源元数据。
5. **场景装配**：按照单图/文字方案得到的关系与锁定空间约束放置 Mesh；穿墙、遮门、离地、重叠、阻断主要动线或尺度异常必须自动修正或拒绝。
6. **写实合成**：RenderCloud/Aholo Viewer 将已完成的 Aholo 3DGS 空间与已返回的 Lux3D 高保真 Mesh 同帧合成。Lux3D 未完成时，Viewer 仍可先进入 3DGS 空间；关键 Mesh 返回后再叠加、拾取、查看和修改。

Lux3D 失败不应导致整屋重建。每个重要物体都有独立子任务和状态；已成功的对象可先展示，失败对象显示证据、允许针对该对象重试或更换参考图。

### 6.1.1 Aholo 规则边界

Aholo 单图生成可以接收 prompt，因此可以设置软规则：参考图只作风格、忽略图中普通家具、禁止卡通/动漫/手绘/低多边形、保持住宅尺度、不要人物/水印/文字等。这些规则会进入服务端合成的 Aholo prompt，并随 `generation.requested` 保存。

这些规则不是几何硬约束。公开 API 没有提供“按户型 JSON 强制生成”“mask 掉床”“指定某个物体绝不出现”“逐墙体坐标锁定”的强控制参数。需要硬约束时由本项目完成：锁定 `SpatialAnchorSet`、服务端校验空间漂移、参考图预处理/裁剪/遮罩、以及 Lux3D 单体 Mesh 后置叠加。

### 6.2 写实质量门

- 自动检查尺寸范围、面数/LOD、纹理分辨率、PBR 通道、透明度异常、法线、悬浮、穿模和光照融合。
- 视觉审核比较普通参考图与关键视角渲染，重点检查材质、轮廓、比例、颜色和空间关系，而不是只判断“文件能打开”。
- 禁止使用旧预制家具替代 Lux3D 失败结果并静默标记成功；降级必须对用户和诊断记录可见。
- 发布前至少通过一个轨道漫游视角和一个第一人称入口视角的写实截图验收。

### 6.3 场景命令

点选物体后的修改走场景命令，不触发整屋重建：

```json
{
  "commandId": "cmd_...",
  "baseRevision": 7,
  "commands": [
    {
      "type": "SET_COMPONENT",
      "entityId": "sofa_01",
      "component": "appearance",
      "value": { "color": "#C9B7A5" }
    }
  ],
  "explanation": "调整已选沙发颜色"
}
```

服务端校验 `baseRevision`，原子提交新 revision，并通过事件或 WebSocket 广播变更。客户端乐观更新失败时必须回滚。

撤销/重做不是前端本地数组：服务端为每条已接受命令保存可逆变更或逆命令，并以当前 revision 为条件创建新 revision。发生 `revision_conflict` 时返回当前 revision 与最小差异摘要，客户端刷新后由用户重放，不得静默覆盖远端修改。

## 7. 目标 API

当前通用 `/v1/generation-jobs` 保留为底层任务 API。住宅应用层逐步补齐：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/assets/upload-intents` | 获取户型图/参考素材上传授权 |
| `POST` | `/v1/floor-plans/validate` | 校验并结构化户型图 |
| `POST` | `/v1/housing-sessions` | 从预设或上传户型创建会话 |
| `GET` | `/v1/housing-sessions/:id` | 恢复状态与当前场景版本 |
| `POST` | `/v1/housing-sessions/:id/reconstructions` | 提交 Aholo 毛坯空间重建/生成任务 |
| `POST` | `/v1/housing-sessions/:id/shell-lock` | 验收并锁定空间锚点与 shell revision |
| `POST` | `/v1/housing-sessions/:id/decoration-analyses` | 分析一张普通参考图或纯文字需求 |
| `POST` | `/v1/housing-sessions/:id/decorations` | 提交装修生成请求 |
| `POST` | `/v1/housing-sessions/:sessionId/decoration-analyses/:analysisId/objects/:objectId/generations` | 提交单个 Lux3D 建模任务 |
| `GET` | `/v1/asset-generation-jobs/:jobId` | 查看 Lux3D、下载、校验和归一化状态 |
| `GET` | `/v1/asset-generation-jobs/:jobId/artifacts/:artifact` | 获取 source/normalized GLB 的短期下载 URL |
| `POST` | `/v1/asset-generation-jobs/:jobId/retry` | 仅对标记为可重试的失败创建下一 attempt |
| `GET` | `/v1/scenes/:id` | 读取当前 SceneManifest、revision 与锁定空间锚点 |
| `POST` | `/v1/scenes/:id/commands` | 修改单个场景对象 |
| `POST` | `/v1/scenes/:id/undo` | 基于当前 revision 撤销一条已提交命令 |
| `POST` | `/v1/scenes/:id/redo` | 基于当前 revision 重做一条已撤销命令 |
| `GET` | `/v1/jobs/:id/diagnostics` | 获取脱敏后的 Provider 阶段、重试和证据摘要 |
| `GET` | `/v1/jobs/:id/events` | SSE 获取分析/生成进度 |

错误统一使用稳定代码，例如 `unsupported_file`、`floor_plan_not_detected`、`low_plan_confidence`、`generation_failed`、`revision_conflict`。

## 8. 沉浸看房与手势服务

第一人称模式必须使用锁定空间中的真实入口锚点初始化相机。Aholo Viewer 的 3DGS 场景使用体素或 Mesh 碰撞代理执行射线、胶囊、地面和墙体查询；Lux3D Mesh 使用归一化碰撞体。视觉数据与碰撞数据必须共享变换，不能出现“看见墙却能穿过”的坐标漂移。基础输入映射：

| 意图 | 键鼠 | 手势服务事件 |
| --- | --- | --- |
| 移动 | WASD / 方向键 | `move` |
| 环视 | 鼠标拖动 | `look` |
| 选择 | 单击 | `select` |
| 确认 | Enter | `confirm` |
| 退出 | Esc / 按钮 | `exit` |

手势微服务只产生归一化事件：`sessionId`、`type`、`vector/value`、`confidence`、`timestamp`。Web 输入层再把键鼠、触摸和手势统一映射到相机/交互命令。摄像头画面默认本地或边缘处理，原始视频不进入业务事件。

## 9. 数据与可靠性

- 当前比赛演示运行在 **ephemeral / 无历史模式**：数据只在一次看房会话内存在；首次进入或用户返回户型选择页时，统一清理 PostgreSQL 会话、任务、场景版本、命令、Outbox、Provider 证据，删除本项目 MinIO/S3 临时上传与产物，并 purge NATS JetStream 事件。不得依靠历史结果、旧 scene 或旧 asset 完成新会话。
- 清理先发出进程内 Provider 取消信号，再释放活动消息；迟到事件必须检查内部 job 仍存在才能投影，不能在清理后复活 scene/evidence。清理未完成前 Web 禁止新上传或新建任务。
- 如未来上线需要审计留存，必须以显式 deployment policy、租户隔离和 TTL 重新启用；不能在当前演示路径暗中保留历史。
- NATS JetStream 传递版本化任务事件，Worker 必须真正并发且有明确上限；配置 `max_messages` 不等于并发，消费循环不得在单个长时 Provider 轮询上串行阻塞。
- 创建任务必须带幂等键；Worker 采用至少一次投递语义并保证处理幂等。
- 场景命令使用乐观并发；冲突不得静默覆盖。
- 上传使用短期签名 URL、大小限制、MIME 白名单与服务端文件签名检查。
- Provider 密钥仅存在服务端或 Secret Manager。
- 每个 Aholo/Lux3D/RenderCloud 请求在活动会话内都保存内部 job 与外部 task/project 的映射；外部任务受理后第一条进度就必须落证据，回调、轮询与进程重启必须幂等，禁止因至少一次投递重复创建云任务。
- 重试区分可重试错误（限流、超时、临时服务异常）和永久错误（素材无效、质量门失败、授权失败），采用上限明确的退避策略。
- 对用户展示的 diagnostics 必须脱敏；API Key、Provider 原始授权头和未签名私有 URL 不得进入日志或前端。

## 10. 实施阶段

### Iteration 1：连续体验骨架（已完成）

- 可运行的户型选择/上传界面。
- 毛坯与精装共享的 3D 场景。
- 显式状态机、模拟分析/生成进度。
- 对象点选与配色修改。
- 第一人称键鼠漫游。
- 更新契约、文档和测试。

退出门禁：`pnpm test`、`pnpm typecheck`、`pnpm build` 全部通过；主流程可在桌面浏览器完成；无关图片有明确拒绝反馈。

### Iteration 2：真实户型任务闭环（已完成）

- 签名上传、服务端文件校验与户型识别 Worker。
- 住宅会话 API、PostgreSQL Repository 与 Outbox。
- SSE/WS 代替前端计时模拟。
- 预设和上传户型统一生成毛坯 `SceneManifest`。

当前实现使用 PostgreSQL 事务 Outbox、NATS JetStream、MinIO/S3 签名 PUT、OpenAI Responses API 视觉理解、Python OpenCV 局部墙线吸附和 Fastify SSE。GPT 输出受严格 JSON Schema 约束；户型分类是唯一生成门槛，几何质量问题降级为 warnings。识别结果归一化为 `StructuredFloorPlan`，再由 `shell-provider` 统一生成场景实体；估算比例必须保留 diagnostics。

### Iteration 3：真实装修与场景版本

- 接入 Aholo Asset/World：图片、视频或 360° 素材上传，真实毛坯空间重建/生成，任务状态与结果持久化。
- 接入 Aholo Viewer：浏览器加载 3DGS，建立入口、相机、拾取、LOD 与体素/Mesh 碰撞验证。
- 毛坯验收后创建 `SpatialAnchorSet` 并锁定 `shellRevision`；所有装修候选必须通过空间保持质量门。
- 支持一张普通写实参考图或纯文字，输出风格/材质/布局分析和重要物体候选；不要求普通用户提供全景或 20 张照片。
- 接入 Lux3D image-guided/text-to-3D，为重要家具/物体生成 photorealistic、PBR、独立 GLB；资产微服务已完成裁切、真实任务适配、GLB 校验和米制变换。
- 接入 RenderCloud/Aholo 云渲染链路，将 3DGS 实景与高保真 Mesh 同帧合成并回传可第一人称观看的结果；浏览器直渲作为受控降级路径。
- Scene Service 已实现场景命令 API、revision 冲突、服务端撤销/重做、资产/实体原子装配、边界/碰撞/门窗净空/主通道约束；结构锚点不可由普通装修命令修改。
- 实现 Aholo、Lux3D、RenderCloud 的真实失败分类、幂等重试、部分成功和诊断证据。

退出门禁：演示链必须产生可核对的真实 Provider task/project ID；装修前后空间锚点在规定容差内一致；至少一个从单图识别或文字确认的重要物体由 Lux3D 生成并可在第一人称场景中选中；最终视图通过写实质量审核；主动注入一次 Provider 失败后可恢复且证据完整。预制家具或 Fake Provider 不能满足此门禁。

### Iteration 4：沉浸交互增强

- 入口锚点、锁定墙体/边界碰撞、房间导航和移动端触控已完成基础闭环。
- 3DGS 流式加载、650 MB 浏览器安全预算、WebGL2 诊断与低性能抗锯齿/TAA 降级已完成。
- 摄像头手势计算服务与显式权限/隐私流程仍待实现；键鼠或触控不能作为该项验收证据。

## 11. 开发规则

- 新功能必须落在上述产品状态机或明确服务边界内。
- 不新增与当前工作流无关的页面、仪表盘或行业案例。
- **替换优先而非叠加覆盖**：修改功能前必须先定位现有唯一 owner；能改原实现就不新增平行的 `v2`、adapter、组件、状态或兼容分支。新实现接管后，同一变更中必须删除旧入口、旧状态、旧测试、旧样式和死依赖，不得以“以后清理”为完成条件。
- **净复杂度预算**：普通功能替换在所触及模块内默认净代码行数不得增长。确需增长时，变更说明必须逐项写明新增职责、无法复用的原因和本次同步删除的债务；没有说明即不得合并。新增微服务、依赖、目录或跨进程契约必须有独立扩缩容、故障隔离或运行时差异的硬依据。
- **不偷换输入**：上传户型只能生成本次图片提取的结构，不能切换成预设户型、固定家具、Fake Provider 或旧缓存；几何估算允许继续生成，但必须留下 warnings。
- **每次变更必须做减负审计**：提交前用引用搜索确认旧路径是否仍被调用，报告新增/删除行数、删除的文件/依赖/分支及仍保留原因；无引用代码、重复契约、失效 feature flag、过期迁移脚本和被替代文档必须在安全验证后删除。
- **删除安全门**：删除前用 `rg`、依赖图和测试确认真实引用，区分源码、生成物、包管理器真实包目录与用户文件；不得把 `.pnpm`、对象存储、数据库卷或工作区配置当缓存误删。删除后运行受影响测试、类型检查并核对 `git diff --stat`。
- 通用场景核心保持行业无关，住宅语义停留在应用层和组件数据中。
- 所有跨进程输入先经过共享契约解析。
- Aholo、Lux3D 和 RenderCloud 通过各自 adapter 接入，但作为本产品 Iteration 3 的固定编排链；`ProviderRegistry` 只隔离外部契约，不改变产品必需能力。
- Provider 能力、请求字段和输出格式以官方 API/SDK 文档为准，不凭示例 UI 或猜测实现。
- 变更至少运行受影响测试与类型检查；渲染变更还要做浏览器截图和主流程验证。

## 12. 完成定义

一个功能只有同时满足以下条件才算完成：用户状态可解释、失败可恢复、契约已验证、无敏感信息泄漏、测试通过、文档与真实实现一致，并完成第 11 节减负审计。涉及生成的功能还必须有真实 Provider 任务证据、空间一致性证据和写实视觉验收。展示性的“看起来完成”、二维贴图替代、预制家具替代或 Fake Provider 不能替代真实边界和状态。

## 13. Provider 官方依据

- [Aholo Open API：空间/物体重建、图片/视频/360° 输入与 AI Spatial Gen](https://studio.aholo3d.com/solution/openapi)
- [Aholo Spatial SDK：Asset、World、Lux3D SDK 与服务端鉴权](https://github.com/manycoretech/aholo-spatial-sdk)
- [Aholo Viewer：3DGS/Mesh、LOD、拾取、碰撞与云渲染](https://aholojs.dev/en-US/)
- [Lux3D 官方 ComfyUI 集成：image-to-3D、photorealistic/PBR、GLB 与多格式导出](https://github.com/manycore-research/ComfyUI-Lux3D)

具体 endpoint、枚举和配额在开发时从官方 API 文档锁定版本；本指南只定义产品职责与不可绕过的质量门，不复制可能变化的外部字段。
