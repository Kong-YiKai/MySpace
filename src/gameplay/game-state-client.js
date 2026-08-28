const DEFAULT_GAME_STATE_API_URL = 'http://127.0.0.1:8787';
const LEGACY_PROFILE_HEADER = 'x-myspace-adopt-legacy-profile';

function getLegacyProfileHeaders() {
  // 旧版本把整个游戏进度放在本机代理的一份全局 JSON 内。已有常规档案第一次升级到
  // 会话隔离版本时，仍可认领旧进度；干净浏览器/无痕窗口则不会带此标记，会得到空花园。
  if (typeof window === 'undefined') return {};
  try {
    const hasExistingProfile = Object.keys(window.localStorage).some((key) => (
      key.startsWith('myspace.')
      && !key.startsWith('myspace.first-visit-onboarding.')
    ));
    return hasExistingProfile ? { [LEGACY_PROFILE_HEADER]: 'true' } : {};
  } catch {
    return {};
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    // Cookie 由本机 8787 服务签发，跨花园、商店和战斗的不同 Vite 端口共享；
    // 无痕模式拥有独立 Cookie Jar，因而自然得到独立的空进度。
    credentials: 'include',
    headers: {
      ...getLegacyProfileHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message ?? '本地游戏状态服务没有响应');
  }
  return payload;
}

export function createGameStateClient({ baseUrl = DEFAULT_GAME_STATE_API_URL } = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return {
    async getState() {
      const payload = await requestJson(`${normalizedBaseUrl}/api/game-state`, { cache: 'no-store' });
      return payload.state;
    },
    async command(type, payload = {}) {
      const response = await requestJson(`${normalizedBaseUrl}/api/game-state/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      });
      return response.state;
    },
  };
}
