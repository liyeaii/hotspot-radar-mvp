import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.js';
import { collectForKeyword } from './src/sources.js';
import { analyzeItem, fingerprint } from './src/analyzer.js';
import { summarizeDiscovery } from './src/summarizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const store = createStore(process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json'));
const port = Number(process.env.PORT || 4873);
const publicReadonly = isTruthy(process.env.PUBLIC_READONLY);
const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
const clients = new Set();
const scanLocks = new Set();

await store.init();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function emit(event, payload) {
  const packet = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(packet);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function runtimeInfo(req, url) {
  return {
    publicReadonly,
    adminRequired: publicReadonly,
    adminAuthorized: hasAdminAccess(req, url)
  };
}

function requireAdmin(req, res, url) {
  if (!publicReadonly || hasAdminAccess(req, url)) return true;
  sendJson(res, 403, {
    error: adminToken
      ? '当前为公开只读模式，管理操作需要管理员 Token。'
      : '当前为公开只读模式，服务端未配置 ADMIN_TOKEN，管理操作已禁用。'
  });
  return false;
}

function hasAdminAccess(req, url) {
  if (!publicReadonly) return true;
  if (!adminToken) return false;

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const presented = [
    req.headers['x-admin-token'],
    bearer,
    url.searchParams.get('adminToken')
  ].find((value) => String(value || '').trim());

  return tokenEquals(String(presented || '').trim(), adminToken);
}

function tokenEquals(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function runScan(keywordId = null, reason = 'manual') {
  const state = await store.getState();
  const targets = keywordId
    ? state.keywords.filter((keyword) => keyword.id === keywordId)
    : state.keywords.filter((keyword) => keyword.enabled);

  const results = [];
  const errors = [];

  for (const keyword of targets) {
    if (scanLocks.has(keyword.id)) continue;
    scanLocks.add(keyword.id);
    try {
      const rawItems = await collectForKeyword({
        ...keyword,
        enabledSources: currentSettings(state).enabledSources
      });
      const current = await store.getState();
      const existingKeys = new Set(current.discoveries.map((item) => item.fingerprint));
      const accepted = [];

      for (const raw of rawItems) {
        const analysis = analyzeItem(raw, keyword);
        const key = fingerprint(raw);
        if (existingKeys.has(key) || analysis.relevance < 45 || analysis.authenticity === 'reject') {
          continue;
        }

        const discovery = {
          id: randomUUID(),
          fingerprint: key,
          keywordId: keyword.id,
          keyword: keyword.keyword,
          scope: keyword.scope,
          title: raw.title,
          url: raw.url,
          source: raw.source,
          sourceType: raw.sourceType,
          summary: raw.summary || '',
          publishedAt: raw.publishedAt || null,
          discoveredAt: new Date().toISOString(),
          analysis
        };
        accepted.push(discovery);
        existingKeys.add(key);
      }

      await store.addDiscoveries(accepted);
      await store.touchKeyword(keyword.id, {
        lastScannedAt: new Date().toISOString(),
        nextRunAt: new Date(Date.now() + keyword.intervalMinutes * 60_000).toISOString()
      });

      for (const item of accepted) emit('discovery', item);
      results.push({ keywordId: keyword.id, keyword: keyword.keyword, scanned: rawItems.length, accepted: accepted.length });
    } catch (error) {
      errors.push({ keywordId: keyword.id, keyword: keyword.keyword, message: error.message });
    } finally {
      scanLocks.delete(keyword.id);
    }
  }

  const summary = { reason, results, errors, completedAt: new Date().toISOString() };
  emit('scan-complete', summary);
  return summary;
}

async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, now: new Date().toISOString(), runtime: runtimeInfo(req, url) });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = await store.getState({
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to')
    });
    sendJson(res, 200, { ...state, runtime: runtimeInfo(req, url) });
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    if (!requireAdmin(req, res, url)) return true;
    const body = await readBody(req);
    const settings = await store.setSettings({
      retentionHours: body.retentionHours === undefined ? undefined : Number(body.retentionHours),
      enabledSources: body.enabledSources
    });
    emit('settings-updated', settings);
    sendJson(res, 200, settings);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/keywords') {
    if (!requireAdmin(req, res, url)) return true;
    const body = await readBody(req);
    const keyword = await store.addKeyword({
      keyword: String(body.keyword || '').trim(),
      scope: String(body.scope || 'AI programming').trim(),
      intervalMinutes: Number(body.intervalMinutes || 15)
    });
    emit('keyword-added', keyword);
    sendJson(res, 201, keyword);
    return true;
  }

  const keywordDelete = url.pathname.match(/^\/api\/keywords\/([^/]+)$/);
  if (req.method === 'DELETE' && keywordDelete) {
    if (!requireAdmin(req, res, url)) return true;
    await store.removeKeyword(keywordDelete[1]);
    emit('keyword-removed', { id: keywordDelete[1] });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/scan') {
    if (!requireAdmin(req, res, url)) return true;
    const body = await readBody(req);
    const summary = await runScan(body.keywordId || null, 'manual');
    sendJson(res, 200, summary);
    return true;
  }

  const summaryRequest = url.pathname.match(/^\/api\/discoveries\/([^/]+)\/summary$/);
  if (req.method === 'POST' && summaryRequest) {
    const body = await readBody(req);
    const requestedId = decodeURIComponent(summaryRequest[1]);
    const discovery = await store.findDiscovery(requestedId)
      || normalizeDiscoveryFallback(body.discovery)
      || createMissingDiscoveryFallback(requestedId);
    const aiSummary = await summarizeSafely(discovery);
    let updated = { ...discovery, aiSummary };
    const canPersistSummary = !publicReadonly || hasAdminAccess(req, url);
    if (canPersistSummary && await store.findDiscovery(discovery.id)) {
      updated = await store.updateDiscovery(discovery.id, { aiSummary });
      emit('discovery-updated', updated);
    }
    sendJson(res, 200, updated);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo') {
    if (!requireAdmin(req, res, url)) return true;
    const state = await store.getState();
    const keyword = state.keywords[0] || await store.addKeyword({ keyword: 'AI coding', scope: 'AI programming', intervalMinutes: 15 });
    const demo = {
      title: `${keyword.keyword}: model tooling update is gaining developer attention`,
      url: `https://example.com/radar/${encodeURIComponent(keyword.keyword)}`,
      source: 'Local Demo Pulse',
      sourceType: 'demo',
      summary: 'A local sample item used to verify the notification and review flow without external network access.',
      publishedAt: new Date().toISOString()
    };
    const discovery = {
      id: randomUUID(),
      fingerprint: `${fingerprint(demo)}-${Date.now()}`,
      keywordId: keyword.id,
      keyword: keyword.keyword,
      scope: keyword.scope,
      ...demo,
      discoveredAt: new Date().toISOString(),
      analysis: analyzeItem(demo, keyword)
    };
    await store.addDiscoveries([discovery]);
    emit('discovery', discovery);
    sendJson(res, 201, discovery);
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  if (publicReadonly && url.pathname === '/') {
    res.writeHead(302, { location: '/hotspots.html' });
    res.end();
    return;
  }

  const safePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const fullPath = path.normalize(path.join(publicDir, safePath));
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(fullPath);
    res.writeHead(200, {
      'content-type': mimeTypes[path.extname(fullPath)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      });
      res.write('event: ready\ndata: {"ok":true}\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await routeApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: 'Not found' });
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

setInterval(async () => {
  const state = await store.getState();
  const due = state.keywords.some((keyword) => keyword.enabled && new Date(keyword.nextRunAt || 0).getTime() <= Date.now());
  if (due) runScan(null, 'schedule').catch((error) => emit('scan-error', { message: error.message }));
}, 30_000).unref();

setInterval(async () => {
  await store.purgeExpired();
}, 10 * 60_000).unref();

server.listen(port, () => {
  if (process.env.QUIET !== '1') {
    console.log(`Hotspot Radar MVP running at http://localhost:${port}`);
  }
});

export { server };

function currentSettings(state) {
  return state.settings || { enabledSources: undefined };
}

function normalizeDiscoveryFallback(input) {
  if (!input || !input.title || !input.url) return null;
  return {
    id: String(input.id || randomUUID()),
    fingerprint: input.fingerprint || fingerprint(input),
    keywordId: input.keywordId || null,
    keyword: input.keyword || 'unknown',
    scope: input.scope || '',
    title: input.title,
    url: input.url,
    source: input.source || 'Unknown',
    sourceType: input.sourceType || 'fallback',
    summary: input.summary || '',
    publishedAt: input.publishedAt || null,
    discoveredAt: input.discoveredAt || new Date().toISOString(),
    analysis: input.analysis || {
      relevance: 0,
      heat: 0,
      authenticityScore: 0,
      authenticity: 'needs-review',
      reasons: ['fallback discovery from client state']
    }
  };
}

function createMissingDiscoveryFallback(id) {
  return {
    id: String(id || randomUUID()),
    fingerprint: `missing-${id || Date.now()}`,
    keywordId: null,
    keyword: 'unknown',
    scope: '',
    title: '当前页面中的这条信息已不在后端缓存中',
    url: 'https://example.com/missing-discovery',
    source: 'Local Cache Fallback',
    sourceType: 'fallback',
    summary: '后端没有找到这条信息的持久化记录，通常是页面缓存、服务重启、自动清理或旧前端请求造成的。系统仍会生成可显示的说明，避免 AI 总结按钮失败。',
    publishedAt: null,
    discoveredAt: new Date().toISOString(),
    analysis: {
      relevance: 0,
      heat: 0,
      authenticityScore: 0,
      authenticity: 'needs-review',
      reasons: ['discovery missing from server state']
    }
  };
}

async function summarizeSafely(discovery) {
  try {
    return await summarizeDiscovery(discovery);
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      language: 'zh-CN',
      method: 'local-fallback',
      content: [
        `这条信息来自 ${discovery.source || '未知来源'}，标题为“${discovery.title || '未知标题'}”。`,
        `系统无法抓取或解析原文，但已保留现有摘要：${discovery.summary || '暂无摘要。'}`,
        `建议打开原始链接人工核验：${discovery.url || '无链接'}`,
        `内部错误：${error.message}`
      ].join('\n\n')
    };
  }
}
