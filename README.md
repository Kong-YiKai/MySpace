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

## 本地运行

要求 Node.js 24+、pnpm 11+。

```bash
pnpm install
pnpm --filter @spatial-home/web dev
```

如需同时运行 API、Worker 与本地基础设施：

```bash
pnpm infra:up
pnpm dev
```

默认地址：

- Web：`http://localhost:5173`
- API：`http://localhost:3000`

当前 Web 使用 Fake Provider 式的本地计时流程模拟毛坯和装修生成，目的是验证完整体验。API 与 Worker 的版本化生成任务链路仍可独立运行；下一阶段将把前端模拟器替换为真实任务状态流。

## 质量命令

```bash
pnpm check
pnpm test
pnpm typecheck
pnpm build
```

详细边界、状态机、接口和开发阶段见 [工程架构与开发指南](Docs/ENGINEERING_ARCHITECTURE_AND_DEVELOPMENT_GUIDE.md)。
