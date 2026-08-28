import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  invokeOpenAICompatibleSpatialAgent,
  createInitialGameState,
  executeGameCommand,
  normalizeGameState,
  spatialAgentRequestSchema,
} from '../src/index.js';
import { FrameworkError } from '../src/errors/FrameworkError.js';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_BODY_BYTES = 8_200_000;
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const GAME_STATE_FILE = resolve(ROOT, '.local', 'game-state.json');
const GAME_STATE_STORE_VERSION = 'myspace.game-state-profiles.v1';
const GAME_PROFILE_COOKIE = 'myspace_game_profile';
const LEGACY_PROFILE_ID = 'legacy';
const LEGACY_PROFILE_HEADER = 'x-myspace-adopt-legacy-profile';

function loadLocalEnv() {
  const localEnvPath = resolve(ROOT, '.env.local');
  if (!existsSync(localEnvPath)) return;
  for (const rawLine of readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!/^(?:SPATIAL_AGENT|QWEN|DASHSCOPE)_/.test(key) || process.env[key] !== undefined) continue;
    const value = rawValue.trim().replace(/^(["'])(.*)\1$/, '$2');
    process.env[key] = value;
  }
}

function getConfig() {
  // 兼容既有的通用空间 Agent 命名，也兼容本机常见的百炼/Qwen 命名。
  // 不提供默认 Base URL：百炼的兼容地址依赖具体地域与工作空间，猜错会把请求发往错误端点。
  const baseUrl = process.env.SPATIAL_AGENT_BASE_URL?.trim()
    || process.env.QWEN_BASE_URL?.trim()
    || process.env.DASHSCOPE_BASE_URL?.trim();
  const apiKey = process.env.SPATIAL_AGENT_API_KEY?.trim()
    || process.env.QWEN_API_KEY?.trim()
    || process.env.DASHSCOPE_API_KEY?.trim();
  const model = process.env.SPATIAL_AGENT_MODEL?.trim()
    || process.env.QWEN_MODEL?.trim()
    || (baseUrl && apiKey ? 'qwen3.7-flash' : '');
  if (!baseUrl || !apiKey || !model) return null;
  return {
    baseUrl,
    apiKey,
    model,
    jsonMode: process.env.SPATIAL_AGENT_JSON_MODE?.trim().toLowerCase() !== 'false',
    timeoutMs: Number.parseInt(process.env.SPATIAL_AGENT_TIMEOUT_MS ?? '45000', 10),
  };
}

function isAllowedOrigin(origin) {
  return !origin || LOCAL_ORIGIN_PATTERN.test(origin);
}

function loadGameStateStore() {
  try {
    if (!existsSync(GAME_STATE_FILE)) {
      return { schemaVersion: GAME_STATE_STORE_VERSION, legacyState: null, profiles: {} };
    }
    const stored = JSON.parse(readFileSync(GAME_STATE_FILE, 'utf8'));
    if (stored?.schemaVersion === GAME_STATE_STORE_VERSION && stored?.profiles && typeof stored.profiles === 'object') {
      return {
        schemaVersion: GAME_STATE_STORE_VERSION,
        legacyState: stored.legacyState ? normalizeGameState(stored.legacyState) : null,
        profiles: Object.fromEntries(Object.entries(stored.profiles).map(([profileId, state]) => [
          profileId,
          normalizeGameState(state),
        ])),
      };
    }
    // 兼容并保留旧版单档案：只在已有常规浏览器首次连接时认领，绝不再泄漏给无痕窗口。
    return {
      schemaVersion: GAME_STATE_STORE_VERSION,
      legacyState: normalizeGameState(stored),
      profiles: {},
    };
  } catch {
    return { schemaVersion: GAME_STATE_STORE_VERSION, legacyState: null, profiles: {} };
  }
}

function saveGameStateStore(store) {
  mkdirSync(resolve(ROOT, '.local'), { recursive: true });
  writeFileSync(GAME_STATE_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return store;
}

function readCookies(request) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap((rawCookie) => {
    const [name, ...valueParts] = rawCookie.trim().split('=');
    return name ? [[name, valueParts.join('=')]] : [];
  }));
}

function isValidProfileId(profileId) {
  return profileId === LEGACY_PROFILE_ID || /^[a-f0-9-]{36}$/i.test(profileId);
}

function resolveGameProfile(request) {
  const cookieProfile = readCookies(request)[GAME_PROFILE_COOKIE];
  if (isValidProfileId(cookieProfile)) return { profileId: cookieProfile, setCookie: null };
  const wantsLegacyProfile = request.headers[LEGACY_PROFILE_HEADER] === 'true';
  const profileId = wantsLegacyProfile ? LEGACY_PROFILE_ID : randomUUID();
  return {
    profileId,
    setCookie: `${GAME_PROFILE_COOKIE}=${profileId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  };
}

function getGameState(store, profileId) {
  if (!store.profiles[profileId]) {
    store.profiles[profileId] = profileId === LEGACY_PROFILE_ID && store.legacyState
      ? store.legacyState
      : createInitialGameState();
  }
  return store.profiles[profileId];
}

function writeJson(response, statusCode, payload, origin = '', extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new FrameworkError('request_too_large', '截图或请求内容超过本地代理限制');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FrameworkError('request_not_json', '请求体不是有效 JSON');
  }
}

loadLocalEnv();
const port = Number.parseInt(process.env.SPATIAL_AGENT_PORT ?? '8787', 10);
let gameStateStore = loadGameStateStore();

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? '';
  if (!isAllowedOrigin(origin)) {
    writeJson(response, 403, { error: { code: 'origin_not_allowed', message: '只允许本机页面调用空间 Agent。' } }, origin);
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': origin || 'http://127.0.0.1',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': `content-type, ${LEGACY_PROFILE_HEADER}`,
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '600',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    const profile = resolveGameProfile(request);
    const gameState = getGameState(gameStateStore, profile.profileId);
    writeJson(response, 200, { ok: true, configured: Boolean(getConfig()), protocol: 'spatial-agent.v1', gameStateRevision: gameState.revision }, origin, profile.setCookie ? { 'set-cookie': profile.setCookie } : {});
    return;
  }

  if (request.method === 'GET' && request.url === '/api/game-state') {
    const profile = resolveGameProfile(request);
    const gameState = getGameState(gameStateStore, profile.profileId);
    saveGameStateStore(gameStateStore);
    writeJson(response, 200, { ok: true, state: gameState }, origin, profile.setCookie ? { 'set-cookie': profile.setCookie } : {});
    return;
  }

  if (request.method === 'POST' && request.url === '/api/game-state/command') {
    try {
      const profile = resolveGameProfile(request);
      const command = await readJson(request);
      const gameState = executeGameCommand(getGameState(gameStateStore, profile.profileId), command);
      gameStateStore.profiles[profile.profileId] = gameState;
      saveGameStateStore(gameStateStore);
      writeJson(response, 200, { ok: true, state: gameState }, origin, profile.setCookie ? { 'set-cookie': profile.setCookie } : {});
    } catch (error) {
      const message = error instanceof Error ? error.message : '游戏状态命令未完成';
      writeJson(response, 400, { error: { code: 'game_command_rejected', message } }, origin);
    }
    return;
  }

  if (request.method === 'POST' && request.url === '/api/game-state/reset') {
    const profile = resolveGameProfile(request);
    const gameState = createInitialGameState();
    gameStateStore.profiles[profile.profileId] = gameState;
    saveGameStateStore(gameStateStore);
    writeJson(response, 200, { ok: true, state: gameState }, origin, profile.setCookie ? { 'set-cookie': profile.setCookie } : {});
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/spatial-agent/inspect') {
    writeJson(response, 404, { error: { code: 'route_not_found', message: '未找到本地空间 Agent 路由。' } }, origin);
    return;
  }

  const config = getConfig();
  if (!config) {
    writeJson(response, 503, {
      error: {
        code: 'agent_not_configured',
        message: '请在 .env.local 配置 OpenAI 兼容 Base URL 与本地密钥（SPATIAL_AGENT_*，或 QWEN_*/DASHSCOPE_* 命名）。未填写 Base URL 时不会猜测百炼工作空间端点。',
      },
    }, origin);
    return;
  }

  try {
    const body = spatialAgentRequestSchema.parse(await readJson(request));
    const directive = await invokeOpenAICompatibleSpatialAgent({ config, request: body });
    writeJson(response, 200, { ok: true, directive }, origin);
  } catch (error) {
    const code = error?.code ?? 'agent_request_failed';
    const statusCode = ['request_not_json', 'request_too_large'].includes(code) ? 400 : 502;
    const message = error instanceof FrameworkError
      ? error.message
      : '空间 Agent 请求未完成，请检查模型地址、模型能力或本地配置。';
    writeJson(response, statusCode, { error: { code, message } }, origin);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[spatial-agent] 本地代理已启动：http://127.0.0.1:${port}`);
  console.log(`[spatial-agent] 模型配置：${getConfig() ? '就绪' : '待填写 .env.local'}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
