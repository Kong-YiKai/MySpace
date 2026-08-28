import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

const inputPaths = process.argv.slice(2);
const region = process.env.AHOLO_REGION ?? 'cn';

if (inputPaths.length === 0) {
  console.error('Usage: pnpm lux3d:submit <local-image-path> [...more-image-paths]');
  process.exitCode = 1;
} else if (!process.env.AHOLO_API_KEY) {
  console.error('AHOLO_API_KEY is not available in this shell environment.');
  process.exitCode = 1;
} else if (!['cn', 'com'].includes(region)) {
  console.error('AHOLO_REGION must be "cn" or "com".');
  process.exitCode = 1;
} else {
  const absoluteInputPaths = inputPaths.map((inputPath) => resolve(inputPath));
  await Promise.all(absoluteInputPaths.map((inputPath) => access(inputPath, constants.R_OK)));

  const lux3d = createLux3dClient({ region });
  const taskId =
    absoluteInputPaths.length === 1
      ? await lux3d.imgTo3d.createFromFile(absoluteInputPaths[0], { version: 'G1' })
      : await lux3d.imgTo3d.createFromFiles(absoluteInputPaths, { version: 'G1' });

  console.log(`Lux3D task created: ${taskId}`);
  console.log(`Input mode: ${absoluteInputPaths.length === 1 ? 'single image' : `${absoluteInputPaths.length} images`}`);
  console.log('Use the Lux3D task query endpoint or dashboard to inspect progress and download the finished model.');
}
