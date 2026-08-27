import { FrameworkError } from '../errors/FrameworkError.js';
import { commandEnvelopeSchema, sceneCommandSchema } from '../schema/sceneCommand.schema.js';
import { parseSceneManifest } from '../schema/sceneManifest.schema.js';

const clone = (value) => structuredClone(value);

const findEntity = (manifest, entityId) => {
  const entity = manifest.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new FrameworkError('entity_missing', `Entity not found: ${entityId}`);
  return entity;
};

const collectDescendants = (manifest, entityId, result = new Set([entityId])) => {
  for (const entity of manifest.entities) {
    if (entity.parentId === entityId && !result.has(entity.id)) {
      collectDescendants(manifest, entity.id, result);
    }
  }
  return result;
};

export class SpatialRuntime {
  #manifest;
  #past = [];
  #future = [];
  #listeners = new Set();

  constructor({ manifest, behaviors = null, renderer = null, persistence = null, historyLimit = 50 }) {
    this.#manifest = parseSceneManifest(manifest);
    this.behaviors = behaviors;
    this.renderer = renderer;
    this.persistence = persistence;
    this.historyLimit = historyLimit;
  }

  getManifest() {
    return clone(this.#manifest);
  }

  get revision() {
    return this.#manifest.revision;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }

  async #applyCommand(manifest, rawCommand, changes, depth = 0) {
    if (depth > 5) throw new FrameworkError('behavior_depth_exceeded', 'Nested behavior limit exceeded');
    const command = sceneCommandSchema.parse(rawCommand);

    switch (command.type) {
      case 'ADD_ENTITY': {
        if (manifest.entities.some((entity) => entity.id === command.entity.id)) {
          throw new FrameworkError('entity_exists', `Entity already exists: ${command.entity.id}`);
        }
        manifest.entities.push(clone(command.entity));
        break;
      }
      case 'REMOVE_ENTITY': {
        findEntity(manifest, command.entityId);
        const descendants = collectDescendants(manifest, command.entityId);
        if (!command.cascade && descendants.size > 1) {
          throw new FrameworkError('entity_has_children', `Entity ${command.entityId} has children`);
        }
        manifest.entities = manifest.entities.filter((entity) => !descendants.has(entity.id));
        manifest.behaviors = manifest.behaviors
          .map((behavior) => ({
            ...behavior,
            targetEntityIds: behavior.targetEntityIds.filter((id) => !descendants.has(id)),
          }));
        break;
      }
      case 'SET_TRANSFORM':
        findEntity(manifest, command.entityId).transform = clone(command.transform);
        break;
      case 'SET_COMPONENT':
        findEntity(manifest, command.entityId).components[command.component] = clone(command.value);
        break;
      case 'REMOVE_COMPONENT':
        delete findEntity(manifest, command.entityId).components[command.component];
        break;
      case 'ATTACH_ASSET': {
        if (!manifest.assets.some((asset) => asset.id === command.assetRef)) {
          throw new FrameworkError('asset_missing', `Asset not found: ${command.assetRef}`);
        }
        const entity = findEntity(manifest, command.entityId);
        if (!entity.assetRefs.includes(command.assetRef)) entity.assetRefs.push(command.assetRef);
        break;
      }
      case 'DETACH_ASSET': {
        const entity = findEntity(manifest, command.entityId);
        entity.assetRefs = entity.assetRefs.filter((assetRef) => assetRef !== command.assetRef);
        break;
      }
      case 'ADD_BEHAVIOR':
        if (manifest.behaviors.some((behavior) => behavior.id === command.behavior.id)) {
          throw new FrameworkError('behavior_exists', `Behavior already exists: ${command.behavior.id}`);
        }
        manifest.behaviors.push(clone(command.behavior));
        break;
      case 'REMOVE_BEHAVIOR':
        manifest.behaviors = manifest.behaviors.filter((behavior) => behavior.id !== command.behaviorId);
        manifest.interactions = manifest.interactions.filter((binding) => binding.behaviorId !== command.behaviorId);
        break;
      case 'TRIGGER_BEHAVIOR': {
        const behavior = manifest.behaviors.find((candidate) => candidate.id === command.behaviorId);
        if (!behavior) throw new FrameworkError('behavior_missing', `Behavior not found: ${command.behaviorId}`);
        if (!behavior.enabled) throw new FrameworkError('behavior_disabled', `Behavior is disabled: ${command.behaviorId}`);
        if (!this.behaviors) throw new FrameworkError('behavior_registry_missing', 'Runtime has no BehaviorRegistry');
        const generatedCommands = await this.behaviors.execute(behavior, {
          manifest: clone(manifest),
          payload: clone(command.payload),
        });
        for (const generated of generatedCommands) {
          await this.#applyCommand(manifest, generated, changes, depth + 1);
        }
        break;
      }
      case 'SET_ENVIRONMENT_PROPERTY':
        manifest.environment[command.key] = clone(command.value);
        break;
      default:
        throw new FrameworkError('command_unsupported', `Unsupported command: ${command.type}`);
    }

    changes.push(clone(command));
  }

  async execute(rawEnvelope, { confirmed = false } = {}) {
    const envelope = commandEnvelopeSchema.parse(rawEnvelope);
    if (envelope.requiresConfirmation && !confirmed) {
      throw new FrameworkError('confirmation_required', `Command ${envelope.commandId} requires confirmation`);
    }
    if (envelope.baseRevision !== undefined && envelope.baseRevision !== this.revision) {
      throw new FrameworkError('revision_conflict', `Expected revision ${envelope.baseRevision}, got ${this.revision}`);
    }

    const previous = this.getManifest();
    const working = this.getManifest();
    const changes = [];

    for (const command of envelope.commands) {
      await this.#applyCommand(working, command, changes);
    }

    working.revision = previous.revision + 1;
    const next = parseSceneManifest(working);

    this.#past.push(previous);
    this.#past = this.#past.slice(-this.historyLimit);
    this.#future = [];
    this.#manifest = next;

    await this.renderer?.applyChanges(changes, this.getManifest());
    await this.persistence?.saveManifest(this.getManifest(), { envelope });
    await this.persistence?.appendEvent?.({
      type: 'scene:changed',
      sceneId: next.sceneId,
      revision: next.revision,
      commandId: envelope.commandId,
      changes,
    });

    const event = { type: 'scene:changed', envelope, changes, manifest: this.getManifest() };
    this.#emit(event);
    return event;
  }

  async dispatchInteraction({ inputType, eventType, payload = {} }) {
    const bindings = this.#manifest.interactions.filter((binding) => (
      binding.inputType === inputType && binding.eventType === eventType
    ));
    if (!bindings.length) return [];

    const events = [];
    for (const binding of bindings) {
      events.push(await this.execute({
        commandId: `interaction:${binding.id}:${this.revision}`,
        baseRevision: this.revision,
        commands: [{ type: 'TRIGGER_BEHAVIOR', behaviorId: binding.behaviorId, payload }],
        explanation: `Interaction ${binding.id}`,
      }));
    }
    return events;
  }

  async undo() {
    if (!this.#past.length) return null;
    this.#future.unshift(this.getManifest());
    this.#manifest = this.#past.pop();
    await this.renderer?.loadManifest(this.getManifest());
    const event = { type: 'scene:undo', manifest: this.getManifest() };
    this.#emit(event);
    return event;
  }

  async redo() {
    if (!this.#future.length) return null;
    this.#past.push(this.getManifest());
    this.#manifest = this.#future.shift();
    await this.renderer?.loadManifest(this.getManifest());
    const event = { type: 'scene:redo', manifest: this.getManifest() };
    this.#emit(event);
    return event;
  }
}
