# Iteration 3 实施状态

> 状态：真实 Aholo 长任务、Viewer、Lux3D 与 Scene Service 主链已接通；RenderCloud 最终深度遮挡合成与摄像头手势服务仍待外部验收
>
> 更新时间：2026-08-29（Asia/Singapore）
>
> 当前边界：Aholo `3FO4K4XRGGEK` 已成功并确认 SPZ/LOD/全景产物可下载；浏览器 Viewer、入口漫游、碰撞、触控和 Lux3D 语义叠加已实现。浏览器 Mesh 叠加没有 3DGS 深度遮挡，不会冒充 RenderCloud 最终合成。

## 2026-08-29 Viewer 与沉浸闭环

- Aholo 装修结果不再替换锁定场景；它作为 `aholo-visual-layer` 合并进原 sceneId，保留结构实体、入口、碰撞和后续 revision。
- Viewer 读取 SPZ/PLY、原生 up-axis、LOD/全景元数据；流式显示下载量，分类资源缺失、下载失败、格式不支持、WebGL2 缺失、内存预算超限和初始化失败。
- 客户端从 3DGS 稠密中心的稳健 1%–99% 包围盒计算视觉变换，与锁定 `SpatialAnchorSet` 比较平面比例和高度；漂移超阈值明确标记“视觉层不可信”。
- 第一人称相机从锁定入口开始，WASD/方向键和移动端触控共享输入，移动受可行走边界与墙体 AABB 约束。
- 内部分析只选择最高优先级的一个 Lux3D 候选自动生成；Scene Service 尝试安全放置并执行边界、碰撞、门窗净空和主通道质量门。失败保留 taskId 和对象级重试。
- 低性能设备关闭抗锯齿/TAA，3DGS 下载设 650 MB 浏览器安全上限；真实 world `3FO4K4XRGGEK` 已复核为 `SUCCEEDED`、Z-up、SPZ、带 LOD 与全景，资源 Range 请求返回 206 且允许 CORS。

## 已确认的产品主链

普通用户不需要准备 20 张连续照片。默认流程是：选择/上传户型 → 生成米制毛坯壳体 → 上传一张普通写实参考图并用 GPT-5.5 内部提取风格、材质、负面约束和少量焦点物体，或只输入文字补充 → 确认并锁定空间 → 立即进入可交互方案并生成 Lux3D 关键家具 Mesh；Aholo 整屋写实 3DGS 作为后台增强并行运行，完成后只替换视觉层，不阻塞第一人称看房。

Aholo 仍是必要能力，但承担两类明确职责：单图 SpatialGen 写实概念/视觉层，以及专业用户使用真实连续影像进行空间重建。系统禁止让 GPT 从一张图虚构 20 张视角后冒充真实采集，因为多视角几何与相机关系不可验证。若未来需要最高质量 3DGS，可从同一个已锁定 3D 场景渲染一致、带相机参数的多视图，再在比赛规则允许时提交 Aholo。

场景采用双层真相：Aholo/RenderCloud 结果是写实视觉层；锁定壳体、Lux3D Mesh、稳定 `entityId` 和碰撞体是可交互语义层。

## 2026-08-29 Aholo 装修链路重排

- 装修参考图分析已改为内部编排结果，不再在右侧面板展示风格报告、置信度摘要或完整家具清单。
- 装修参考图分析现在允许在毛坯生成完成后、空间锁定前执行；文字补充与参考图不互斥，最终确认时会刷新内部分析并合并进 Aholo prompt。
- `/v1/housing-sessions/:sessionId/decorations` 现在会把用户 brief、锁定空间尺寸、参考图风格、PBR 材质、负面风格和“参考图只作风格、不复制全部物体”合成为 Aholo 专用 prompt。
- Aholo 输入图片不再直接使用本项目对象存储 URL；Generation Worker 会先用官方 `@manycore/aholo-sdk-asset` 上传素材，再把 Aholo 返回的公共 URL 传给 World Generation，解决“文件链接不对”的失败。
- Aholo 3DGS 在风格输入准备完成后作为可选后台增强提交；Lux3D 少量关键物体与锁定空间立即进入可交互链路，双方互不阻塞。Aholo 结果晚到时由 Scene Service 合并视觉资产，保留已装配家具与当前 revision。
- `generation.jobs` 快照新增 `providerEvidence`。即使 SSE 丢失，Web 每秒轮询也能刷新 Aholo `worldId`、原始状态和进度，避免只显示固定占位进度。
- Aholo 规则被明确为软约束：可以通过 prompt 要求忽略普通家具、禁止某些风格、保持写实，但不能当作严格几何/对象删除 API。硬约束仍由锁定空间、服务端校验、参考图预处理和 Lux3D 叠加层实现。

## 2026-08-29 卡死、重复调用与临时数据修复

- 12% 卡死不是 Shell Provider 失败，而是极快完成后 SSE 终态可能被前端漏接。`GET /v1/jobs/:jobId` 现提供统一快照，Web 每秒轮询作 SSE 的终态保障；真实浏览器回归已从 36% 户型识别进入 `shell-ready`，没有停在 12%。
- Aholo 5% 是接入失败：任务虽然被官方 API 受理，但重启会把同一内部 job 重复创建为多个 world，且 worker 表面配置 8 条、实际串行等待 1 条。现在按稳定 world 名称查询并恢复已有任务，generation worker 真正并发处理最多 8 条。
- Aholo 外部 `worldId`、`PENDING/PREPROCESSING/RUNNING`、Provider 原始进度和更新时间从第一次进度起写入 `provider.operation_evidence`；前端显示真实 Aholo 阶段与任务 ID，不再只显示无证据的固定 5%。
- 本演示采用无历史临时会话：首次进入和“更换户型”会调用 `DELETE /v1/ephemeral-state`，中止本进程内活动 Provider 等待，清空 JetStream 事件、数据库会话/job/evidence/scene/command 记录，并删除本项目 MinIO 上传图片和视频。清理期间新建入口禁用，避免清理与新上传竞态。
- 清理后的迟到 Provider 事件会被忽略，不会重新创建 scene/evidence；PostgreSQL 与 NATS 断线改为持续重连/受控记录，重复 `dev-all` 进程树已终止，只保留一套应用服务。
- 真实标注户型图回归结果：AI 判定 `decorated_floor_plan`，置信度 0.78，输出 26 面墙、11 个洞口、9 个空间；对应毛坯为 59 个实体，`sourceRefs` 指向本次上传 asset。浏览器控制台无 error。
- 修复后的真实长任务 `3FO4K4XRGGEK` 已完成：官方状态 `SUCCEEDED`，并返回可读取的 SPZ、LOD 元数据与全景产物。Viewer 主链已接入；最终比赛级画面仍需 RenderCloud 深度遮挡合成与关键视角人工写实验收。

## 2026-08-29 户型正确性修复与减负

- 户型流程现只有一个硬门：AI 明确判断不是户型图才拒绝；判断为户型图后必须生成毛坯。
- 已删除第二次 GPT 几何审批、叠加审查图、`reviewApproved/requiresUserConfirmation` 和 API 二次批准门。
- 边界、墙体或房间分区置信度不足时使用当前最佳结果补足最小结构，并把不确定性写入 diagnostics，不再拒绝已识别户型图。
- Web 已删除固定 8×6 样板毛坯、一居室隔墙和程序化沙发、茶几、地毯、花瓶、绿植、落地灯；没有真实 SceneManifest 时不再显示另一套房子，真实 Lux3D 资产返回前也不伪造可编辑家具。
- 视口相机、漫游边界和入口改为读取当前 SceneManifest/户型尺寸，不再固定在示例户型坐标。
- 工程主指南已加入强制“替换优先、净复杂度预算、禁止伪成功兜底、每次变更减负审计、删除安全门”。
- 修复新增户型几何错误码未进入共享事件契约的问题；此前非法终态会被 Projector 丢弃并使任务停在 72%。错误码现统一按稳定 `snake_case` 格式校验，避免 Python/TypeScript 枚举版本漂移，并为任何真正非法的平台事件输出可定位的结构化日志。
- 已用用户提供的彩色标注户型图真实回归：单轮 GPT 置信度 0.83，输出 27 面墙、12 个洞口、9 个房间；Shell Provider 成功形成 60 个场景实体，不再触发几何拒绝。

## 步骤 1–4

- 上传契约已改为普通 `decoration-reference-image`；单张 PNG/JPEG/WebP 与纯文字分析二选一。
- GPT 分析输出来源类型、照片级风格、色板、PBR 材质、光照、少量重要物体、归一化物体框和诊断证据；该结果服务于 Aholo prompt 与 Lux3D 候选，不作为用户侧装修报告展示。
- 卡通、动漫、手绘、低多边形和玩具质感是硬性失败；纯文字也强制生成 photorealistic 方案。
- `SpatialAnchorSet` 锁定世界坐标、米制边界、入口、可行走范围、表面和 scene revision；冲突返回 `revision_conflict`。
- Aholo World Provider 与 Aholo Viewer 已接入官方 SDK；缺 Key、鉴权、限流、超时和外部失败都有稳定错误码。
- ≥20 张连续照片或一个 MP4/MOV/INSV 被移到“专业实景采集（可选）”，不再作为普通用户前置条件。

## 步骤 5：Lux3D 单体家具建模

- 新增独立 `apps/asset-generation-service`，锁定官方 `@manycore/aholo-sdk-lux3d@1.6.0`。
- 新增 `asset-generation.requested/progressed/completed/failed.v1` 事件、任务状态和 Provider 证据契约。
- 新增 API：`POST /v1/housing-sessions/:sessionId/decoration-analyses/:analysisId/objects/:objectId/generations` 与 `GET /v1/asset-generation-jobs/:jobId`。
- 图片方案会按 GPT 物体框裁切、方形留白和 1024px 规范化，再走 Lux3D text-to-3D 的可选参考图能力，从而同时传入物体描述与强制 `photorealistic`；纯文字方案走无图 text-to-3D。
- 两条路径都固定 `G1-Turbo`、`photorealistic`、PBR、GLB；production 为 200k 面，preview 为 50k 面。
- 服务轮询真实 Lux3D task，下载 GLB，校验 GLB 2.0 结构与 POSITION bounds，计算 Y-up/米制/地面中心 pivot 的统一变换，并将源 GLB、归一化 GLB 和变换证据写入 S3/MinIO。
- 数据库迁移 `004_lux3d_asset_generation.sql` 持久化任务、外部 task ID、输出资产、变换、失败和可重试标志。
- 单体失败不会使整屋失败；API 只允许 `failed + retryable=true` 的任务创建下一 attempt，并以 `retryOfJobId` 保留失败链路。
- 已用真实参考图完成 production Lux3D 任务：内部 job `99385630-bd9e-458c-8e60-550c53b01334`，外部 task `3123218`；输出为 13,945,296 字节 GLB，1 mesh、1 PBR material，规范化 bounds 为 `[-0.9, 0, -0.4234]` 到 `[0.9, 1.0579, 0.4234]`。
- 浏览器 QA 确认结果是独立双人沙发，没有把房间背景烘焙进模型；轮廓、黑色木框与米色软包符合参考图。当前视觉局限是布料细节偏规律、材质槽只有一个，最终整屋渲染仍需复核。

## 步骤 6：Scene Service 与场景版本

- 新增独立 `apps/scene-service`，拥有 `scene_service.scenes/revisions/commands` 表，通过 NATS 投影生成完成与空间锁定事件。
- API 网关公开 `GET /v1/scenes/:id`、`POST /commands`、`POST /undo` 和 `POST /redo`；每个写请求必须携带当前 `baseRevision`。
- `ADD_ASSET` 与 `ADD_ENTITY` 可在一个命令信封内原子装配 Lux3D GLB；对象使用米制 AABB collider，并保留 Provider/task 证据和稳定 `entityId`。
- 写入前校验锁定边界、家具碰撞、门窗净空和入口至房间中心的主要动线；墙、地面、天花、门窗等结构实体禁止移动或删除。
- 服务端撤销/重做不回退 revision：apply、undo、redo 分别创建连续的新版本；新命令会使待 redo 分支失效。
- 真实联调场景 `scene-a5426577-4ad6-4d58-9225-7503ea49a48b` 已产生 revision 0–3：Lux3D 沙发装配为 revision 1，undo 为 2，redo 为 3。旧 revision 返回 409；结构修改和碰撞分别返回 422。

## 微服务边界

建议拆成 5–7 个粗粒度服务，不建议“所有函数都是微服务”：

- API/Orchestrator：会话、授权、幂等和任务创建。
- Vision Compute：户型与参考图/文字理解。
- World Generation：Aholo 空间与 3DGS。
- Asset Generation：Lux3D 裁切、生成、轮询、下载、校验、归一化。
- Scene Service：revision、命令、撤销/重做、碰撞与放置约束。
- Render Service（后续）：RenderCloud 任务、关键视角和写实验收。

初期共用一个 PostgreSQL 集群，但各服务只写自己的 schema；通过 NATS 事件和对象存储 URI 交换，不允许跨服务直接写表。不要把裁图、轮询、重试、归一化分别拆成服务。

## 已通过的本地质量门

- Python 户型/装修分析测试覆盖“非户型图拒绝、户型图低置信度仍生成、异常边界和缺失房间继续生成”。
- Lux3D Provider、GLB 归一化、Scene Core 与空间约束测试通过。
- API 网关保留 Scene Service 的 409/422 状态与诊断证据；PostgreSQL 已核对 revision 0–3 和命令状态。
- 依赖安装通过供应链检查；`sharp` 本机构建成功。
- Git 没有已跟踪文件被删除；`.workbuddy/` 未修改。

## Key 与用户准备项

- OpenAI：根目录 `.env` 中的 `OPENAI_API_KEY`，用于户型和装修理解。
- Aholo/Lux3D：同一个服务端 `AHOLO_API_KEY`，区域填 `AHOLO_REGION=cn` 或 `com`；不要发到聊天、截图或提交 Git。
- 普通演示只需一张清晰、照片级写实的装修参考图；最好能完整看见要建模的沙发、桌椅或灯具。纯文字也可运行，但物体造型一致性会低于图片输入。
- 如果家具真实尺寸很重要，准备宽/高/深或商品规格；GPT 估算只能作为待确认值。
- 只有走专业 Aholo 重建时，才需准备 ≥20 张有重叠的连续照片或一个 MP4/MOV/INSV。

## 下一验收点

进入 RenderCloud 最终合成：使用锁定场景、真实 Lux3D Mesh 和 Aholo 视觉层生成带正确深度遮挡的关键视角，完成光照融合与写实截图人工验收；同时为摄像头手势服务补齐明确授权、本地/边缘处理和不保存原始画面的可验证流程。Aholo World project ID 已有 `3FO4K4XRGGEK`，无需重复创建 world。
