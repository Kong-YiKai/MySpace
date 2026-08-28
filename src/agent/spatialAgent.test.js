import { describe, expect, it } from 'vitest';
import { SpatialRuntime } from '../runtime/SpatialRuntime.js';
import {
  buildOpenAICompatibleVisionRequest,
  createDeploymentCommandEnvelope,
  createSpatialAgentSceneContext,
  createSpatialAgentSystemPrompt,
  normalizeSpatialAgentDirective,
  resolveChatCompletionsUrl,
  validateSpatialAgentDirective,
} from './spatialAgent.js';

const backyardManifest = {
  schemaVersion: '1.0',
  sceneId: 'backyard-garden-001',
  entities: [
    {
      id: 'plot-a',
      label: '左前地块',
      kind: 'spatial-anchor',
      transform: { position: [-2, 0, 2] },
      tags: ['plot'],
      components: { semantic: { category: 'plot' }, spatialAnchor: { type: 'plot', capacity: 1 } },
    },
    {
      id: 'plot-b',
      label: '右前地块',
      kind: 'spatial-anchor',
      transform: { position: [2, 0, 2] },
      tags: ['plot'],
      components: {
        semantic: { category: 'plot' },
        spatialAnchor: { type: 'plot', capacity: 1 },
        occupancy: { entityId: 'corn-thrower-01' },
      },
    },
    {
      id: 'pea-shooter-01',
      label: '豌豆射手',
      kind: 'plant',
      transform: { position: [0, 0, -3] },
      components: {
        semantic: { category: 'plant', role: 'ranged', abilities: ['projectile'], affordances: ['inspect', 'deploy', 'relocate'] },
      },
    },
    {
      id: 'corn-thrower-01',
      label: '玉米投手',
      kind: 'plant',
      transform: { position: [2, 0, 2] },
      components: {
        semantic: { category: 'plant', role: 'control', abilities: ['stun'], affordances: ['inspect', 'deploy', 'relocate'] },
      },
    },
  ],
};

describe('spatial agent protocol', () => {
  it('distills a generic manifest into a model-safe spatial scene brief', () => {
    const context = createSpatialAgentSceneContext(backyardManifest);

    expect(context.sceneId).toBe('backyard-garden-001');
    expect(context.plots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plot-a', occupiedBy: null }),
      expect.objectContaining({ id: 'plot-b', occupiedBy: 'corn-thrower-01' }),
    ]));
    expect(context.entities.find((entity) => entity.id === 'pea-shooter-01')).toMatchObject({
      affordances: ['inspect', 'deploy', 'relocate'],
    });
  });

  it('builds a multimodal Chat Completions request without embedding a provider key', () => {
    const scene = createSpatialAgentSceneContext(backyardManifest);
    const request = buildOpenAICompatibleVisionRequest({
      model: 'luna',
      request: {
        question: '豌豆射手适合放哪里？',
        scene,
        screenshot: { dataUrl: 'data:image/png;base64,ZmFrZS1zY3JlZW5zaG90', detail: 'low' },
        referenceImages: [{
          id: 'pea-sprout:front',
          label: '青年豌豆射手·正面',
          dataUrl: 'data:image/png;base64,ZmFrZS1yZWZlcmVuY2UtaW1hZ2U=',
          detail: 'low',
        }],
        targetImages: [{
          id: 'mystery-plant:front',
          label: '待识别神秘青年植株·正面',
          dataUrl: 'data:image/png;base64,ZmFrZS10YXJnZXQtaW1hZ2U=',
          detail: 'low',
        }],
      },
    });

    expect(request.model).toBe('luna');
    expect(request.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'image_url' }),
    ]));
    expect(request.messages[1].content.filter((part) => part.type === 'image_url')).toHaveLength(3);
    expect(request.messages[1].content.some((part) => part.type === 'text' && part.text.includes('青年豌豆射手'))).toBe(true);
    expect(resolveChatCompletionsUrl('https://example.test/v1')).toBe('https://example.test/v1/chat/completions');
    expect(resolveChatCompletionsUrl('https://example.test/v1/chat/completions')).toBe('https://example.test/v1/chat/completions');
  });

  it('asks the model for a player-facing Dave line instead of a structured field report', () => {
    const prompt = createSpatialAgentSystemPrompt();

    expect(prompt).toContain('一小段不承载事实的疯话 + 一对中文圆括号中的翻译');
    expect(prompt).toContain('严禁输出标题、分段标签、Markdown、项目符号、字段名');
    expect(prompt).not.toContain('三段式写法');
  });

  it('normalizes harmless Qwen-style JSON differences before strict scene validation', () => {
    const normalized = normalizeSpatialAgentDirective({
      schema_version: 'spatial-agent.v1',
      reply: '歪比巴布！花圃 A 目前空闲。',
      confidence: '88',
      observations: null,
      actions: null,
    });

    expect(normalized).toEqual({
      schemaVersion: 'spatial-agent.v1',
      answer: '歪比巴布！花圃 A 目前空闲。',
      confidence: 0.88,
      observations: [],
      actions: [],
      visualAssessment: null,
    });
  });

  it('drops malformed optional model suggestions instead of hiding an otherwise valid answer', () => {
    const normalized = normalizeSpatialAgentDirective({
      data: {
        content: '阿喔柔！花圃 A 还空着。',
        confidence: '0.74',
        observations: [{ entity_id: 'plot-a', statement: '空闲' }, { nope: true }],
        actions: [{ type: 'garden_command', command: 'plant' }, { type: 'focus_entity', entity_id: 'plot-a' }],
      },
    });

    expect(normalized).toEqual({
      schemaVersion: 'spatial-agent.v1',
      answer: '阿喔柔！花圃 A 还空着。',
      confidence: 0.74,
      observations: [{ entityId: 'plot-a', statement: '空闲' }],
      actions: [{ type: 'focus_entity', entityId: 'plot-a' }],
      visualAssessment: null,
    });
  });

  it('keeps a constrained mystery-seed visual assessment while rejecting unknown targets', () => {
    const scene = createSpatialAgentSceneContext(backyardManifest);
    const normalized = normalizeSpatialAgentDirective({
      answer: '歪比巴布！（看起来是圆润的西瓜青年植株。）',
      confidence: 0.9,
      visual_assessment: {
        entity_id: 'pea-shooter-01',
        species_id: 'watermelonPult',
        confidence: '86',
        recommendation: 'keep',
        reason: '瓜体有清晰的深浅绿条纹。',
      },
    });

    expect(normalized.visualAssessment).toEqual({
      entityId: 'pea-shooter-01',
      speciesId: 'watermelonPult',
      confidence: 0.86,
      recommendation: 'keep',
      reason: '瓜体有清晰的深浅绿条纹。',
    });
    expect(validateSpatialAgentDirective(normalized, { scene }).ok).toBe(true);
    expect(validateSpatialAgentDirective({
      ...normalized,
      visualAssessment: { ...normalized.visualAssessment, entityId: 'unknown-mystery-plant' },
    }, { scene })).toMatchObject({ ok: false, reason: 'visual-assessment-target-unknown' });
  });

  it('rejects a model proposal that names a plot outside the active scene', () => {
    const scene = createSpatialAgentSceneContext(backyardManifest);
    const result = validateSpatialAgentDirective({
      schemaVersion: 'spatial-agent.v1',
      answer: '可以放到那里。',
      confidence: 0.7,
      actions: [{ type: 'propose_deployment', entityId: 'pea-shooter-01', plotId: 'plot-z', reason: '虚构地块' }],
    }, { scene });

    expect(result).toMatchObject({ ok: false, reason: 'deployment-plot-unknown' });
  });

  it('rejects state-changing garden commands from the read-only garden adviser contract', () => {
    const scene = createSpatialAgentSceneContext(backyardManifest);
    const rejected = validateSpatialAgentDirective({
      schemaVersion: 'spatial-agent.v1',
      answer: '歪比巴布！花圃 A 空着，可以种豌豆。',
      confidence: 0.92,
      actions: [{
        type: 'garden_command',
        command: 'plant',
        plotId: 'plot-a',
        speciesId: 'peaShooter',
        reason: '玩家明确要求播种，且花圃 A 在场景图中为空。',
      }],
    }, { scene });
    expect(rejected).toMatchObject({ ok: false });
  });

  it('creates a confirmation-gated command envelope for an accepted deployment', async () => {
    const runtime = new SpatialRuntime({ manifest: backyardManifest });
    const envelope = createDeploymentCommandEnvelope({
      rawManifest: runtime.getManifest(),
      action: { type: 'propose_deployment', entityId: 'pea-shooter-01', plotId: 'plot-a', reason: '前排射线更清楚' },
    });

    await expect(runtime.execute(envelope)).rejects.toMatchObject({ code: 'confirmation_required' });
    await runtime.execute(envelope, { confirmed: true });
    const next = runtime.getManifest();
    expect(next.entities.find((entity) => entity.id === 'pea-shooter-01').transform.position).toEqual([-2, 0, 2]);
    expect(next.entities.find((entity) => entity.id === 'plot-a').components.occupancy).toEqual({ entityId: 'pea-shooter-01' });
  });
});
