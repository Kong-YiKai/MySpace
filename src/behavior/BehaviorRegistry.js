import { FrameworkError } from '../errors/FrameworkError.js';

export class BehaviorRegistry {
  #handlers = new Map();

  register(name, handler) {
    if (!name || typeof handler !== 'function') {
      throw new FrameworkError('invalid_behavior_handler', 'Behavior handler requires a name and function');
    }
    this.#handlers.set(name, handler);
    return () => this.#handlers.delete(name);
  }

  has(name) {
    return this.#handlers.has(name);
  }

  async execute(behavior, context) {
    const handler = this.#handlers.get(behavior.handler);
    if (!handler) {
      throw new FrameworkError('behavior_handler_missing', `Behavior handler not registered: ${behavior.handler}`);
    }
    const result = await handler({ behavior, ...context });
    if (!Array.isArray(result)) {
      throw new FrameworkError('invalid_behavior_result', `Behavior handler ${behavior.handler} must return commands`);
    }
    return result;
  }
}
