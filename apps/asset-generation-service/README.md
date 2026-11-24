# Lux3D Asset Generation Service

该微服务拥有“重要单体家具从候选到可装配 GLB”的完整生命周期。它消费 `asset-generation.requested.v1`，调用官方 `@manycore/aholo-sdk-lux3d@1.6.0`，并发布进度、完成或失败事件。

## 职责

- 单图候选：下载普通装修参考图，按 GPT 归一化物体框裁切，补成 1024×1024 干净输入，再调用支持可选参考图的 text-to-3D，以同时保留图像、描述和 `photorealistic` 风格约束。
- 纯文字候选：调用 text-to-3D，并固定 `style=photorealistic`。
- 两条路径固定 `G1-Turbo`、PBR、GLB；production 200k 面，preview 50k 面。
- 保存真实 Lux3D task ID，轮询最长 15 分钟，分类缺 Key、鉴权、限流、超时、输出缺失与文件失败。
- 下载并校验 GLB 2.0、POSITION bounds 和 PBR 材质证据；计算 Y-up、米制、right-handed、floor-center pivot 的场景变换。
- 将源 GLB、规范化 GLB 和 `normalization.json` 写入 S3 兼容对象存储（本地使用 RustFS）。

这里的“规范化 GLB”保留 Provider 原始二进制，标准尺度与 pivot 以伴随变换应用；这样不破坏 PBR、动画或扩展。后续 Scene Service 读取该变换生成碰撞体并放置实体。

## 配置

```dotenv
AHOLO_API_KEY=
AHOLO_REGION=cn
LUX3D_POLL_INTERVAL_MS=5000
LUX3D_POLL_TIMEOUT_MS=900000
```

Lux3D 官方 SDK 与 Aholo World SDK 使用同一个 `AHOLO_API_KEY`。Key 只能放在根目录本地 `.env` 或 Secret Manager，不得进入前端、日志或 Git。

## 开发命令

```powershell
pnpm dev:assets
pnpm --filter @spatial-intelligence/asset-generation-service test
pnpm --filter @spatial-intelligence/asset-generation-service typecheck
```
