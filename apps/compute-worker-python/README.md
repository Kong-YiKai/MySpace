# Python Vision / Gesture Compute Worker

该服务当前承载户型图服务端校验、GPT 视觉理解与几何校正；视频抽帧、3D 转换和手势识别仍保留在后续边界中。

## 当前闭环

- 消费 `floor-plan.validation-requested.v1` NATS 任务。
- 从 MinIO/S3 下载对象，不信任浏览器声明的 MIME。
- 校验文件大小、PNG/JPEG/WebP 魔数、完整解码、像素上限和最小分辨率。
- 使用 OpenAI Responses API 的图片输入与严格 JSON Schema，让 GPT 区分建筑墙体、家具、纹理、文字和水印，并理解房间、门窗及真实入口。
- OpenCV 只在 GPT 指定的墙体附近吸附真实暗线，不再全图执行 Hough，也不再补矩形外墙。
- 通过墙体数量、长度密度、房间面积和置信度质量门后，归一化为米制 `StructuredFloorPlan`。
- 将原图与墙体/房间/入口叠加图再次交给 GPT 复核；存在关键结构不一致时拒绝生成。
- 发布进度、成功或稳定错误码；低置信度图片不会进入毛坯生成。

## 配置

复制根目录 `.env.example` 为 `.env`，然后填写：

```dotenv
OPENAI_API_KEY=sk-...
FLOOR_PLAN_VISION_MODEL=gpt-5.6-terra
FLOOR_PLAN_REASONING_EFFORT=medium
```

密钥只允许存在服务端环境或 Secret Manager，不得进入浏览器、日志或 Git。没有密钥时 Worker 会返回 `floor_plan_ai_unavailable`，不会退回旧的启发式识别并生成错误场景。

可以不启动消息队列，直接对单张真实户型图执行两轮 GPT 回归并保存诊断产物：

```powershell
pnpm verify:floor-plan-ai -- D:\path\to\floor-plan.png
```

结果写入 `artifacts/floor-plan-ai/`；目录包含结构化户型 JSON 和发送给第二轮 GPT
审查的几何叠加图，便于定位漏墙、错墙和入口偏差。

## 启动

```powershell
pnpm setup:compute:venv
pnpm setup:compute
pnpm dev:compute
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
