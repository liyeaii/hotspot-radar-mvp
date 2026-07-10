const replacements = [
  [/One Markdown\s*(?:→|->)\s*publish to blog\s*\+\s*WeChat\s*\+\s*Zhihu\s*\+\s*Xiaohongshu/gi, '一份 Markdown 内容可发布到博客、微信、知乎和小红书'],
  [/Claude Code skill for Chinese social media content distribution/gi, '面向中文社交媒体内容分发的 Claude Code 技能'],
  [/MCP server for PulseAgent/gi, '面向 PulseAgent 的 MCP 服务'],
  [/let Claude Code,\s*Cursor,\s*and Codex interact with your AI digital workers,\s*CRM,\s*and pipeline/gi, '让 Claude Code、Cursor 和 Codex 与 AI 数字员工、CRM 和业务管线交互'],
  [/macOS terminal app for running and managing AI coding agents(?:\s*\(Terminal \+ Terrarium\))?/gi, '用于运行和管理 AI 编程代理的 macOS 终端应用'],
  [/Terminal AI coding agent that runs local models/gi, '可运行本地模型的终端 AI 编程代理'],
  [/Connect to Ollama,\s*any OpenAI-compatible server,\s*or load a GGUF directly/gi, '可连接 Ollama、任意 OpenAI 兼容服务，或直接加载 GGUF 模型'],
  [/plus optional cloud providers/gi, '并支持可选云服务商'],
  [/No cloud or API keys required/gi, '不需要云端服务或 API Key'],
  [/model tooling update is gaining developer attention/gi, '模型工具更新正在受到开发者关注'],
  [/repository update/gi, '仓库更新'],
  [/AI coding agents?/gi, 'AI 编程代理'],
  [/coding agents?/gi, '编程代理'],
  [/AI coding/gi, 'AI 编程'],
  [/AI programming/gi, 'AI 编程'],
  [/terminal app/gi, '终端应用'],
  [/local models?/gi, '本地模型'],
  [/OpenAI-compatible server/gi, 'OpenAI 兼容服务'],
  [/cloud providers?/gi, '云服务商'],
  [/digital workers?/gi, '数字员工'],
  [/pipeline/gi, '业务管线'],
  [/publish/gi, '发布'],
  [/blog/gi, '博客'],
  [/release/gi, '发布'],
  [/launch/gi, '上线'],
  [/update/gi, '更新'],
  [/benchmark/gi, '基准测试'],
  [/developer attention/gi, '开发者关注']
];

export function localizeDiscoveryTitle(discovery) {
  const original = clean(discovery?.title);
  if (!original) return '';
  if (hasChinese(original)) return original;

  const repoMatch = original.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+):\s*(.+)$/i);
  if (repoMatch) {
    const repo = repoMatch[1];
    const translatedDescription = translateText(repoMatch[2]);
    return `GitHub 项目 ${repo}：${ensureChineseTitle(translatedDescription, original, discovery)}`;
  }

  const translated = translateText(original);
  return ensureChineseTitle(translated, original, discovery);
}

function translateText(value) {
  let text = clean(value);
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/\s*(?:—|–|-)\s*/g, '：')
    .replace(/\s*->\s*/g, '：')
    .replace(/\s*\+\s*/g, '、')
    .replace(/\s*,\s*/g, '，')
    .replace(/\s*;\s*/g, '；')
    .replace(/\s*\.\s*/g, '。')
    .replace(/\bor\b/gi, '或')
    .replace(/\band\b/gi, '和')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/。$/, '');
}

function ensureChineseTitle(translated, original, discovery) {
  if (hasChinese(translated) && !looksMostlyEnglish(translated)) return translated;

  const fallback = summarizeTitleSignals(original, discovery);
  if (fallback) return fallback;

  const topic = translateTopic(discovery?.keyword || discovery?.scope || '');
  return topic ? `与${topic}相关的新动态，建议打开来源核验` : '发现一条新的热点动态，建议打开来源核验';
}

function summarizeTitleSignals(value, discovery) {
  const text = clean(value).toLowerCase();
  const facts = [];
  const topic = translateTopic(discovery?.keyword || discovery?.scope || '');

  if (text.includes('mcp')) facts.push('MCP 服务');
  if (text.includes('agent')) facts.push('智能体或编程代理');
  if (text.includes('coding')) facts.push('AI 编程');
  if (text.includes('model') || text.includes('llm')) facts.push('大模型');
  if (text.includes('release') || text.includes('launch') || text.includes('update')) facts.push('发布或更新');
  if (text.includes('benchmark')) facts.push('基准测试');
  if (text.includes('github')) facts.push('开源项目');

  const uniqueFacts = [...new Set(facts)];
  if (!uniqueFacts.length && !topic) return '';
  return `${topic || uniqueFacts[0]}相关动态：${uniqueFacts.length ? uniqueFacts.join('、') : '热点信息'}。`;
}

function translateTopic(value) {
  return clean(value)
    .replace(/AI coding/gi, 'AI 编程')
    .replace(/AI programming/gi, 'AI 编程')
    .replace(/LLM agents?/gi, '大模型智能体')
    .replace(/model releases?/gi, '模型发布');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(value);
}

function looksMostlyEnglish(value) {
  const letters = (String(value).match(/[a-z]/gi) || []).length;
  const chinese = (String(value).match(/[\u4e00-\u9fff]/g) || []).length;
  return letters > chinese * 1.35 && letters > 18;
}
