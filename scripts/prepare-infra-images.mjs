import { spawnSync } from 'node:child_process';

const localOnly = process.argv.includes('--local-only');
const images = [
  { source: 'postgres:17-alpine', target: 'myspace/postgres:17-alpine' },
  { source: 'nats:2.12-alpine', target: 'myspace/nats:2.12-alpine' },
  { source: 'minio/minio:latest', target: 'myspace/minio:latest' },
];

for (const image of images) {
  if (localOnly && imageExists(image.target)) {
    console.log(`[myspace] image ready: ${image.target}`);
    continue;
  }

  if (!imageExists(image.source)) {
    if (localOnly) {
      console.error(`[myspace] missing image: ${image.source}`);
      console.error('[myspace] run "pnpm infra:pull" before "pnpm infra:up".');
      process.exit(1);
    }
    run('docker', ['pull', image.source]);
  } else if (!localOnly) {
    run('docker', ['pull', image.source]);
  }

  run('docker', ['tag', image.source, image.target]);
  console.log(`[myspace] tagged ${image.source} -> ${image.target}`);

  if (!localOnly) {
    run('docker', ['image', 'rm', image.source]);
    console.log(`[myspace] removed source tag: ${image.source}`);
  }
}

function imageExists(reference) {
  return spawnSync('docker', ['image', 'inspect', reference], {
    stdio: 'ignore',
    shell: false,
  }).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
