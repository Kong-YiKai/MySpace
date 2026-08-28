import { describe, expect, it } from 'vitest';
import { formatDaveDialogue } from './dave-dialogue.js';

describe('Dave player-facing dialogue', () => {
  it('turns a structured provider report into one spoken line with a translation', () => {
    const line = formatDaveDialogue('歪比巴布！\n【观察】 当前选中的是花圃 A，豌豆射手处于 sprout 阶段。\n【下一步】 切换水壶浇水。');

    expect(line).toMatch(/^歪比巴布，阿喔柔！胡萝卜扳手！（/);
    expect(line).toContain('花圃 A，豌豆射手处于幼苗阶段。');
    expect(line).not.toMatch(/[【】]/);
    expect(line).not.toContain('sprout');
  });

  it('keeps an already-parenthesized model translation from gaining nested parentheses', () => {
    const line = formatDaveDialogue('阿喔柔！（玉米投手很健康，暂时不需要浇水。）', { variant: 1 });

    expect(line).toBe('阿吧阿吧，歪比巴布！土豆闹钟！（玉米投手很健康，暂时不需要浇水。）');
  });
});
