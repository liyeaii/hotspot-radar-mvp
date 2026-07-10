const REQUEST_TIMEOUT_MS = 8_000;

export const SOURCE_CATALOG = [
  { id: 'google-news', name: 'Google News', description: '新闻聚合，适合第一时间发现传播中的热点。' },
  { id: 'official-feeds', name: '官方/厂商博客', description: 'OpenAI、Anthropic、Google、GitHub、Microsoft、Hugging Face 等 RSS。' },
  { id: 'hacker-news', name: 'Hacker News', description: '开发者社区讨论和早期信号。' },
  { id: 'github', name: 'GitHub', description: '仓库更新、开源项目和开发工具趋势。' },
  { id: 'arxiv', name: 'arXiv', description: '论文和研究动态。' },
  { id: 'devto', name: 'DEV Community', description: '开发者文章和实践分享。' }
];

export const DEFAULT_SOURCE_IDS = SOURCE_CATALOG.map((source) => source.id);

const OFFICIAL_FEEDS = [
  { source: 'OpenAI News', url: 'https://openai.com/news/rss.xml', sourceType: 'official' },
  { source: 'Anthropic News', url: 'https://www.anthropic.com/news/rss.xml', sourceType: 'official' },
  { source: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', sourceType: 'official' },
  { source: 'Google Developers', url: 'https://developers.googleblog.com/feeds/posts/default', sourceType: 'official' },
  { source: 'GitHub Blog', url: 'https://github.blog/feed/', sourceType: 'official' },
  { source: 'Microsoft AI Blog', url: 'https://blogs.microsoft.com/ai/feed/', sourceType: 'official' },
  { source: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', sourceType: 'official' },
  { source: 'LangChain Blog', url: 'https://blog.langchain.com/rss/', sourceType: 'vendor' },
  { source: 'Vercel Blog', url: 'https://vercel.com/blog/rss.xml', sourceType: 'vendor' }
];

export async function collectForKeyword(keywordConfig) {
  const enabledSources = normalizeSourceIds(keywordConfig.enabledSources);
  const collectors = [
    { id: 'google-news', collect: fromGoogleNews },
    { id: 'official-feeds', collect: fromOfficialFeeds },
    { id: 'hacker-news', collect: fromHackerNews },
    { id: 'github', collect: fromGitHub },
    { id: 'arxiv', collect: fromArxiv },
    { id: 'devto', collect: fromDevTo }
  ].filter((collector) => enabledSources.includes(collector.id));
  const batches = await Promise.allSettled(collectors.map((collector) => collector.collect(keywordConfig)));
  return uniqueItems(batches
    .filter((batch) => batch.status === 'fulfilled')
    .flatMap((batch) => batch.value))
    .slice(0, 80);
}

export function normalizeSourceIds(sourceIds) {
  const allowed = new Set(SOURCE_CATALOG.map((source) => source.id));
  const selected = Array.isArray(sourceIds) ? sourceIds.filter((id) => allowed.has(id)) : DEFAULT_SOURCE_IDS;
  return selected.length ? [...new Set(selected)] : DEFAULT_SOURCE_IDS;
}

export function buildSearchQueries(keywordConfig) {
  const keyword = clean(keywordConfig.keyword);
  const scope = clean(keywordConfig.scope);
  return [...new Set([keyword, scope, `${keyword} ${scope}`.trim()].filter(Boolean))].slice(0, 3);
}

async function fromGoogleNews(keywordConfig) {
  const queries = buildSearchQueries(keywordConfig);
  const batches = await Promise.allSettled(queries.map(async (query) => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await fetchText(url);
    return parseFeed(xml, { source: 'Google News', sourceType: 'news', matchedQuery: query }).slice(0, 10);
  }));
  return flattenSettled(batches);
}

async function fromOfficialFeeds(keywordConfig) {
  const terms = buildMatchTerms(keywordConfig);
  const batches = await Promise.allSettled(OFFICIAL_FEEDS.map(async (feed) => {
    const xml = await fetchText(feed.url);
    return parseFeed(xml, feed)
      .filter((item) => matchesTerms(`${item.title} ${item.summary}`, terms))
      .slice(0, 8);
  }));
  return flattenSettled(batches);
}

async function fromHackerNews(keywordConfig) {
  const queries = buildSearchQueries(keywordConfig).slice(0, 2);
  const batches = await Promise.allSettled(queries.map(async (query) => {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=12&query=${encodeURIComponent(query)}`;
    const data = await fetchJson(url);
    return (data.hits || []).map((hit) => ({
      title: hit.title || hit.story_title || '',
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: 'Hacker News',
      sourceType: 'community',
      matchedQuery: query,
      summary: `HN points: ${hit.points || 0}. Comments: ${hit.num_comments || 0}.`,
      publishedAt: hit.created_at
    })).filter((item) => item.title);
  }));
  return flattenSettled(batches);
}

async function fromGitHub(keywordConfig) {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const queries = buildSearchQueries(keywordConfig).slice(0, 2);
  const batches = await Promise.allSettled(queries.map(async (queryText) => {
    const query = `${queryText} pushed:>${since}`;
    const url = `https://api.github.com/search/repositories?sort=updated&order=desc&per_page=10&q=${encodeURIComponent(query)}`;
    const data = await fetchJson(url, { headers: { 'user-agent': 'hotspot-radar-mvp' } });
    return (data.items || []).map((repo) => ({
      title: `${repo.full_name}: ${repo.description || 'repository update'}`,
      url: repo.html_url,
      source: 'GitHub',
      sourceType: 'code',
      matchedQuery: queryText,
      summary: `Stars: ${repo.stargazers_count}. Updated: ${repo.updated_at}.`,
      publishedAt: repo.updated_at
    }));
  }));
  return flattenSettled(batches);
}

async function fromArxiv(keywordConfig) {
  const queries = buildSearchQueries(keywordConfig).slice(0, 2);
  const batches = await Promise.allSettled(queries.map(async (query) => {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=8`;
    const xml = await fetchText(url);
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
      const entry = match[1];
      return {
        title: stripXml(readTag(entry, 'title')),
        url: readTag(entry, 'id'),
        source: 'arXiv',
        sourceType: 'paper',
        matchedQuery: query,
        summary: stripXml(readTag(entry, 'summary')).slice(0, 320),
        publishedAt: readTag(entry, 'published')
      };
    }).filter((item) => item.title);
  }));
  return flattenSettled(batches);
}

async function fromDevTo(keywordConfig) {
  const tag = chooseDevToTag(keywordConfig);
  const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=20&top=7`;
  const data = await fetchJson(url);
  const terms = buildMatchTerms(keywordConfig);
  return (data || [])
    .map((article) => ({
      title: article.title,
      url: article.url,
      source: 'DEV Community',
      sourceType: 'community',
      matchedQuery: tag,
      summary: article.description || '',
      publishedAt: article.published_at
    }))
    .filter((item) => matchesTerms(`${item.title} ${item.summary}`, terms))
    .slice(0, 12);
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeed(xml, feed) {
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return entries.map((match) => {
    const body = match[2];
    const link = readTag(body, 'link') || readAtomLink(body);
    return {
      title: decodeEntities(stripXml(readTag(body, 'title'))),
      url: decodeEntities(link),
      source: feed.source,
      sourceType: feed.sourceType,
      matchedQuery: feed.matchedQuery || '',
      summary: decodeEntities(stripXml(readTag(body, 'description') || readTag(body, 'summary') || readTag(body, 'content'))).slice(0, 420),
      publishedAt: readTag(body, 'pubDate') || readTag(body, 'published') || readTag(body, 'updated') || null
    };
  }).filter((item) => item.title && item.url);
}

function buildMatchTerms(keywordConfig) {
  return [...new Set([
    ...splitTerms(keywordConfig.keyword),
    ...splitTerms(keywordConfig.scope),
    clean(keywordConfig.keyword),
    clean(keywordConfig.scope)
  ].filter((term) => term.length >= 2))];
}

function matchesTerms(text, terms) {
  const normalized = clean(text);
  if (!terms.length) return true;
  return terms.some((term) => normalized.includes(clean(term)));
}

function chooseDevToTag(keywordConfig) {
  const text = clean(`${keywordConfig.keyword} ${keywordConfig.scope}`);
  if (text.includes('javascript') || text.includes('typescript')) return 'javascript';
  if (text.includes('python')) return 'python';
  if (text.includes('agent')) return 'ai';
  if (text.includes('programming') || text.includes('coding') || text.includes('编程')) return 'programming';
  return 'ai';
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = clean(item.url || item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function flattenSettled(batches) {
  return batches.filter((batch) => batch.status === 'fulfilled').flatMap((batch) => batch.value);
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function readAtomLink(xml) {
  const match = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? match[1].trim() : '';
}

function stripXml(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function splitTerms(value) {
  const normalized = clean(value);
  const english = normalized.split(/[^a-z0-9+#.-]+/i).filter(Boolean);
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...english, ...chinese];
}

function clean(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
