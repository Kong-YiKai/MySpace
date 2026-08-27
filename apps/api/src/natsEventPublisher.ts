import { connect, type NatsConnection } from '@nats-io/transport-node';
import { eventSubject, type PlatformEvent } from '@spatial-intelligence/contracts';
import type { EventPublisher } from './ports.js';

export class NatsEventPublisher implements EventPublisher {
  readonly #connection: NatsConnection;
  private constructor(connection: NatsConnection) {
    this.#connection = connection;
  }

  static async connect(servers: string): Promise<NatsEventPublisher> {
    return new NatsEventPublisher(await connect({ servers, name: 'spatial-api' }));
  }

  async publish(event: PlatformEvent): Promise<void> {
    this.#connection.publish(eventSubject(event), JSON.stringify(event));
    await this.#connection.flush();
  }

  async close(): Promise<void> {
    await this.#connection.drain();
  }
}
