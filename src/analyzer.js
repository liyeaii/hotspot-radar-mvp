import crypto from 'node:crypto';

const trustedSourceScores = {
  'OpenAI News': 24,
  'Anthropic News': 24,
  'Google AI Blog': 22,
  'Google Developers': 20,
  'Microsoft AI Blog': 20,
  'GitHub Blog': 20,
  'Hugging Face Blog': 20,
  'LangChain Blog': 16,
  'Vercel Blog': 16,
  'Google News': 12,
  'Hacker News': 16,
  GitHub: 18,
  arXiv: 18,
  'DEV Community': 10,
  'Local Demo Pulse': 10
};

const suspiciousTerms = [
  'airdrop',
  'giveaway',
  'free token',
  'private key',
  'wallet connect',
  'act now',
  '100% guaranteed',
  'leaked!!'
];

const officialClaims = [
  { name: 'OpenAI', domains: ['openai.com'] },
  { name: 'Anthropic', domains: ['anthropic.com'] },
  { name: 'Google', domains: ['googleblog.com', 'blog.google', 'deepmind.google', 'ai.google.dev', 'developers.googleblog.com'] },
  { name: 'GitHub', domains: ['github.blog', 'github.com'] },
  { name: 'Microsoft', domains: ['microsoft.com', 'devblogs.microsoft.com'] }
];

export function fingerprint(item) {
  const key = `${normalize(item.url || '')}|${normalize(item.title || '')}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
}

export function analyzeItem(item, keywordConfig) {
  const title = item.title || '';
  const summary = item.summary || '';
  const text = normalize(`${title} ${summary}`);
  const keyword = normalize(keywordConfig.keyword);
  const scope = normalize(keywordConfig.scope || '');
  const matchedQuery = normalize(item.matchedQuery || '');
  const domain = getDomain(item.url);
  const reasons = [];
  let relevance = 0;
  let authenticityScore = 55;
  let heat = 0;

  if (keyword && text.includes(keyword)) {
    relevance += 42;
    reasons.push('keyword match');
  }

  const keywordMatches = countMatches(text, tokenize(keyword));
  const scopeMatches = countMatches(text, tokenize(scope));
  const queryMatches = countMatches(text, tokenize(matchedQuery));

  if (keywordMatches > 0) {
    relevance += Math.min(34, keywordMatches * 12);
    reasons.push('keyword token match');
  }

  if (scope && text.includes(scope)) {
    relevance += 24;
    reasons.push('scope match');
  } else if (scopeMatches > 0) {
    relevance += Math.min(22, scopeMatches * 6);
    reasons.push('scope token match');
  }

  if (matchedQuery && queryMatches > 0) {
    relevance += Math.min(18, queryMatches * 6);
    reasons.push(`source query match: ${item.matchedQuery}`);
  }

  if (item.sourceType === 'official' && (keywordMatches > 0 || scopeMatches > 0 || queryMatches > 0)) {
    relevance += 12;
    reasons.push('official feed match');
  }

  if (trustedSourceScores[item.source]) {
    authenticityScore += trustedSourceScores[item.source];
    heat += Math.round(trustedSourceScores[item.source] / 2);
    reasons.push(`trusted source: ${item.source}`);
  }

  if (domain && !isSuspiciousDomain(domain)) {
    authenticityScore += 8;
  } else if (domain) {
    authenticityScore -= 22;
    reasons.push('suspicious domain shape');
  }

  for (const term of suspiciousTerms) {
    if (text.includes(term)) {
      authenticityScore -= 28;
      reasons.push(`suspicious term: ${term}`);
    }
  }

  for (const claim of officialClaims) {
    if (text.includes(normalize(claim.name)) && domain && !claim.domains.some((allowed) => domain.endsWith(allowed))) {
      authenticityScore -= 18;
      reasons.push(`${claim.name} claim outside known official domains`);
    }
  }

  const ageHours = item.publishedAt ? (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000 : 48;
  if (ageHours <= 3) heat += 32;
  else if (ageHours <= 24) heat += 22;
  else if (ageHours <= 72) heat += 12;

  heat += Math.min(28, Math.round(relevance / 3));
  relevance = clamp(relevance, 0, 100);
  authenticityScore = clamp(authenticityScore, 0, 100);
  heat = clamp(heat, 0, 100);

  return {
    relevance,
    heat,
    authenticityScore,
    authenticity: authenticityScore >= 70 ? 'verified' : authenticityScore >= 46 ? 'needs-review' : 'reject',
    reasons: [...new Set(reasons)].slice(0, 8)
  };
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  const normalized = normalize(value);
  const english = normalized.split(/[^a-z0-9+#.-]+/i).filter((token) => token.length > 2);
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set([...english, ...chinese])];
}

function countMatches(text, tokens) {
  return tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSuspiciousDomain(domain) {
  return domain.includes('xn--') || domain.split('-').length > 4 || domain.length > 80;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
