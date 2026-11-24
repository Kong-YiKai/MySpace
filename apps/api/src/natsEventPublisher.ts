import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamClient } from '@nats-io/jetstream';
import { eventSubject, type PlatformEvent } from '@spatial-intelligence/contracts';
import type { EventPublisher } from './ports.js';

export const PLATFORM_STREAM = 'MYSPACE_EVENTS';
export const PLATFORM_SUBJECTS = [
  'generation.*.v1',
  'floor-plan.*.v1',
  'decoration-analysis.*.v1',
  'asset-generation.*.v1',
  'scene.*.v1',
];

export async function ensurePlatformStream(connection: NatsConnection): Promise<void> {
  const manager = await jetstreamManager(connection);
  try {
    const info = await manager.streams.info(PLATFORM_STREAM);
    if (!PLATFORM_SUBJECTS.every((subject) => info.config.subjects?.includes(subject))) {
      await manager.streams.update(PLATFORM_STREAM, {
        ...info.config,
        subjects: [...new Set([...(info.config.subjects ?? []), ...PLATFORM_SUBJECTS])],
      });
    }
  } catch {
    await manager.streams.add({
      name: PLATFORM_STREAM,
      subjects: PLATFORM_SUBJECTS,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
      duplicate_window: 2 * 60 * 1_000_000_000,
    });
  }
}

export class NatsEventPublisher implements EventPublisher {
  readonly #connection: NatsConnection;
  readonly #jetstream: JetStreamClient;

  private constructor(connection: NatsConnection) {
    this.#connection = connection;
    this.#jetstream = jetstream(connection);
  }

  static async connect(servers: string): Promise<NatsEventPublisher> {
    const connection = await connect({
      servers,
      name: 'spatial-api-outbox',
      maxReconnectAttempts: -1,
      reconnectTimeWait: 1_000,
    });
    await ensurePlatformStream(connection);
    return new NatsEventPublisher(connection);
  }

  async publish(event: PlatformEvent): Promise<void> {
    await this.#jetstream.publish(
      eventSubject(event),
      new TextEncoder().encode(JSON.stringify(event)),
      { msgID: event.eventId },
    );
  }

  async resetEphemeralRuntime(): Promise<void> {
    this.#connection.publish('myspace.ephemeral.reset.v1');
    await this.#connection.flush();
    await (await jetstreamManager(this.#connection)).streams.purge(PLATFORM_STREAM);
  }

  async close(): Promise<void> {
    await this.#connection.drain();
  }
}
