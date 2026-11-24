# Python Vision / Gesture Compute Worker

该服务当前承载户型图服务端校验、普通装修参考图/纯文字 GPT 理解与几何校正；视频抽帧、3D 转换和手势识别仍保留在后续边界中。

## 当前闭环

- 消费 `floor-plan.validation-requested.v1` NATS 任务。
- 从 S3 兼容对象存储（本地使用 RustFS）下载对象，不信任浏览器声明的 MIME。
- 校验文件大小、PNG/JPEG/WebP 魔数、完整解码、像素上限和最小分辨率。
- 使用 OpenAI Responses API 的图片输入与严格 JSON Schema，让 GPT 区分建筑墙体、家具、纹理、文字和水印，并理解房间、门窗及真实入口。
- OpenCV 只在 GPT 指定的墙体附近吸附真实暗线，不再全图执行 Hough。
- AI 只做一个硬判断：是不是户型图。明确不是户型图才拒绝。
- 一旦判断为户型图，墙体、房间、边界和入口的不确定性只写入 diagnostics；系统用当前最佳结构继续生成米制 `StructuredFloorPlan` 和毛坯房。
- 发布进度、成功或稳定错误码；不会因几何置信度或二次审批阻断已识别的户型图。
- 独立消费 `decoration-analysis.requested.v1`；有图片时识别照片级风格与物体框，无图片时仅根据文字形成待确认的写实方案。
- 对卡通、动漫、手绘和低多边形参考图设置写实质量门；重要可选物体会标记为 Lux3D 建模候选。

## 配置

复制根目录 `.env.example` 为 `.env`，然后填写：

```dotenv
OPENAI_API_KEY=sk-...
FLOOR_PLAN_VISION_MODEL=gpt-5.6-terra
FLOOR_PLAN_REASONING_EFFORT=medium
DECORATION_VISION_MODEL=gpt-5.5
DECORATION_REASONING_EFFORT=medium
```

密钥只允许存在服务端环境或 Secret Manager，不得进入浏览器、日志或 Git。没有密钥时 Worker 会返回 `floor_plan_ai_unavailable`，不会退回旧的启发式识别并生成错误场景。

可以不启动消息队列，直接对单张真实户型图执行 GPT 回归并保存结构化结果：

```powershell
pnpm verify:floor-plan-ai -- D:\path\to\floor-plan.png
```

结果写入 `artifacts/floor-plan-ai/structured-floor-plan.json`；几何不确定性保存在其中的 diagnostics。

## 启动

```powershell
pnpm setup:compute:venv
pnpm setup:compute
pnpm dev:compute
pnpm dev:compute:decoration
```

测试：

```powershell
pnpm test:compute
```

后续增加模型 Provider 或手势能力时必须继续遵守：

- 输入输出使用版本化任务契约。
- 大文件通过对象存储 URI 交换，不进入消息正文。
- 不直接读取其他服务的数据库 schema。
- 处理器必须幂等、可超时、可重试并保留诊断证据。
- Python 只承担适合它的计算能力，不取代 TypeScript API 和场景事务层。
- 手势输出统一为 `move`、`look`、`select`、`confirm`、`exit` 等高层输入事件，浏览器不感知具体视觉模型。
- 摄像头视频默认在本地或边缘侧处理；除非用户明确授权，不保存原始画面。
