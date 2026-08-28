const APP_ROUTE_DEFINITIONS = Object.freeze({
  panorama: Object.freeze({ localUrl: 'http://127.0.0.1:4173/', deploymentPath: '/panorama-world/' }),
  garden: Object.freeze({ localUrl: 'http://127.0.0.1:5176/', deploymentPath: '/backyard-garden/' }),
  battle: Object.freeze({ localUrl: 'http://127.0.0.1:5173/', deploymentPath: '/beach-defense/' }),
});

function isLocalHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

/**
 * Resolves an application hand-off without putting a local development port into
 * a scene component. Production callers can inject a VITE override, while a
 * local multi-Vite session keeps working without any setup.
 */
export function resolveMySpaceAppRoute(appId, { override, location = globalThis.location } = {}) {
  const definition = APP_ROUTE_DEFINITIONS[appId];
  if (!definition) throw new Error(`未知 MySpace 应用路由：${appId}`);
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (location && isLocalHost(location.hostname)) return definition.localUrl;
  return definition.deploymentPath;
}

export { APP_ROUTE_DEFINITIONS };
