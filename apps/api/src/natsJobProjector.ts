import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
  type ConsumerMessages,
} from '@nats-io/jetstream';
import { platformEventSchema } from '@spatial-intelligence/contracts';
import type { JobEventListener, PlatformRepository } from './ports.js';
import { ensurePlatformStream, PLATFORM_STREAM } from './natsEventPublisher.js';

const PROJECTOR_CONSUMER = 'api-platform-projector';

export class NatsJobProjector {
  readonly #connection: NatsConnection;
  readonly #repository: PlatformRepository;
  readonly #events: JobEventListener;
  #messages: ConsumerMessages | null = null;
  #consumePromise: Promise<void> | null = null;

  private constructor(connection: NatsConnection, repository: PlatformRepository, events: JobEventListener) {
    this.#connection = connection;
    this.#repository = repository;
    this.#events = events;
  }

  static async connect(
    servers: string,
    repository: PlatformRepository,
    events: JobEventListener,
  ): Promise<NatsJobProjector> {
    const connection = await connect({ servers, name: 'spatial-api-job-projector' });
    await ensurePlatformStream(connection);
    const manager = await jetstreamManager(connection);
    try {
      await manager.consumers.info(PLATFORM_STREAM, PROJECTOR_CONSUMER);
    } catch {
      await manager.consumers.add(PLATFORM_STREAM, {
        durable_name: PROJECTOR_CONSUMER,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        ack_wait: 30 * 1_000_000_000,
        max_ack_pending: 256,
      });
    }
    return new NatsJobProjector(connection, repository, events);
  }

  start(): void {
    if (this.#consumePromise) return;
    this.#consumePromise = this.#consume();
  }

  async close(): Promise<void> {
    await this.#messages?.close();
    await this.#consumePromise;
    await this.#connection.drain();
  }

  async #consume(): Promise<void> {
    const consumer = await jetstream(this.#connection).consumers.get(PLATFORM_STREAM, PROJECTOR_CONSUMER);
    this.#messages = await consumer.consume({ max_messages: 128 });
    for await (const message of this.#messages) {
      const parsed = platformEventSchema.safeParse(message.json());
      if (!parsed.success) {
        message.term('invalid platform event');
        continue;
      }
      if (parsed.data.eventType !== 'generation.requested'
        && parsed.data.eventType !== 'floor-plan.validation-requested') {
        await this.#repository.apply(parsed.data);
        this.#events.publish(parsed.data);
      }
      message.ack();
    }
  }
}
