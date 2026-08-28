const DAVE_GIBBERISH = Object.freeze([
  '歪比巴布，阿喔柔！胡萝卜扳手！',
  '阿吧阿吧，歪比巴布！土豆闹钟！',
  '歪比巴布！玉米胡子转圈圈！',
  '阿喔柔，啊吧啊吧！西瓜望远镜！',
]);

const INTERNAL_SECTION_MARKERS = /[【\[]\s*(?:观察|判断|下一步|状态|分析|建议|observation|assessment|next\s*step)\s*[】\]]\s*/gi;
const INTERNAL_PREFIXES = /^(?:观察|判断|下一步|状态|分析|建议)\s*[:：]\s*/gim;
const DAVE_NOISE_PREFIX = /^(?:(?:歪比巴布|阿喔柔|阿吧阿吧|啊吧啊吧)[，,！!。\s]*){1,3}/;
const TECHNICAL_WORDS = Object.freeze([
  [/\bsprout\b/gi, '幼苗'],
  [/\bseed\b/gi, '种子'],
  [/\bjuvenile\b/gi, '青年期'],
  [/\bmature\b/gi, '成熟期'],
  [/\breadyToClaim\b/gi, '可收获'],
  [/\b(?:plotId|speciesId|entityId|stage)\b\s*[:=：]\s*[^，。；；\n]+/gi, ''],
]);

function unwrapModelJson(text) {
  if (!text.startsWith('{') || !text.endsWith('}')) return text;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.answer === 'string' ? parsed.answer : text;
  } catch {
    return text;
  }
}

function stripOuterParentheses(text) {
  let next = text.trim();
  // 小模型偶尔已经按“疯话（翻译）”输出；前端还会统一加自己的角色前缀。
  // 抽取其最后一层翻译并反复剥掉括号，避免出现“疯话（疯话（翻译））”。
  for (let depth = 0; depth < 3; depth += 1) {
    const opening = next.indexOf('（') >= 0 ? next.indexOf('（') : next.indexOf('(');
    const closing = Math.max(next.lastIndexOf('）'), next.lastIndexOf(')'));
    if (opening < 0 || closing <= opening) break;
    const prefix = next.slice(0, opening);
    if (depth === 0 && prefix && !/(?:歪比巴布|阿喔柔|阿吧阿吧|啊吧啊吧)/.test(prefix)) break;
    next = next.slice(opening + 1, closing).trim();
  }
  return next;
}

/**
 * The model's answer is player-facing text, not an internal scene report.  Keep
 * one deterministic presentation grammar even when a provider slips a heading
 * or an English state name into an otherwise valid response.
 */
export function formatDaveDialogue(message, { variant = 0 } = {}) {
  let translation = unwrapModelJson(String(message ?? '').trim())
    .replace(/```(?:json)?/gi, '')
    .replace(INTERNAL_SECTION_MARKERS, '')
    .replace(INTERNAL_PREFIXES, '')
    .replace(/^\s*(?:[-*•]\s*)+/gm, '')
    .replace(/\*{1,3}/g, '');

  for (const [pattern, replacement] of TECHNICAL_WORDS) {
    translation = translation.replace(pattern, replacement);
  }

  translation = stripOuterParentheses(translation.replace(DAVE_NOISE_PREFIX, '').trim())
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    // 英文阶段名替换为中文后，清掉模型原来在单词两侧留下的空格。
    .replace(/\s*(幼苗|种子|青年期|成熟期)\s*阶段/g, '$1阶段')
    .replace(/\s+([，。！？；）])/g, '$1')
    .trim();

  if (!translation) {
    translation = '我刚才看花园看得有点眼花。你再问我一次，我会把这株植物仔细瞧清楚。';
  }

  // 避免网络错误或异常返回把一整页技术文本塞满对话框；完整错误仍保留在控制台。
  if (translation.length > 260) translation = `${translation.slice(0, 257).trimEnd()}…`;
  const phrase = DAVE_GIBBERISH[Math.abs(variant) % DAVE_GIBBERISH.length];
  return `${phrase}（${translation}）`;
}
