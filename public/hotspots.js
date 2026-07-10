import { localizeDiscoveryTitle } from './title-localizer.js?v=20260710-date-filter-empty';
import { hasAdminToken, withAdminHeaders } from './admin-auth.js';

const state = {
  discoveries: [],
  allDiscoveries: [],
  filters: { from: '', to: '' },
  runtime: { publicReadonly: false, adminRequired: false, adminAuthorized: true }
};

const expandedDiscoveryIds = new Set();

const elements = {
  discoveries: document.querySelector('#discoveries'),
  status: document.querySelector('#statusPill'),
  scan: document.querySelector('#scanBtn'),
  signalCount: document.querySelector('#signalCount'),
  dateFrom: document.querySelector('#dateFromInput'),
  dateTo: document.querySelector('#dateToInput'),
  clearDateFilter: document.querySelector('#clearDateFilter'),
  dateFilterStatus: document.querySelector('#dateFilterStatus')
};

await loadState();
connectEvents();

elements.scan.addEventListener('click', async () => {
  if (!canManage()) {
    setStatus('公开只读模式：访客不能触发扫描');
    return;
  }
  elements.scan.disabled = true;
  setStatus('扫描中');
  try {
    const result = await api('/api/scan', { method: 'POST', body: {} });
    await loadState();
    setStatus(`新增 ${sum(result.results, 'accepted')} 条`);
  } catch (error) {
    setStatus(`扫描失败：${error.message}`);
  } finally {
    elements.scan.disabled = false;
  }
});

for (const input of [elements.dateFrom, elements.dateTo]) {
  input.addEventListener('change', async () => {
    state.filters.from = elements.dateFrom.value;
    state.filters.to = elements.dateTo.value;
    expandedDiscoveryIds.clear();
    await loadState();
    setStatus(dateFilterActive() ? '已按日期筛选' : '已显示全部热点');
  });
}

elements.clearDateFilter.addEventListener('click', clearDateFilter);

elements.discoveries.addEventListener('click', async (event) => {
  const clearFilter = event.target.closest('[data-clear-date-filter]');
  if (clearFilter) {
    event.preventDefault();
    await clearDateFilter();
    return;
  }

  const toggle = event.target.closest('[data-toggle-discovery]');
  if (toggle) {
    event.preventDefault();
    const id = toggle.dataset.toggleDiscovery;
    setDiscoveryExpanded(toggle, id, toggle.getAttribute('aria-expanded') !== 'true');
    return;
  }

  const button = event.target.closest('[data-summary]');
  if (!button) return;

  const id = button.dataset.summary;
  const label = button.querySelector('span');
  button.disabled = true;
  if (label) label.textContent = '总结中';
  setStatus('AI 总结中');

  try {
    const current = state.discoveries.find((item) => item.id === id);
    const item = await api(`/api/discoveries/${id}/summary`, {
      method: 'POST',
      body: { discovery: current }
    });
    expandedDiscoveryIds.add(item.id);
    updateDiscovery(item);
    setStatus('AI 总结完成');
  } catch (error) {
    setStatus(`AI 总结失败：${error.message}`);
    renderDiscoveries();
  }
});

elements.discoveries.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const toggle = event.target.closest('[data-toggle-discovery]');
  if (!toggle) return;
  event.preventDefault();
  const id = toggle.dataset.toggleDiscovery;
  setDiscoveryExpanded(toggle, id, toggle.getAttribute('aria-expanded') !== 'true');
});

async function loadState() {
  const data = await api(statePath());
  let allData = data;
  if (dateFilterActive()) {
    allData = await api('/api/state');
  }
  state.allDiscoveries = allData.discoveries || data.discoveries || [];
  state.discoveries = applyCurrentDateFilter(data.discoveries || []);
  state.runtime = data.runtime || state.runtime;
  renderReadonlyMode();
  renderDiscoveries();
}

function connectEvents() {
  const events = new EventSource('/events');
  events.addEventListener('ready', () => {
    setStatus('已连接');
  });
  events.addEventListener('discovery', (event) => {
    addDiscovery(JSON.parse(event.data));
    setStatus('发现新信号');
  });
  events.addEventListener('discovery-updated', (event) => {
    updateDiscovery(JSON.parse(event.data));
  });
  events.addEventListener('scan-complete', () => {
    loadState().catch((error) => setStatus(`刷新失败：${error.message}`));
  });
  events.onerror = () => {
    setStatus('重连中');
  };
}

function addDiscovery(item) {
  if (dateFilterActive() && !matchesCurrentDateFilter(item)) return;
  state.discoveries = [item, ...state.discoveries.filter((existing) => existing.id !== item.id)].slice(0, 120);
  renderDiscoveries();
}

function updateDiscovery(item) {
  if (dateFilterActive() && !matchesCurrentDateFilter(item)) {
    state.discoveries = state.discoveries.filter((existing) => existing.id !== item.id);
    renderDiscoveries();
    return;
  }

  const index = state.discoveries.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    addDiscovery(item);
    return;
  }
  state.discoveries = state.discoveries.map((existing) => existing.id === item.id ? item : existing);
  renderDiscoveries();
}

function renderDiscoveries() {
  elements.signalCount.textContent = state.discoveries.length;
  renderDateFilterStatus();

  if (!state.discoveries.length) {
    elements.discoveries.innerHTML = `
      <div class="empty empty-hotspots">
        <div class="empty-copy">
          <strong>${dateFilterActive() ? '该时间区间暂无热点信号' : '暂无热点信号'}</strong>
          <span>${emptyStateHint()}</span>
        </div>
        <div class="empty-actions">
          ${dateFilterActive() ? '<button class="filter-clear-button" type="button" data-clear-date-filter>清除时间筛选</button>' : ''}
          <a class="inline-link" href="/">返回控制台</a>
        </div>
      </div>
    `;
    return;
  }

  const items = [...state.discoveries].sort((a, b) => {
    const heatDelta = (b.analysis?.heat || 0) - (a.analysis?.heat || 0);
    if (Math.abs(heatDelta) >= 20) return heatDelta;
    return new Date(b.discoveredAt || b.publishedAt || 0) - new Date(a.discoveredAt || a.publishedAt || 0);
  });

  elements.discoveries.innerHTML = `
    <div class="signal-board" aria-label="热点信号列表">
      ${items.map(renderDiscoveryCard).join('')}
    </div>
  `;
}

function renderDiscoveryCard(item) {
  const analysis = item.analysis || {};
  const reviewClass = analysis.authenticity === 'verified' ? 'verified' : 'review';
  const heat = percent(analysis.heat);
  const relevance = percent(analysis.relevance);
  const highHeat = isHighHeat(item);
  const expanded = expandedDiscoveryIds.has(item.id);
  const displayTitle = localizeDiscoveryTitle(item);
  const originalTitle = cleanText(item.title);
  const showOriginalTitle = originalTitle && displayTitle !== originalTitle;
  const detailsId = `discovery-details-${escapeAttr(item.id)}`;
  const url = cleanText(item.url);
  const host = sourceHost(url);
  const capturedAt = item.discoveredAt || item.publishedAt || '';
  const summaryPreview = buildSummaryPreview(item);

  return `
    <article class="discovery ${highHeat ? 'is-high-heat' : ''} ${expanded ? 'is-expanded' : 'is-collapsed'}">
      <div class="signal-tags">
        <span class="signal-tag source-tag">
          ${icon('globe')}
          <span>${escapeHtml(item.source || host || '未知来源')}</span>
        </span>
        <span class="signal-tag keyword-tag">${escapeHtml(item.keyword || '未命名关键词')}</span>
        <span class="signal-tag ${reviewClass}">
          ${icon('shield')}
          <span>${labelAuthenticity(analysis.authenticity)}</span>
        </span>
      </div>

      <div class="signal-headline">
        <h3 data-toggle-discovery="${escapeAttr(item.id)}" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailsId}">${escapeHtml(displayTitle)}</h3>
        <button class="expand-button" type="button" data-toggle-discovery="${escapeAttr(item.id)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailsId}" title="${expanded ? '收起详情' : '展开详情'}" aria-label="${expanded ? '收起详情' : '展开详情'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${expanded ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>
      </button>
      </div>

      <p class="signal-summary">
        <strong>AI 摘要</strong>
        <span>${escapeHtml(summaryPreview)}</span>
      </p>

      <div class="signal-meta">
        <span class="meta-item">
          ${icon('target')}
          <span>相关性 ${relevance}%</span>
        </span>
        <time class="meta-item" datetime="${escapeAttr(capturedAt)}" title="${escapeAttr(formatTime(capturedAt))}">
          ${icon('pulse')}
          <span>抓取 ${escapeHtml(formatRelativeTime(capturedAt))}</span>
        </time>
      </div>

      ${url ? `
        <a class="origin-url" href="${escapeAttr(url)}" target="_blank" rel="noreferrer" title="${escapeAttr(url)}">
          ${icon('external')}
          <span class="origin-action">访问原网站</span>
          <span class="origin-address">${escapeHtml(displayUrl(url))}</span>
        </a>
      ` : ''}

      <div id="${detailsId}" class="discovery-details" ${expanded ? '' : 'hidden'}>
        ${showOriginalTitle ? `<p class="original-title">原始标题：${escapeHtml(originalTitle)}</p>` : ''}
        <div class="chips">
          <span class="chip ${highHeat ? 'hot' : ''}">热度 ${heat}</span>
          <span class="chip ${reviewClass}">${labelAuthenticity(analysis.authenticity)} ${analysis.authenticityScore || 0}</span>
          <span class="chip">相关性 ${relevance}%</span>
          <span class="chip">${escapeHtml(item.source)}</span>
        </div>
        <p class="summary">${escapeHtml(item.summary || '没有摘要，建议打开来源核验。')}</p>
        ${url ? `<a class="source-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">打开来源</a>` : ''}
        ${item.aiSummary ? `<div class="ai-summary">${escapeHtml(item.aiSummary.content).replace(/\n/g, '<br />')}</div>` : ''}
        <div class="discovery-actions">
          <button class="summary-button" type="button" data-summary="${escapeAttr(item.id)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 8h14M7 16h10"/></svg>
            <span>${item.aiSummary ? '重新总结' : 'AI 总结'}</span>
          </button>
        </div>
        <div class="chips card-footer">
          <span class="chip">${escapeHtml(item.keyword)}</span>
          <span class="chip">抓取 ${escapeHtml(formatTime(capturedAt))}</span>
        </div>
      </div>
    </article>
  `;
}

function setDiscoveryExpanded(toggle, id, expanded) {
  if (!id) return;
  const card = toggle.closest('.discovery');
  const details = card?.querySelector('.discovery-details');

  if (expanded) {
    expandedDiscoveryIds.add(id);
  } else {
    expandedDiscoveryIds.delete(id);
  }

  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const expandButton = card?.querySelector('.expand-button');
  expandButton?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  card?.querySelector('.signal-headline h3')?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  expandButton?.querySelector('path')?.setAttribute('d', expanded ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6');
  card?.classList.toggle('is-expanded', expanded);
  card?.classList.toggle('is-collapsed', !expanded);
  if (details) details.hidden = !expanded;
}

function statePath() {
  const params = new URLSearchParams();
  if (state.filters.from) params.set('from', state.filters.from);
  if (state.filters.to) params.set('to', state.filters.to);
  const query = params.toString();
  return query ? `/api/state?${query}` : '/api/state';
}

function renderDateFilterStatus() {
  if (!dateFilterActive()) {
    elements.dateFilterStatus.textContent = availableDateRangeText('显示全部抓取时间');
    return;
  }
  const { from, to } = normalizedDateLabels();
  elements.dateFilterStatus.textContent = `${from} 至 ${to}，共 ${state.discoveries.length} 条`;
}

async function clearDateFilter() {
  elements.dateFrom.value = '';
  elements.dateTo.value = '';
  state.filters = { from: '', to: '' };
  expandedDiscoveryIds.clear();
  await loadState();
  setStatus('已清除时间筛选');
}

function emptyStateHint() {
  if (!dateFilterActive()) return '添加监控词并扫描后，这里会显示抓取到的热点。';
  return availableDateRangeText('当前没有可筛选的本地热点数据。');
}

function availableDateRangeText(fallback) {
  const range = availableDateRange();
  if (!range) return fallback;
  if (range.first === range.last) return `当前本地仅有 ${range.first} 的热点数据。`;
  return `当前本地热点数据范围：${range.first} 至 ${range.last}。`;
}

function availableDateRange() {
  const dates = state.allDiscoveries
    .map((item) => new Date(item.discoveredAt || item.publishedAt || 0))
    .filter((date) => Number.isFinite(date.getTime()));
  if (!dates.length) return null;
  return {
    first: formatDateInput(new Date(Math.min(...dates))),
    last: formatDateInput(new Date(Math.max(...dates)))
  };
}

function formatDateInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function dateFilterActive() {
  return Boolean(state.filters.from || state.filters.to);
}

function matchesCurrentDateFilter(item) {
  const time = new Date(item.discoveredAt || item.publishedAt || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return false;
  const { start, end } = dateRangeBounds();
  if (start && time < start) return false;
  if (end && time > end) return false;
  return true;
}

function applyCurrentDateFilter(items) {
  if (!dateFilterActive()) return items;
  return items.filter(matchesCurrentDateFilter);
}

function normalizedDateLabels() {
  let from = state.filters.from || '';
  let to = state.filters.to || '';
  if (from && to && from > to) [from, to] = [to, from];
  return {
    from: from || '最早',
    to: to || '今天'
  };
}

function dateRangeBounds() {
  let from = state.filters.from || '';
  let to = state.filters.to || '';
  if (from && to && from > to) [from, to] = [to, from];
  return {
    start: dateInputToTime(from, false),
    end: dateInputToTime(to, true)
  };
}

function dateInputToTime(value, endOfDay) {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const time = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(time) ? time : null;
}

function buildSummaryPreview(item) {
  if (item.aiSummary?.content) {
    const content = cleanText(item.aiSummary.content);
    const core = content.match(/核心内容[:：]\s*(.+?)(?:判断[:：]|注意[:：]|$)/);
    return truncate(core?.[1] || content, 180);
  }

  const metadata = summarizeMetadata(item.summary);
  if (metadata) return metadata;

  const summary = cleanText(item.summary);
  if (summary) return truncate(summary, 180);

  return '这条热点与当前关键词相关，展开后可查看完整信息并生成 AI 总结。';
}

function summarizeMetadata(value) {
  const text = cleanText(value);
  if (!text) return '';
  const parts = [];
  const stars = text.match(/Stars:\s*(\d+)/i);
  const updated = text.match(/Updated:\s*([0-9T:.-]+Z?)/i);
  const comments = text.match(/Comments:\s*(\d+)/i);
  const hnPoints = text.match(/HN points:\s*(\d+)/i);
  if (stars) parts.push(`GitHub 星标 ${stars[1]}`);
  if (hnPoints) parts.push(`Hacker News 点数 ${hnPoints[1]}`);
  if (comments) parts.push(`评论 ${comments[1]}`);
  if (updated) parts.push(`更新于 ${formatTime(updated[1])}`);
  return parts.length ? `来源元数据：${parts.join('，')}。` : '';
}

function icon(name) {
  const paths = {
    external: 'M7 17 17 7M9 7h8v8M5 19h14',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
    shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function displayUrl(url) {
  try {
    const parsed = new URL(url);
    const value = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    return truncate(value, 74);
  } catch {
    return truncate(url, 74);
  }
}

function isHighHeat(item) {
  return (item.analysis?.heat || 0) >= 70;
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: withAdminHeaders(headers),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function canManage() {
  return !state.runtime?.publicReadonly || hasAdminToken();
}

function renderReadonlyMode() {
  const readonly = state.runtime?.publicReadonly && !hasAdminToken();
  document.body.classList.toggle('is-public-readonly', readonly);
  if (elements.scan) {
    elements.scan.disabled = readonly;
    elements.scan.title = readonly ? '公开只读模式下访客不能触发扫描' : '';
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function percent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function formatRelativeTime(value) {
  const time = new Date(value || 0).getTime();
  if (!time) return '时间未知';
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return '刚刚';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

function formatTime(value) {
  if (!value) return '尚未扫描';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function labelAuthenticity(value) {
  return value === 'verified' ? '可信' : '待复核';
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
