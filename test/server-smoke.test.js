import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

test('server API supports health, keyword creation, demo discovery, and state', async () => {
  process.env.PORT = '4891';
  process.env.QUIET = '1';
  process.env.STATE_FILE = path.join(os.tmpdir(), `hotspot-radar-${Date.now()}.json`);
  delete process.env.PUBLIC_READONLY;
  delete process.env.ADMIN_TOKEN;

  const { server } = await import('../server.js?smoke=1');
  const baseUrl = 'http://localhost:4891';

  try {
    const health = await request(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);

    const keyword = await request(`${baseUrl}/api/keywords`, {
      method: 'POST',
      body: { keyword: 'AI coding', scope: 'AI programming', intervalMinutes: 15 }
    });
    assert.equal(keyword.keyword, 'AI coding');

    const demo = await request(`${baseUrl}/api/demo`, { method: 'POST', body: {} });
    assert.match(demo.title, /AI coding|model tooling/i);

    const summarized = await request(`${baseUrl}/api/discoveries/${demo.id}/summary`, { method: 'POST', body: {} });
    assert.match(summarized.aiSummary.content, /这条信息来自/);

    const fallbackSummary = await request(`${baseUrl}/api/discoveries/client-only-id/summary`, {
      method: 'POST',
      body: {
        discovery: {
          id: 'client-only-id',
          title: 'Client only AI coding signal',
          url: 'https://example.com/client-only',
          source: 'Client State',
          keyword: 'AI coding',
          summary: 'This discovery only exists in the browser state.',
          analysis: { heat: 20, authenticityScore: 50, authenticity: 'needs-review' }
        }
      }
    });
    assert.equal(fallbackSummary.id, 'client-only-id');
    assert.match(fallbackSummary.aiSummary.content, /这条信息来自/);

    const missingSummary = await request(`${baseUrl}/api/discoveries/missing-no-body/summary`, {
      method: 'POST',
      body: {}
    });
    assert.equal(missingSummary.id, 'missing-no-body');
    assert.ok(missingSummary.aiSummary.content.length > 20);
    assert.equal(missingSummary.error, undefined);

    const settings = await request(`${baseUrl}/api/settings`, {
      method: 'PUT',
      body: { retentionHours: 12, enabledSources: ['github', 'arxiv'] }
    });
    assert.equal(settings.retentionHours, 12);
    assert.deepEqual(settings.enabledSources, ['github', 'arxiv']);

    const state = await request(`${baseUrl}/api/state`);
    assert.ok(state.keywords.length >= 1);
    assert.ok(state.discoveries.length >= 1);
    assert.equal(state.settings.retentionHours, 12);
    assert.deepEqual(state.settings.enabledSources, ['github', 'arxiv']);
    assert.ok(state.sources.some((source) => source.id === 'github'));

    const today = localDate(new Date());
    const filteredState = await request(`${baseUrl}/api/state?from=${today}&to=${today}`);
    assert.ok(filteredState.discoveries.some((item) => item.id === demo.id));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('public readonly mode protects management APIs while keeping public reads available', async () => {
  process.env.PORT = '4892';
  process.env.QUIET = '1';
  process.env.STATE_FILE = path.join(os.tmpdir(), `hotspot-radar-readonly-${Date.now()}.json`);
  process.env.PUBLIC_READONLY = '1';
  process.env.ADMIN_TOKEN = 'test-admin-token';

  const { server } = await import('../server.js?readonly=1');
  const baseUrl = 'http://localhost:4892';
  const admin = { headers: { 'x-admin-token': 'test-admin-token' } };

  try {
    const health = await request(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.runtime.publicReadonly, true);
    assert.equal(health.runtime.adminAuthorized, false);

    await assert.rejects(
      () => request(`${baseUrl}/api/keywords`, {
        method: 'POST',
        body: { keyword: 'AI coding', scope: 'AI programming', intervalMinutes: 15 }
      }),
      /公开只读模式/
    );

    const keyword = await request(`${baseUrl}/api/keywords`, {
      ...admin,
      method: 'POST',
      body: { keyword: 'AI coding', scope: 'AI programming', intervalMinutes: 15 }
    });
    assert.equal(keyword.keyword, 'AI coding');

    await assert.rejects(
      () => request(`${baseUrl}/api/settings`, {
        method: 'PUT',
        body: { retentionHours: 48, enabledSources: ['github'] }
      }),
      /公开只读模式/
    );

    const settings = await request(`${baseUrl}/api/settings`, {
      ...admin,
      method: 'PUT',
      body: { retentionHours: 48, enabledSources: ['github'] }
    });
    assert.equal(settings.retentionHours, 48);

    const demo = await request(`${baseUrl}/api/demo`, { ...admin, method: 'POST', body: {} });
    const publicState = await request(`${baseUrl}/api/state`);
    assert.equal(publicState.runtime.publicReadonly, true);
    assert.ok(publicState.discoveries.some((item) => item.id === demo.id));

    const summarized = await request(`${baseUrl}/api/discoveries/${demo.id}/summary`, { method: 'POST', body: {} });
    assert.equal(summarized.id, demo.id);
    assert.ok(summarized.aiSummary.content.length > 20);

    await assert.rejects(
      () => request(`${baseUrl}/api/scan`, { method: 'POST', body: {} }),
      /公开只读模式/
    );
  } finally {
    delete process.env.PUBLIC_READONLY;
    delete process.env.ADMIN_TOKEN;
    await new Promise((resolve) => server.close(resolve));
  }
});

async function request(url, options = {}) {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function localDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
