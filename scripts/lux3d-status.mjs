import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

const taskId = process.argv[2];
const region = process.env.AHOLO_REGION ?? 'cn';
const statusLabels = {
  0: 'initialized',
  1: 'running',
  3: 'succeeded',
  4: 'failed',
  6: 'canceled',
};

if (!taskId) {
  console.error('Usage: pnpm lux3d:status <task-id>');
  process.exitCode = 1;
} else if (!process.env.AHOLO_API_KEY) {
  console.error('AHOLO_API_KEY is not available in this shell environment.');
  process.exitCode = 1;
} else if (!['cn', 'com'].includes(region)) {
  console.error('AHOLO_REGION must be "cn" or "com".');
  process.exitCode = 1;
} else {
  const lux3d = createLux3dClient({ region });
  const result = await lux3d.tasks.retrieve(taskId);
  const outputCount = result.outputs.filter((output) => output?.content && output.content !== 'NOT_REQUESTED').length;

  console.log(`Lux3D task ${result.taskId}: ${statusLabels[result.status] ?? `unknown(${result.status})`}`);
  console.log(`Available output slots: ${outputCount}`);
}
