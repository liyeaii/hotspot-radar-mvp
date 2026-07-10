import { hasAdminToken, withAdminHeaders } from './admin-auth.js';

const state = {
  keywords: [],
  settings: { retentionHours: 24, enabledSources: [] },
  sources: [],
  runtime: { publicReadonly: false, adminRequired: false, adminAuthorized: true }
};

const fallbackSources = [
  { id: 'google-news', name: 'Google News', description: '新闻聚合，适合追踪快速变化的话题。' },
  { id: 'official-feeds', name: 'Official/vendor feeds', description: 'OpenAI、Anthropic、Google、GitHub 等官方动态。' },
  { id: 'hacker-news', name: 'Hacker News', description: '开发者社区讨论。' },
  { id: 'github', name: 'GitHub', description: '仓库和开源项目更新。' },
  { id: 'arxiv', name: 'arXiv', description: '论文和研究动态。' },
  { id: 'devto', name: 'DEV Community', description: '开发者文章和实践记录。' }
];

const elements = {
  form: document.querySelector('#keywordForm'),
  keyword: document.querySelector('#keywordInput'),
  scope: document.querySelector('#scopeInput'),
  interval: document.querySelector('#intervalInput'),
  settingsForm: document.querySelector('#settingsForm'),
  retention: document.querySelector('#retentionInput'),
  retentionLabel: document.querySelector('#retentionLabel'),
  sourceOptions: document.querySelector('#sourceOptions'),
  sourceCountLabel: document.querySelector('#sourceCountLabel'),
  watchlist: document.querySelector('#watchlist'),
  log: document.querySelector('#eventLog'),
  status: document.querySelector('#statusPill'),
  scan: document.querySelector('#scanBtn'),
  demo: document.querySelector('#demoBtn'),
  notify: document.querySelector('#notifyBtn'),
  readonlyBanner: document.querySelector('#readonlyBanner')
};

await loadState();
connectEvents();

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    keyword: elements.keyword.value,
    scope: elements.scope.value,
    intervalMinutes: Number(elements.interval.value)
  };
  const keyword = await api('/api/keywords', { method: 'POST', body: payload });
  state.keywords.unshift(keyword);
  renderWatchlist();
  log(`已加入监控：${keyword.keyword}`);
  elements.keyword.value = '';
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const enabledSources = selectedSourceIds();
  if (!enabledSources.length) {
    log('请至少选择一个信息来源');
    return;
  }
  const settings = await api('/api/settings', {
    method: 'PUT',
    body: {
      retentionHours: Number(elements.retention.value),
      enabledSources
    }
  });
  state.settings = settings;
  renderSettings();
  log(`已更新保留时间：${settings.retentionHours} 小时`);
});

elements.sourceOptions.addEventListener('change', () => {
  elements.sourceCountLabel.textContent = `${selectedSourceIds().length} 类`;
});

elements.scan.addEventListener('click', async () => {
  elements.scan.disabled = true;
  log('开始手动扫描');
  try {
    const result = await api('/api/scan', { method: 'POST', body: {} });
    log(`扫描完成：新增 ${sum(result.results, 'accepted')} 条，候选 ${sum(result.results, 'scanned')} 条`);
  } catch (error) {
    log(`扫描失败：${error.message}`);
  } finally {
    elements.scan.disabled = false;
  }
});

elements.demo.addEventListener('click', async () => {
  const item = await api('/api/demo', { method: 'POST', body: {} });
  log(`已生成演示信号：${item.title}`);
});

elements.notify.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    log('当前浏览器不支持桌面通知');
    return;
  }
  const permission = await Notification.requestPermission();
  log(`浏览器通知权限：${permission}`);
});

async function loadState() {
  const data = await api('/api/state');
  state.keywords = data.keywords || [];
  state.settings = data.settings || { retentionHours: 24, enabledSources: [] };
  state.sources = data.sources?.length ? data.sources : fallbackSources;
  state.runtime = data.runtime || state.runtime;
  render();
}

function connectEvents() {
  const events = new EventSource('/events');
  events.addEventListener('ready', () => {
    elements.status.textContent = '已连接';
    log('实时通道已连接');
  });
  events.addEventListener('discovery', (event) => {
    const item = JSON.parse(event.data);
    notify(item);
    log(`发现信号：${item.title}`);
  });
  events.addEventListener('settings-updated', (event) => {
    state.settings = JSON.parse(event.data);
    renderSettings();
  });
  events.addEventListener('scan-complete', (event) => {
    const data = JSON.parse(event.data);
    log(`扫描完成：${data.results.length} 个监控词`);
  });
  events.onerror = () => {
    elements.status.textContent = '重连中';
  };
}

function render() {
  renderSettings();
  renderWatchlist();
  renderReadonlyMode();
}

function renderReadonlyMode() {
  const readonly = state.runtime?.publicReadonly && !hasAdminToken();
  document.body.classList.toggle('is-public-readonly', readonly);
  if (elements.readonlyBanner) {
    elements.readonlyBanner.hidden = !readonly;
  }

  const managedControls = [
    elements.keyword,
    elements.scope,
    elements.interval,
    elements.retention,
    elements.scan,
    elements.demo,
    elements.settingsForm?.querySelector('button[type="submit"]'),
    elements.form?.querySelector('button[type="submit"]')
  ].filter(Boolean);
  managedControls.push(
    ...elements.sourceOptions.querySelectorAll('input[name="source"]'),
    ...elements.watchlist.querySelectorAll('[data-delete]')
  );

  for (const control of managedControls) control.disabled = readonly;
}

function renderSettings() {
  const retentionHours = state.settings?.retentionHours || 24;
  const enabledSources = activeSourceIds();
  elements.retention.value = retentionHours;
  elements.retentionLabel.textContent = `${retentionHours} 小时`;
  elements.sourceCountLabel.textContent = `${enabledSources.length} 类`;
  elements.sourceOptions.innerHTML = state.sources.map((source) => {
    const checked = enabledSources.includes(source.id) ? 'checked' : '';
    return `
      <label class="source-option" title="${escapeAttr(source.description || '')}">
        <input type="checkbox" name="source" value="${escapeAttr(source.id)}" ${checked} />
        <span>
          <strong>${escapeHtml(source.name)}</strong>
          <small>${escapeHtml(source.description || '')}</small>
        </span>
      </label>
    `;
  }).join('');
}

function renderWatchlist() {
  if (!state.keywords.length) {
    elements.watchlist.innerHTML = '<div class="empty">还没有监控词。添加关键词后可以立即扫描。</div>';
    return;
  }
  elements.watchlist.innerHTML = state.keywords.map((keyword) => `
    <article class="watch-item">
      <strong>${escapeHtml(keyword.keyword)}</strong>
      <div class="watch-meta">
        范围：${escapeHtml(keyword.scope)}<br />
        间隔：${keyword.intervalMinutes} 分钟<br />
        下次：${formatTime(keyword.nextRunAt)}
      </div>
      <button type="button" data-delete="${keyword.id}">移除</button>
    </article>
  `).join('');

  elements.watchlist.querySelectorAll('[data-delete]').forEach((button) => {
    button.disabled = state.runtime?.publicReadonly && !hasAdminToken();
    button.addEventListener('click', async () => {
      await api(`/api/keywords/${button.dataset.delete}`, { method: 'DELETE' });
      state.keywords = state.keywords.filter((keyword) => keyword.id !== button.dataset.delete);
      renderWatchlist();
      log('已移除监控词');
    });
  });
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

function notify(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification('Hotspot Radar 发现新信号', {
    body: item.title
  });
}

function log(message) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`;
  elements.log.prepend(item);
  while (elements.log.children.length > 12) elements.log.lastElementChild.remove();
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function formatTime(value) {
  if (!value) return '尚未扫描';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
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

function activeSourceIds() {
  if (state.settings?.enabledSources?.length) return state.settings.enabledSources;
  return (state.sources.length ? state.sources : fallbackSources).map((source) => source.id);
}

function selectedSourceIds() {
  return [...elements.sourceOptions.querySelectorAll('input[name="source"]:checked')].map((input) => input.value);
}
