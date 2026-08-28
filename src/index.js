export { FrameworkError } from './errors/FrameworkError.js';
export { generationRequestSchema, sourceAssetSchema } from './schema/generation.schema.js';
export {
  assetSchema,
  behaviorSchema,
  entitySchema,
  interactionBindingSchema,
  parseSceneManifest,
  sceneManifestSchema,
  transformSchema,
} from './schema/sceneManifest.schema.js';
export { commandEnvelopeSchema, sceneCommandSchema } from './schema/sceneCommand.schema.js';
export { BehaviorRegistry } from './behavior/BehaviorRegistry.js';
export { ProviderRegistry } from './generation/ProviderRegistry.js';
export { GenerationPipeline } from './generation/GenerationPipeline.js';
export { SpatialRuntime } from './runtime/SpatialRuntime.js';
export { RendererAdapter } from './adapters/RendererAdapter.js';
export { PersistenceAdapter } from './adapters/PersistenceAdapter.js';
export {
  createDeploymentCommandEnvelope,
  createSpatialAgentSceneContext,
  createSpatialAgentSystemPrompt,
  buildOpenAICompatibleVisionRequest,
  invokeOpenAICompatibleSpatialAgent,
  resolveChatCompletionsUrl,
  validateSpatialAgentDirective,
} from './agent/spatialAgent.js';
export {
  openAICompatibleVisionConfigSchema,
  SPATIAL_AGENT_SCHEMA,
  spatialAgentActionSchema,
  spatialAgentDirectiveSchema,
  spatialAgentRequestSchema,
  spatialAgentSceneSchema,
} from './agent/spatialAgent.schema.js';
export {
  FUSION_RECIPES,
  GAME_PLOTS,
  GAME_STATE_SCHEMA_VERSION,
  GAME_WEAPONS,
  GARDEN_GROWTH_DURATIONS_MS,
  SHOP_ITEMS,
  buyShopItem,
  claimMaturePlant,
  createInitialGameState,
  equipWeapon,
  executeGameCommand,
  getGardenGrowthStage,
  mergePlants,
  migrateLegacyGardenPlants,
  normalizeGameState,
  plantSeed,
  reconcileGardenPlants,
  resolveBattleReward,
  uprootGardenPlant,
  waterGardenPlant,
} from './gameplay/game-state.js';
export { createGameStateClient } from './gameplay/game-state-client.js';
export { consumeFirstVisit, FIRST_VISIT_ONBOARDING_STORAGE_PREFIX } from './gameplay/first-visit-onboarding.js';
export { APP_ROUTE_DEFINITIONS, resolveMySpaceAppRoute } from './navigation/app-routes.js';
