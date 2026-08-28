import { createApp } from './app.js';
import { JobEventBroker } from './jobEventBroker.js';
import { NatsEventPublisher } from './natsEventPublisher.js';
import { NatsJobProjector } from './natsJobProjector.js';
import { OutboxDispatcher } from './outboxDispatcher.js';
import { PostgresPlatformRepository } from './postgresPlatformRepository.js';
import { runMigrations } from './runMigrations.js';
import { S3ObjectStorage } from './s3ObjectStorage.js';

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';
const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';
const databaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://spatial:spatial@127.0.0.1:5432/spatial';

await runMigrations(databaseUrl);
const repository = new PostgresPlatformRepository(databaseUrl);
const storage = new S3ObjectStorage({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'spatial-assets',
  accessKeyId: process.env.S3_ACCESS_KEY ?? 'spatial',
  secretAccessKey: process.env.S3_SECRET_KEY ?? 'spatial-development-only',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
});
await storage.ensureBucket();

const events = new JobEventBroker();
const publisher = await NatsEventPublisher.connect(natsUrl);
const outbox = new OutboxDispatcher(
  repository,
  publisher,
  Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 250),
);
const projector = await NatsJobProjector.connect(natsUrl, repository, events);
projector.start();
outbox.start();

const app = createApp({
  repository,
  storage,
  events,
  uploadUrlTtlSeconds: Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 300),
  sseHeartbeatMs: Number(process.env.SSE_HEARTBEAT_MS ?? 15_000),
});

const shutdown = async () => {
  await app.close();
  await outbox.close();
  await projector.close();
  await publisher.close();
  await repository.close();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ port, host });
