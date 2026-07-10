const SUMMARY_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 20_000;

export async function summarizeDiscovery(discovery) {
  const sourceText = await loadSourceText(discovery).catch(() => '');
  const baseText = [
    discovery.title,
    discovery.summary,
    sourceText
  ].filter(Boolean).join('\n');

  const sentences = splitSentences(cleanText(baseText));
  const terms = buildTerms(discovery);
  const ranked = sentences
    .map((sentence) => ({ sentence, score: scoreSentence(sentence, terms) }))
    .filter((item) => item.sentence.length >= 24)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.sentence);

  const highlights = ranked.length ? ranked : [discovery.summary || discovery.title].filter(Boolean);
  const localizedHighlights = buildChineseHighlights(discovery, highlights);
  const localizedKeyword = localizeTopic(discovery.keyword);
  const caveat = discovery.analysis?.authenticity === 'verified'
    ? '来源和启发式校验显示可信度较高，但仍建议打开原文确认细节。'
    : '该信息仍需复核，尤其是涉及官方发布、价格、模型能力或发布日期的表述。';

  return {
    generatedAt: new Date().toISOString(),
    language: 'zh-CN',
    method: 'local-extractive',
    content: [
      `这条信息来自 ${discovery.source}，主题与“${localizedKeyword}”相关。`,
      `核心内容：${localizedHighlights.join(' ')}`,
      `判断：热度 ${discovery.analysis?.heat ?? '-'}，可信度 ${discovery.analysis?.authenticityScore ?? '-'}，状态为 ${labelAuthenticity(discovery.analysis?.authenticity)}。`,
      `注意：${caveat}`
    ].join('\n\n')
  };
}

async function loadSourceText(discovery) {
  if (!discovery.url || discovery.url.startsWith('https://example.com/')) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(discovery.url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'hotspot-radar-mvp'
      }
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (contentType.includes('html')) return extractHtmlText(text);
    return text.slice(0, MAX_TEXT_CHARS);
  } finally {
    clearTimeout(timeout);
  }
}

function extractHtmlText(html) {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"))
    .slice(0, MAX_TEXT_CHARS);
}

function buildTerms(discovery) {
  return [...new Set([
    ...splitTerms(discovery.keyword),
    ...splitTerms(discovery.scope),
    ...splitTerms(discovery.title),
    'release',
    'launch',
    'model',
    'agent',
    'coding',
    'benchmark',
    'update',
    '发布',
    '模型',
    '编程',
    '更新'
  ].filter((term) => term.length >= 2))];
}

function scoreSentence(sentence, terms) {
  const normalized = sentence.toLowerCase();
  let score = Math.min(40, sentence.length / 12);
  for (const term of terms) {
    if (normalized.includes(term.toLowerCase())) score += 12;
  }
  if (/\b(today|now|new|release|launch|update|benchmark|agent|model)\b/i.test(sentence)) score += 8;
  if (/[。！？]/.test(sentence)) score += 2;
  return score;
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function splitTerms(value) {
  const normalized = cleanText(value).toLowerCase();
  const english = normalized.split(/[^a-z0-9+#.-]+/i).filter((token) => token.length > 2);
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...english, ...chinese];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function labelAuthenticity(value) {
  if (value === 'verified') return '较可信';
  if (value === 'needs-review') return '待复核';
  return '可疑';
}

function localizeSentence(sentence) {
  const original = cleanText(sentence);
  if (!original) return '';

  let text = original;
  text = text
    .replace(/^Stars:\s*/i, 'GitHub 星标：')
    .replace(/\bUpdated:\s*/i, '更新时间：')
    .replace(/\bPublished:\s*/i, '发布时间：')
    .replace(/\bComments:\s*/i, '评论数：')
    .replace(/\bHN points:\s*/i, 'Hacker News 点数：');

  const replacements = [
    [/Terminal AI coding agent/gi, '终端 AI 编程代理'],
    [/AI coding agent/gi, 'AI 编程代理'],
    [/coding agents/gi, '编程代理'],
    [/coding agent/gi, '编程代理'],
    [/macOS terminal app/gi, 'macOS 终端应用'],
    [/terminal app/gi, '终端应用'],
    [/runs local models/gi, '可运行本地模型'],
    [/running and managing/gi, '运行和管理'],
    [/for running and managing/gi, '用于运行和管理'],
    [/Connect to/gi, '可连接'],
    [/any OpenAI-compatible server/gi, '任意 OpenAI 兼容服务'],
    [/OpenAI-compatible server/gi, 'OpenAI 兼容服务'],
    [/load a GGUF directly/gi, '直接加载 GGUF'],
    [/plus optional cloud providers/gi, '并支持可选云服务提供商'],
    [/optional cloud providers/gi, '可选云服务提供商'],
    [/No cloud or API keys required/gi, '不需要云端服务或 API Key'],
    [/No cloud/gi, '不需要云端服务'],
    [/API keys required/gi, '需要 API Key'],
    [/model tooling update is gaining developer attention/gi, '模型工具更新正在受到开发者关注'],
    [/A local sample item used to verify the notification and review flow without external network access/gi, '这是一条用于在无外部网络时验证通知和复核流程的本地示例信息'],
    [/used to verify/gi, '用于验证'],
    [/notification and review flow/gi, '通知和复核流程'],
    [/without external network access/gi, '无外部网络访问'],
    [/repository update/gi, '仓库更新'],
    [/developer attention/gi, '开发者关注'],
    [/AI coding/gi, 'AI 编程'],
    [/AI programming/gi, 'AI 编程'],
    [/local models/gi, '本地模型'],
    [/cloud providers/gi, '云服务提供商'],
    [/release/gi, '发布'],
    [/launch/gi, '上线'],
    [/benchmark/gi, '基准测试'],
    [/updated/gi, '已更新'],
    [/published/gi, '已发布']
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/\bor\b/gi, '或')
    .replace(/\bthat\b/gi, '，')
    .replace(/\s+—\s+/g, '，')
    .replace(/\s+-\s+/g, '，')
    .replace(/\s*;\s*/g, '；')
    .replace(/\s*,\s*/g, '，')
    .replace(/\s*\.\s*/g, '。')
    .replace(/，\s*，/g, '，')
    .replace(/，\s*或\s*/g, '，或')
    .replace(/或\s+/g, '或')
    .replace(/或API/g, '或 API')
    .replace(/\s+([，。：；])/g, '$1')
    .replace(/([，。：；])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (looksMostlyEnglish(text) && text === original) {
    return summarizeEnglishSignals(original) || '';
  }

  if (looksMostlyEnglish(text)) {
    return summarizeEnglishSignals(original) || '';
  }

  return text;
}

function buildChineseHighlights(discovery, highlights) {
  const facts = [];
  addFacts(facts, summarizeEnglishSignals(`${discovery.title} ${discovery.summary || ''}`, discovery));
  addFact(facts, summarizeMetadata(discovery.summary));

  if (facts.length < 2) {
    for (const highlight of highlights) {
      if (/^\s*(Stars|Updated|Published|Comments|HN points):/i.test(highlight)) continue;
      const localized = localizeSentence(highlight);
      if (localized && !looksMostlyEnglish(localized)) addFact(facts, localized);
    }
  }

  if (!facts.length) {
    addFact(facts, `${discovery.source || '该来源'} 的信息显示，这条内容与“${localizeTopic(discovery.keyword)}”相关，建议打开原文进一步核验。`);
  }

  return facts.slice(0, 4);
}

function addFact(facts, value) {
  const text = cleanText(value);
  if (!text) return;
  if (!facts.some((item) => item === text)) facts.push(text);
}

function addFacts(facts, value) {
  for (const sentence of cleanText(value).split(/(?<=。)\s*/)) {
    addFact(facts, sentence);
  }
}

function summarizeEnglishSignals(value, discovery = {}) {
  const text = cleanText(value);
  if (!text) return '';

  const lower = text.toLowerCase();
  const repoMatch = text.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+):\s*(.+)$/i);
  const subject = repoMatch ? `GitHub 项目 ${repoMatch[1]}` : '这条信息';
  const facts = [];

  if (lower.includes('macos terminal app')) {
    facts.push(`${subject} 是一个 macOS 终端应用，面向 AI 编程代理的运行和管理场景。`);
  } else if (lower.includes('terminal') && lower.includes('coding agent')) {
    facts.push(`${subject} 定位为终端里的 AI 编程代理工具。`);
  } else if (lower.includes('coding agent')) {
    facts.push(`${subject} 与 AI 编程代理工作流有关。`);
  }

  if (lower.includes('mcp server')) {
    facts.push(`${subject} 提供 MCP 服务，用于把 AI 编程工具连接到外部系统或工作流。`);
  }

  if (lower.includes('pulseagent')) {
    facts.push('它提到 PulseAgent，可让 Claude Code、Cursor、Codex 等工具连接 AI 数字员工、CRM 或业务管线。');
  }

  if (lower.includes('ollama') || lower.includes('openai-compatible') || lower.includes('gguf')) {
    const capabilities = [];
    if (lower.includes('ollama')) capabilities.push('连接 Ollama');
    if (lower.includes('openai-compatible')) capabilities.push('连接 OpenAI 兼容服务');
    if (lower.includes('gguf')) capabilities.push('直接加载 GGUF 模型');
    facts.push(`它的能力重点是${joinChinese(capabilities)}。`);
  }

  if (lower.includes('local model')) {
    facts.push('它强调可在本地运行模型。');
  }

  if (lower.includes('no cloud') || lower.includes('api keys required')) {
    facts.push('它强调不需要云端服务或 API Key。');
  }

  if (lower.includes('markdown') && lower.includes('publish')) {
    facts.push(`${subject} 面向内容发布流程，可把 Markdown 内容发布到博客、微信、知乎、小红书等平台。`);
  }

  if (lower.includes('claude code skill')) {
    facts.push('它提供 Claude Code 技能相关能力，适合中文社交媒体内容分发。');
  }

  if (lower.includes('wechat') || lower.includes('zhihu') || lower.includes('xiaohongshu')) {
    facts.push('目标平台包括微信、知乎和小红书等中文内容渠道。');
  }

  if (lower.includes('model tooling update is gaining developer attention')) {
    facts.push('这是一条模型工具更新相关信号，正在受到开发者关注。');
  }

  if (!facts.length && repoMatch) {
    facts.push(`${subject} 的标题显示它与“${localizeTopic(discovery.keyword)}”相关，但自动摘要无法稳定翻译更多细节，建议打开来源核验。`);
  }

  return facts.join(' ');
}

function summarizeMetadata(value) {
  const text = cleanText(value);
  if (!text) return '';
  const parts = [];
  const stars = text.match(/Stars:\s*(\d+)/i);
  const updated = text.match(/Updated:\s*([0-9T:.-]+Z?)/i);
  const comments = text.match(/Comments:\s*(\d+)/i);
  if (stars) parts.push(`GitHub 星标 ${stars[1]}`);
  if (comments) parts.push(`评论数 ${comments[1]}`);
  if (updated) parts.push(`更新时间 ${updated[1]}`);
  return parts.length ? `${parts.join('；')}。` : '';
}

function joinChinese(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]}和${items[1]}`;
  return `${items.slice(0, -1).join('、')}和${items.at(-1)}`;
}

function looksMostlyEnglish(value) {
  const letters = (String(value).match(/[a-z]/gi) || []).length;
  const chinese = (String(value).match(/[\u4e00-\u9fff]/g) || []).length;
  return letters > chinese * 1.5 && letters > 20;
}

function localizeTopic(value) {
  return cleanText(value)
    .replace(/AI coding/gi, 'AI 编程')
    .replace(/AI programming/gi, 'AI 编程')
    .replace(/LLM agents/gi, '大模型智能体')
    .replace(/model releases/gi, '模型发布')
    || '未知主题';
}
