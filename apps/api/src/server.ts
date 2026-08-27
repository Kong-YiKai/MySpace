import { createApp } from './app.js';
import { InMemoryGenerationJobRepository } from './inMemoryGenerationJobRepository.js';
import { NatsEventPublisher } from './natsEventPublisher.js';
import { NatsJobProjector } from './natsJobProjector.js';

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';
const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';

const jobs = new InMemoryGenerationJobRepository();
const publisher = await NatsEventPublisher.connect(natsUrl);
const projector = await NatsJobProjector.connect(natsUrl, jobs);
projector.start();
const app = createApp({
  jobs,
  publisher,
});

const shutdown = async () => {
  await app.close();
  await projector.close();
  await publisher.close();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ port, host });
