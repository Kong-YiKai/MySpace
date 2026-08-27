# 栖居 · AI 看房装修模拟器

这是一个面向住宅看房与装修决策的交互式 3D 应用：用户从预设户型或上传户型图开始，先查看毛坯空间，再通过自然语言生成装修方案、点选并修改家具，最后以第一人称沉浸看房。

当前仓库的目标不是制作一组静态页面，而是先打通一条状态连续、可替换真实 AI/3D Provider 的产品骨架。

## 核心工作流

1. 选择“大开间”或“标准一居室”，也可以上传户型图。
2. 校验户型图并生成可旋转查看的毛坯房。
3. 选择墙纸，输入装修要求，观察 AI 分析与生成状态。
4. 精装家具无缝进入原场景；点选沙发、茶几、地毯、花瓶或绿植并修改颜色。
5. 从户型门口进入第一人称“沉浸看房”；键鼠控制已接通，手势输入作为独立计算服务接入。

## 仓库结构

```text
apps/
  web/                    React + React Three Fiber 产品应用
  api/                    会话、上传、任务创建和状态查询边界
  generation-worker/      异步 3D 生成任务处理
  compute-worker-python/  户型识别、3D 计算与手势输入服务边界
packages/
  contracts/              前后端共享的住宅流程与平台事件契约
  spatial-core/           场景清单、命令、运行时和 Provider 注册表
infra/                    PostgreSQL、NATS、MinIO 本地基础设施
Docs/                     产品工程方案与阶段计划
```

住宅流程属于 `apps/web` 与服务编排层；`spatial-core` 仍保持可复用，不把“沙发”或“墙纸”等业务对象写进通用场景协议。

## Docker 命名规范

Docker 资源统一采用全小写 `myspace` 前缀与 kebab-case；镜像仓库名按 Docker 规范不能使用大写字母。

| 资源 | PostgreSQL | NATS | MinIO |
| --- | --- | --- | --- |
| 镜像 | `myspace/postgres:17-alpine` | `myspace/nats:2.12-alpine` | `myspace/minio:latest` |
| 容器 | `myspace-postgres` | `myspace-nats` | `myspace-minio` |
| 数据卷 | `myspace-postgres-data` | `myspace-nats-data` | `myspace-minio-data` |

Compose 项目名为 `myspace`，默认网络名为 `myspace-network`。所有资源都带 `com.myspace.project`、`com.myspace.managed-by` 以及服务或资源标签。`pnpm infra:pull` 拉取官方基础镜像后创建本地 `myspace/...` 标记，并移除这三个镜像的官方源标签；镜像层内容不会被修改或重复保存。

## 本地环境要求

- Node.js 24+
- pnpm 11（仓库固定使用 `pnpm@11.19.0`）
- Docker Desktop（完整服务需要；仅启动前端时不需要）

检查环境：

```powershell
node --version
pnpm --version
docker version
```

第一次拉取代码后安装依赖：

```powershell
cd D:\Workplace\Project-Team\Activity\MySpace
pnpm install
```

如需启用 Worker 的本地 Fake Provider，可创建本地环境文件：

```powershell
Copy-Item .env.example .env
```

`.env` 已被 Git 忽略，不应提交密钥或本地配置。

## 方式一：只启动前端

当前 Web 使用本地状态模拟毛坯和装修生成。只想查看和开发页面时，不需要 Docker、API 或 Worker：

```powershell
pnpm dev:web
```

访问：`http://localhost:5173`

关闭：在运行该命令的终端按 `Ctrl+C`。

## 方式二：启动完整服务

先确认 Docker Desktop 已启动。

第一次运行或镜像有更新时，建议先串行拉取官方镜像并创建 `myspace/...` 本地标记，避免网络不稳定时并发下载触发 TLS 超时：

```powershell
pnpm infra:pull
```

启动 PostgreSQL、NATS 和 MinIO：

```powershell
pnpm infra:up
pnpm infra:status
```

基础设施状态均正常后，在另一个 PowerShell 窗口启动 Web、API 和 Generation Worker：

```powershell
pnpm dev
```

默认地址：

- Web：`http://localhost:5173`
- API：`http://localhost:3000`
- NATS 监控：`http://localhost:8222`
- MinIO API：`http://localhost:9000`
- MinIO Console：`http://localhost:9001`
- PostgreSQL：`localhost:5432`

查看基础设施日志：

```powershell
pnpm infra:logs
```

## 关闭完整服务

1. 在运行 `pnpm dev` 的终端按 `Ctrl+C`，等待 Web、API 和 Worker 退出。
2. 在项目根目录停止 Docker 基础设施：

```powershell
pnpm infra:down
```

`infra:down` 会停止并移除项目容器和网络，但保留 PostgreSQL、NATS、MinIO 的数据卷。不要追加 `-v`，除非明确需要清空本地数据。

## 常见启动问题

### `pnpm` 无法识别

```powershell
corepack enable
corepack install --global pnpm@11.19.0
pnpm --version
```

如果当前终端仍找不到命令，关闭并重新打开 PowerShell。

### Docker 拉取出现 `TLS handshake timeout`

这是 Docker 镜像网络下载失败，不是项目代码错误。确认 Docker Desktop 的代理/VPN有效，然后重新执行：

```powershell
pnpm infra:pull
pnpm infra:up
```

脚本已限制 Docker 串行拉取，并自动创建统一的 `myspace/...` 镜像标记；已完成的镜像层会复用，不需要删除现有缓存。

### `pnpm dev` 提示 `No projects matched the filters`

当前脚本已经改为使用明确的 workspace 包名。更新代码并重新安装依赖后再启动：

```powershell
pnpm install
pnpm dev
```

也可以分别启动：

```powershell
pnpm dev:web
pnpm dev:services
```

其中 `dev:services` 依赖已运行的 NATS 基础设施。

## 质量命令

```powershell
pnpm check
pnpm test
pnpm typecheck
pnpm build
```

详细边界、状态机、接口和开发阶段见 [工程架构与开发指南](Docs/ENGINEERING_ARCHITECTURE_AND_DEVELOPMENT_GUIDE.md)。
