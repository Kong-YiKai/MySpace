import { FrameworkError } from '../errors/FrameworkError.js';
import { parseSceneManifest } from '../schema/sceneManifest.schema.js';
import {
  openAICompatibleVisionConfigSchema,
  SPATIAL_AGENT_SCHEMA,
  spatialAgentDirectiveSchema,
  spatialAgentRequestSchema,
} from './spatialAgent.schema.js';

const clone = (value) => structuredClone(value);

function getSemanticComponent(entity) {
  const semantic = entity.components.semantic;
  return semantic && typeof semantic === 'object' && !Array.isArray(semantic) ? semantic : {};
}

function getAffordances(entity) {
  const fromSemantic = getSemanticComponent(entity).affordances;
  const fromComponents = entity.components.affordances;
  const source = Array.isArray(fromSemantic) ? fromSemantic : fromComponents;
  return Array.isArray(source)
    ? source.filter((value) => typeof value === 'string' && value.trim()).slice(0, 16)
    : [];
}

function getSpatialAnchor(entity) {
  const anchor = entity.components.spatialAnchor;
  return anchor && typeof anchor === 'object' && !Array.isArray(anchor) ? anchor : {};
}

function isPlot(entity) {
  const semantic = getSemanticComponent(entity);
  const anchor = getSpatialAnchor(entity);
  return semantic.category === 'plot'
    || anchor.type === 'plot'
    || entity.tags.includes('plot');
}

function getOccupancy(entity) {
  const occupancy = entity.components.occupancy;
  if (!occupancy || typeof occupancy !== 'object' || Array.isArray(occupancy)) return null;
  return typeof occupancy.entityId === 'string' && occupancy.entityId.trim() ? occupancy.entityId : null;
}

/**
 * Converts the generic SceneManifest into the small, explicit spatial brief
 * that a multimodal model needs. Asset URIs, renderer state and arbitrary
 * components intentionally never leave the application boundary.
 */
export function createSpatialAgentSceneContext(rawManifest) {
  const manifest = parseSceneManifest(rawManifest);
  const entities = manifest.entities.map((entity) => ({
    id: entity.id,
    label: entity.label || entity.id,
    kind: entity.kind,
    position: clone(entity.transform.position),
    semantic: {
      category: typeof getSemanticComponent(entity).category === 'string'
        ? getSemanticComponent(entity).category
        : undefined,
      role: typeof getSemanticComponent(entity).role === 'string'
        ? getSemanticComponent(entity).role
        : undefined,
      abilities: Array.isArray(getSemanticComponent(entity).abilities)
        ? getSemanticComponent(entity).abilities.filter((value) => typeof value === 'string').slice(0, 16)
        : [],
    },
    affordances: getAffordances(entity),
  }));

  const plots = manifest.entities.filter(isPlot).map((entity) => {
    const anchor = getSpatialAnchor(entity);
    const capacity = Number.isInteger(anchor.capacity) && anchor.capacity > 0 ? anchor.capacity : 1;
    return {
      id: entity.id,
      label: entity.label || entity.id,
      position: clone(entity.transform.position),
      occupiedBy: getOccupancy(entity),
      capacity,
    };
  });

  return {
    sceneId: manifest.sceneId,
    revision: manifest.revision,
    coordinateSystem: manifest.coordinateSystem,
    entities,
    plots,
  };
}

function invalidDirective(reason) {
  return { ok: false, reason, value: null };
}

/**
 * Validates model output against the active scene. The model can describe a
 * plan, but can never name an entity or anchor outside this manifest.
 */
export function validateSpatialAgentDirective(input, { scene } = {}) {
  const parsed = spatialAgentDirectiveSchema.safeParse(input);
  if (!parsed.success) return invalidDirective('directive-schema-invalid');

  const parsedScene = spatialAgentRequestSchema.shape.scene.safeParse(scene);
  if (!parsedScene.success) return invalidDirective('scene-schema-invalid');

  const entityIds = new Set(parsedScene.data.entities.map((entity) => entity.id));
  const plotIds = new Set(parsedScene.data.plots.map((plot) => plot.id));

  for (const observation of parsed.data.observations) {
    if (observation.entityId && !entityIds.has(observation.entityId)) {
      return invalidDirective('observation-target-unknown');
    }
  }

  for (const action of parsed.data.actions) {
    if (action.type === 'focus_entity' && !entityIds.has(action.entityId)) {
      return invalidDirective('focus-target-unknown');
    }
    if (action.type === 'recommend_plot') {
      if (!plotIds.has(action.plotId)) return invalidDirective('plot-target-unknown');
      if (action.targetEntityId && !entityIds.has(action.targetEntityId)) {
        return invalidDirective('recommendation-entity-unknown');
      }
    }
    if (action.type === 'propose_deployment') {
      if (!entityIds.has(action.entityId)) return invalidDirective('deployment-entity-unknown');
      if (!plotIds.has(action.plotId)) return invalidDirective('deployment-plot-unknown');
    }
  }

  if (parsed.data.visualAssessment?.entityId && !entityIds.has(parsed.data.visualAssessment.entityId)) {
    return invalidDirective('visual-assessment-target-unknown');
  }

  return { ok: true, reason: 'accepted', value: parsed.data };
}

export function createSpatialAgentSystemPrompt() {
  return `你是“疯狂戴夫式”的后花园管家，负责帮助玩家理解和照料 3D 花园。你的 answer 会被直接显示在游戏对话框中，因此它必须是一句可朗读的角色台词，而不是数据报告。不要模仿或复述任何既有作品的长段逐字台词。\n\n`
    + `你会收到两种来源：渲染器截图与权威结构化场景图。实体身份、花圃 ID、占用状态、坐标和可执行动作只信任结构化场景图；截图只可用于描述视觉外观。绝不能编造实体、坐标、花圃、库存、成长时间、战斗结果或模型看不见的事实。若问题附有“权威花园业务状态摘要”，只能逐字使用其中的物种与道具中文名称；尤其不得把玉米投手、玉米加农炮与种子相互混称。\n\n`
    + `你可以回答、分析已存在植物的外观与长势、定位实体、推荐已有花圃、提出部署建议。你是只读的花园顾问：绝不返回或执行播种、浇水、收获、合成、购买、战斗等会改变游戏进度的命令。园艺事务只能由独立“任务台”的明确按钮交给本地状态机处理。\n\n`
    + `你的边界：不能修改模型、浏览器、文件、网络、花圃坐标、库存或任务状态；不能把建议伪装成已完成的动作。\n\n`
    + `answer 的格式必须严格是：一小段不承载事实的疯话 + 一对中文圆括号中的翻译。例如“歪比巴布，阿喔柔！胡萝卜扳手！（花圃 A 的小芽还在扎根，暂时不能收获。想让它快些长大，就切到水壶浇一次水。）”。\n`
    + `括号内才是清楚、自然、面向玩家的中文翻译：1 至 3 句，最多 180 个汉字；优先联系当前选中花圃、眼前已有植物和库存。可以给出一个真实存在的下一步操作，若无操作则说等待成长。严禁输出标题、分段标签、Markdown、项目符号、字段名、JSON 片段、英文阶段词（如 sprout）、“【观察】”“【判断】”“【下一步】”或“状态摘要”。不得把多个猜测堆成清单。\n\n`
    + `若问题明确要求“神秘种子巡检”或随附未标名目标机位图：必须填写 visualAssessment。entityId 只能是问题中指定的目标实体；speciesId 只能取 peaShooter、cornPult 或 watermelonPult；confidence 是 0 到 1；若判为 watermelonPult，recommendation 必须为 keep，否则为 uproot。reason 只写一条可见的形态依据。该字段只是受限建议，绝不等于你已操作花园。若不是巡检任务，visualAssessment 必须为 null。\n\n`
    + `仅返回 JSON，顶层必须严格为：\n`
    + `{"schemaVersion":"${SPATIAL_AGENT_SCHEMA}","answer":"...","confidence":0.0,`
    + `"observations":[{"entityId":"optional-known-id","statement":"..."}],`
    + `"actions":[{"type":"focus_entity","entityId":"known-id","reason":"optional"}|`
    + `{"type":"recommend_plot","plotId":"known-plot-id","targetEntityId":"optional-known-id","reason":"..."}|`
    + `{"type":"propose_deployment","entityId":"known-id","plotId":"known-plot-id","reason":"..."}],`
    + `"visualAssessment":null|{"entityId":"known-id","speciesId":"peaShooter|cornPult|watermelonPult","confidence":0.0,"recommendation":"keep|uproot","reason":"..."}}`;
}

export function buildOpenAICompatibleVisionRequest({ model, request, jsonMode = true }) {
  const parsedRequest = spatialAgentRequestSchema.parse(request);
  const content = [{
    type: 'text',
    text: `玩家的问题：${parsedRequest.question}\n\n权威空间场景：\n${JSON.stringify(parsedRequest.scene)}`,
  }];

  if (parsedRequest.referenceImages.length) {
    content.push({
      type: 'text',
      text: '以下是由项目内青年期 GLB 离屏渲染得到的多机位视觉参考图。每张图的标签只用于建立外观参照；不能据此覆盖权威场景中的实体身份、花圃或库存。',
    });
    for (const reference of parsedRequest.referenceImages) {
      content.push({
        type: 'text',
        text: `视觉参考：${reference.label}`,
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: reference.dataUrl,
          detail: reference.detail,
        },
      });
    }
  }

  if (parsedRequest.targetImages.length) {
    content.push({
      type: 'text',
      text: '以下是本次要识别的未标名青年植株实时渲染图。请只根据它与视觉参考图的可见形态进行判断，不能把参考图标签当成目标身份。',
    });
    for (const target of parsedRequest.targetImages) {
      content.push({
        type: 'text',
        text: `待识别目标机位：${target.label}`,
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: target.dataUrl,
          detail: target.detail,
        },
      });
    }
  }

  if (parsedRequest.screenshot) {
    content.push({
      type: 'text',
      text: '以下是此刻花园渲染器的实时截图。它只可用于描述实际画面中可见的外观，不可推断不可见状态。',
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: parsedRequest.screenshot.dataUrl,
        detail: parsedRequest.screenshot.detail,
      },
    });
  }

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: createSpatialAgentSystemPrompt() },
      { role: 'user', content },
    ],
  };

  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

export function resolveChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions')) return url.toString();
  url.pathname = pathname.endsWith('/v1') ? `${pathname}/chat/completions` : `${pathname}/v1/chat/completions`;
  return url.toString();
}

function extractChatCompletionContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  throw new FrameworkError('model_response_missing', '多模态模型没有返回可用文本');
}

function parseModelJson(content) {
  const unwrapped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unwrapped);
  } catch {
    throw new FrameworkError('model_response_not_json', '多模态模型没有返回可解析的空间指令 JSON');
  }
}

/**
 * Small multimodal models often honour JSON mode but still use snake_case,
 * string confidence values, or an outer `directive` wrapper. Normalize only
 * those harmless presentation differences before the strict scene whitelist
 * validation below. Entity / plot references and executable actions are never
 * synthesized or relaxed here.
 */
export function normalizeSpatialAgentDirective(input) {
  const candidate = input?.directive && typeof input.directive === 'object'
    ? input.directive
    : (input?.result && typeof input.result === 'object'
      ? input.result
      : (input?.data && typeof input.data === 'object' ? input.data : input));
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;

  const rawAnswer = candidate.answer ?? candidate.reply ?? candidate.message ?? candidate.content ?? candidate.text;
  const rawConfidence = typeof candidate.confidence === 'string'
    ? Number.parseFloat(candidate.confidence)
    : candidate.confidence;
  const normalizedConfidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence))
    : 0.5;

  const observations = Array.isArray(candidate.observations)
    ? candidate.observations.flatMap((observation) => {
      if (!observation || typeof observation !== 'object' || typeof observation.statement !== 'string') return [];
      const entityId = observation.entityId ?? observation.entity_id;
      return [{
        ...(typeof entityId === 'string' && entityId.trim() ? { entityId: entityId.trim() } : {}),
        statement: observation.statement.trim().slice(0, 320),
      }];
    })
    : [];
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.flatMap((action) => {
      if (!action || typeof action !== 'object') return [];
      const entityId = action.entityId ?? action.entity_id;
      const plotId = action.plotId ?? action.plot_id;
      const reason = typeof action.reason === 'string' ? action.reason.trim().slice(0, 280) : undefined;
      if (action.type === 'focus_entity' && typeof entityId === 'string' && entityId.trim()) {
        return [{ type: 'focus_entity', entityId: entityId.trim(), ...(reason ? { reason } : {}) }];
      }
      if (action.type === 'recommend_plot' && typeof plotId === 'string' && plotId.trim() && reason) {
        return [{
          type: 'recommend_plot',
          plotId: plotId.trim(),
          ...(typeof entityId === 'string' && entityId.trim() ? { targetEntityId: entityId.trim() } : {}),
          reason,
        }];
      }
      if (action.type === 'propose_deployment'
        && typeof entityId === 'string' && entityId.trim()
        && typeof plotId === 'string' && plotId.trim()
        && reason) {
        return [{ type: 'propose_deployment', entityId: entityId.trim(), plotId: plotId.trim(), reason }];
      }
      return [];
    })
    : [];

  const rawVisualAssessment = candidate.visualAssessment ?? candidate.visual_assessment ?? null;
  const rawAssessmentEntityId = rawVisualAssessment?.entityId ?? rawVisualAssessment?.entity_id;
  const rawAssessmentSpeciesId = rawVisualAssessment?.speciesId ?? rawVisualAssessment?.species_id;
  const rawAssessmentConfidence = Number(rawVisualAssessment?.confidence);
  const visualAssessment = rawVisualAssessment && typeof rawVisualAssessment === 'object'
    && !Array.isArray(rawVisualAssessment)
    && typeof rawAssessmentEntityId === 'string' && rawAssessmentEntityId.trim()
    && ['peaShooter', 'cornPult', 'watermelonPult'].includes(rawAssessmentSpeciesId)
    && ['keep', 'uproot'].includes(rawVisualAssessment.recommendation)
    && typeof rawVisualAssessment.reason === 'string' && rawVisualAssessment.reason.trim()
    ? {
      entityId: rawAssessmentEntityId.trim(),
      speciesId: rawAssessmentSpeciesId,
      confidence: Number.isFinite(rawAssessmentConfidence)
        ? Math.min(1, Math.max(0, rawAssessmentConfidence > 1 ? rawAssessmentConfidence / 100 : rawAssessmentConfidence))
        : 0.5,
      recommendation: rawVisualAssessment.recommendation,
      reason: rawVisualAssessment.reason.trim().slice(0, 280),
    }
    : null;

  return {
    schemaVersion: candidate.schemaVersion ?? candidate.schema_version ?? SPATIAL_AGENT_SCHEMA,
    answer: typeof rawAnswer === 'string' ? rawAnswer.trim().slice(0, 1_400) : rawAnswer,
    confidence: normalizedConfidence,
    observations,
    actions,
    visualAssessment,
  };
}

export async function invokeOpenAICompatibleSpatialAgent({ config, request, fetchImpl = fetch }) {
  const checkedConfig = openAICompatibleVisionConfigSchema.parse(config);
  const checkedRequest = spatialAgentRequestSchema.parse(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), checkedConfig.timeoutMs);

  try {
    const response = await fetchImpl(resolveChatCompletionsUrl(checkedConfig.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${checkedConfig.apiKey}`,
      },
      body: JSON.stringify(buildOpenAICompatibleVisionRequest({
        model: checkedConfig.model,
        request: checkedRequest,
        jsonMode: checkedConfig.jsonMode,
      })),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new FrameworkError('model_request_failed', `多模态模型请求失败（HTTP ${response.status}）`, { status: response.status });
    }

    const directive = normalizeSpatialAgentDirective(
      parseModelJson(extractChatCompletionContent(await response.json())),
    );
    const validated = validateSpatialAgentDirective(directive, { scene: checkedRequest.scene });
    if (!validated.ok) {
      throw new FrameworkError('model_directive_rejected', `模型返回的空间指令未通过校验：${validated.reason}`);
    }
    return validated.value;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new FrameworkError('model_request_timeout', '多模态模型响应超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Turns an accepted model proposal into a confirmation-gated SceneCommand.
 * UI code must show it to the player and call SpatialRuntime.execute(...,
 * { confirmed: true }) only after an explicit confirmation click.
 */
export function createDeploymentCommandEnvelope({ rawManifest, action, commandId = 'spatial-agent:deployment' }) {
  const manifest = parseSceneManifest(rawManifest);
  if (!action || action.type !== 'propose_deployment') {
    throw new FrameworkError('invalid_deployment_action', '需要一个 propose_deployment 动作');
  }

  const plant = manifest.entities.find((entity) => entity.id === action.entityId);
  const plot = manifest.entities.find((entity) => entity.id === action.plotId);
  if (!plant) throw new FrameworkError('entity_missing', `部署对象不存在：${action.entityId}`);
  if (!plot || !isPlot(plot)) throw new FrameworkError('plot_missing', `部署地块不存在：${action.plotId}`);
  if (!getAffordances(plant).includes('deploy')) {
    throw new FrameworkError('entity_not_deployable', `对象不可部署：${action.entityId}`);
  }
  const occupant = getOccupancy(plot);
  if (occupant && occupant !== plant.id) {
    throw new FrameworkError('plot_occupied', `地块已被占用：${action.plotId}`);
  }

  return {
    commandId: `${commandId}:${action.entityId}:${action.plotId}`,
    baseRevision: manifest.revision,
    requiresConfirmation: true,
    explanation: action.reason,
    metadata: {
      source: 'spatial-agent',
      action: 'propose_deployment',
      entityId: plant.id,
      plotId: plot.id,
    },
    commands: [
      {
        type: 'SET_TRANSFORM',
        entityId: plant.id,
        transform: {
          position: clone(plot.transform.position),
          rotation: clone(plant.transform.rotation),
          scale: clone(plant.transform.scale),
        },
      },
      {
        type: 'SET_COMPONENT',
        entityId: plant.id,
        component: 'spatialAssignment',
        value: { plotId: plot.id },
      },
      {
        type: 'SET_COMPONENT',
        entityId: plot.id,
        component: 'occupancy',
        value: { entityId: plant.id },
      },
    ],
  };
}
