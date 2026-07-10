import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

test('purges discoveries older than retention setting', async () => {
  const store = createStore(path.join(os.tmpdir(), `hotspot-radar-store-${Date.now()}.json`));
  await store.init();
  await store.setSettings({ retentionHours: 24 });

  await store.addDiscoveries([
    {
      id: 'old',
      fingerprint: 'old',
      title: 'old item',
      url: 'https://example.com/old',
      source: 'test',
      discoveredAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      analysis: {}
    },
    {
      id: 'new',
      fingerprint: 'new',
      title: 'new item',
      url: 'https://example.com/new',
      source: 'test',
      discoveredAt: new Date().toISOString(),
      analysis: {}
    }
  ]);

  const state = await store.getState();
  assert.deepEqual(state.discoveries.map((item) => item.id), ['new']);
});

test('stores selected source settings', async () => {
  const store = createStore(path.join(os.tmpdir(), `hotspot-radar-store-settings-${Date.now()}.json`));
  await store.init();

  const settings = await store.setSettings({ enabledSources: ['github', 'arxiv', 'unknown'] });
  assert.deepEqual(settings.enabledSources, ['github', 'arxiv']);

  const state = await store.getState();
  assert.deepEqual(state.settings.enabledSources, ['github', 'arxiv']);
  assert.ok(state.sources.some((source) => source.id === 'github'));
});

test('filters discoveries by inclusive captured date range', async () => {
  const store = createStore(path.join(os.tmpdir(), `hotspot-radar-store-date-filter-${Date.now()}.json`));
  await store.init();
  await store.setSettings({ retentionHours: 720 });

  await store.addDiscoveries([
    {
      id: 'before-range',
      fingerprint: 'before-range',
      title: 'before range',
      url: 'https://example.com/before',
      source: 'test',
      discoveredAt: '2026-06-30T23:59:59.999+08:00',
      analysis: {}
    },
    {
      id: 'range-start',
      fingerprint: 'range-start',
      title: 'range start',
      url: 'https://example.com/start',
      source: 'test',
      discoveredAt: '2026-07-01T00:00:00.000+08:00',
      analysis: {}
    },
    {
      id: 'range-end',
      fingerprint: 'range-end',
      title: 'range end',
      url: 'https://example.com/end',
      source: 'test',
      discoveredAt: '2026-07-03T23:59:59.999+08:00',
      analysis: {}
    },
    {
      id: 'after-range',
      fingerprint: 'after-range',
      title: 'after range',
      url: 'https://example.com/after',
      source: 'test',
      discoveredAt: '2026-07-04T00:00:00.000+08:00',
      analysis: {}
    }
  ]);

  const state = await store.getState({ from: '2026-07-01', to: '2026-07-03' });
  assert.deepEqual(state.discoveries.map((item) => item.id), ['range-end', 'range-start']);

  const reversed = await store.getState({ from: '2026-07-03', to: '2026-07-01' });
  assert.deepEqual(reversed.discoveries.map((item) => item.id), ['range-end', 'range-start']);
});
