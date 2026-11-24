import { cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { sceneManifestSchema } from '@spatial-intelligence/contracts';
import { presetFloorPlan } from '../../api/src/presetFloorPlans.js';
import { deriveSpatialAnchorSet } from '../../api/src/spatialAnchors.js';
import { shellProvider } from '../../generation-worker/src/shellProvider.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist-exhibit');
const tourOutput = await mkdtemp(join(tmpdir(), 'qiju-exhibit-'));
const base = '/qiju/';

try {
  await build({
    root, base, define: { 'import.meta.env.VITE_PUBLIC_EXHIBIT': JSON.stringify('true') },
    build: { outDir: output, emptyOutDir: true },
  });
  await build({
    root: join(root, 'exhibit'), base, configFile: false,
    build: { outDir: tourOutput },
  });
  await rename(join(tourOutput, 'index.html'), join(tourOutput, 'tour.html'));
  await cp(tourOutput, output, { recursive: true });
  for (const preset of ['studio', 'one-bedroom'] as const) {
    const manifest = sceneManifestSchema.parse(await shellProvider.generate({
      requestId: `exhibit-${preset}`,
      sources: [],
      requirements: { floorPlan: presetFloorPlan(preset) },
    }, { onProgress: () => undefined }));
    const spatialAnchors = deriveSpatialAnchorSet(manifest);
    await writeFile(join(output, `preset-${preset}.json`), JSON.stringify({ manifest, spatialAnchors }));
  }
} finally {
  await rm(tourOutput, { recursive: true, force: true });
}
