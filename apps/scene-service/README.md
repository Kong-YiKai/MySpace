# Scene Service

该微服务拥有版本化场景的写模型。它从 NATS 投影初始 `SceneManifest` 和不可变 `SpatialAnchorSet`，并在 PostgreSQL 事务中执行装修命令。

## 负责范围

- 强制 `baseRevision` 乐观并发；冲突返回 `409 revision_conflict` 和 `currentRevision`。
- 原子执行最多 100 条 Core 命令，包括在同一信封内 `ADD_ASSET` 后 `ADD_ENTITY`。
- 校验锁定空间边界、对象 AABB 碰撞、门窗净空和入口主要动线。
- 禁止普通装修命令移动、删除或篡改墙、地面、天花、门窗等结构事实。
- 服务端 undo/redo 每次都创建递增 revision，并发布 `scene.revision-created.v1`。

## HTTP API

- `GET /v1/scenes/:sceneId`
- `POST /v1/scenes/:sceneId/commands`
- `POST /v1/scenes/:sceneId/undo`
- `POST /v1/scenes/:sceneId/redo`

产品客户端通常通过 `http://localhost:3000` 的 API 网关访问；服务直连地址默认是 `http://127.0.0.1:3100`。

## 开发命令

```powershell
pnpm dev:scene
pnpm --filter @spatial-intelligence/scene-service test
pnpm --filter @spatial-intelligence/scene-service typecheck
```
