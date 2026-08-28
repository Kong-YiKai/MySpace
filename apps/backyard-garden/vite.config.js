import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const viewerDistDirectory = fileURLToPath(new URL('./node_modules/@manycore/aholo-viewer/dist/', import.meta.url));
const workerNames = new Set(['splat-worker.js', 'splat-sort-worker.js', 'transcoder-worker.js']);

/**
 * Aholo Viewer creates parsing Workers through `new URL('./splat-worker.js', import.meta.url)`.
 * Vite serves the optimized SDK entry in /node_modules/.vite/deps during development, but does
 * not automatically expose these sibling Worker bundles. Serve the exact SDK bundles at that
 * expected dev URL; production builds already rewrite them as emitted assets.
 */
function aholoViewerWorkerBridge() {
  return {
    name: 'aholo-viewer-worker-bridge',
    configureServer(server) {
      server.middlewares.use('/node_modules/.vite/deps', (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const workerName = pathname.replace(/^\//, '');
        if (!workerNames.has(workerName)) return next();

        const workerPath = fileURLToPath(new URL(`./node_modules/@manycore/aholo-viewer/dist/${workerName}`, import.meta.url));
        if (!existsSync(workerPath)) return next(new Error(`Aholo Viewer Worker is missing: ${workerName}`));

        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        createReadStream(workerPath).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [aholoViewerWorkerBridge()],
});
