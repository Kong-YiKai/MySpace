import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpmCli = process.env.npm_execpath;
const children = [];
let stopping = false;

if (!pnpmCli) {
  throw new Error('无法定位 pnpm 运行时，请通过 `pnpm dev` 启动。');
}

function runPnpm(args, { persistent = false } = {}) {
  const child = spawn(process.execPath, [pnpmCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (persistent) children.push(child);
  return child;
}

function stopInfrastructure() {
  return spawn('docker', ['compose', '-f', path.join(root, 'infra', 'compose.yaml'), 'down'], {
    cwd: root,
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function runOnce(script) {
  const result = await waitForExit(runPnpm(['run', script]));
  if (result.code !== 0) {
    throw new Error(`${script} 执行失败（exit ${result.code}）`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(750);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      const fail = () => {
        socket.destroy();
        resolve(false);
      };
      socket.once('timeout', fail);
      socket.once('error', fail);
    });
    if (connected) return;
    await delay(500);
  }
  throw new Error(`基础设施端口 ${port} 在 ${timeoutMs / 1000} 秒内未就绪`);
}

function ensureServerConfiguration() {
  const envPath = path.join(root, '.env');
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const configuredKey = process.env.OPENAI_API_KEY
    || envText.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!configuredKey) {
    throw new Error('根目录 .env 尚未配置 OPENAI_API_KEY，无法启动客户户型识别。');
  }
}

async function ensureComputeRuntime() {
  const python = path.join(root, 'apps', 'compute-worker-python', '.venv', 'Scripts', 'python.exe');
  if (existsSync(python)) return;
  console.log('[myspace] 首次启动：正在创建 Python Worker 环境…');
  await runOnce('setup:compute:venv');
  await runOnce('setup:compute');
}

async function stopAll(code) {
  if (stopping) return;
  stopping = true;
  console.log('\n[myspace] 正在停止全部应用进程…');
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  await Promise.race([
    Promise.all(children.map((child) => waitForExit(child).catch(() => undefined))),
    delay(4_000),
  ]);
  console.log('[myspace] 正在停止 PostgreSQL、NATS 与 MinIO（数据卷保留）…');
  let infraExitCode = 1;
  try {
    const infraResult = await waitForExit(stopInfrastructure());
    infraExitCode = infraResult.code;
  } catch {
    infraExitCode = 1;
  }
  if (infraExitCode === 0) {
    console.log('[myspace] 全部服务已关闭，数据库与对象存储数据卷已保留。');
  } else {
    console.error('[myspace] 应用进程已停止，但基础设施关闭失败；请执行 `pnpm infra:down` 重试。');
  }
  process.exit(code || infraExitCode);
}

async function main() {
  ensureServerConfiguration();
  await ensureComputeRuntime();
  console.log('[myspace] 正在启动 PostgreSQL、NATS 与 MinIO…');
  await runOnce('infra:up');
  await Promise.all([waitForPort(5432), waitForPort(4222), waitForPort(9000)]);

  console.log('[myspace] 正在启动 Python 户型识别 Worker…');
  const compute = runPnpm(['run', 'dev:compute'], { persistent: true });
  const earlyComputeExit = waitForExit(compute).then((result) => {
    throw new Error(`Python Worker 提前退出（exit ${result.code}）`);
  });
  await Promise.race([delay(1_000), earlyComputeExit]);

  console.log('[myspace] 正在启动 Web、API 与 Generation Worker…');
  const apps = runPnpm(['run', 'dev:apps'], { persistent: true });
  console.log('[myspace] 全部服务已启动；按 Ctrl+C 可统一停止。');

  const outcome = await Promise.race([
    waitForExit(compute).then((result) => ({ name: 'Python Worker', ...result })),
    waitForExit(apps).then((result) => ({ name: '应用服务', ...result })),
  ]);
  if (!stopping) {
    console.error(`[myspace] ${outcome.name}意外退出（exit ${outcome.code}）`);
    await stopAll(outcome.code || 1);
  }
}

process.once('SIGINT', () => void stopAll(0));
process.once('SIGTERM', () => void stopAll(0));

main().catch(async (error) => {
  console.error(`[myspace] 启动失败：${error.message}`);
  await stopAll(1);
});
