import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SOURCE_IDS, normalizeSourceIds, SOURCE_CATALOG } from './sources.js';

const defaultState = {
  keywords: [],
  discoveries: [],
  settings: {
    retentionHours: 24,
    enabledSources: DEFAULT_SOURCE_IDS
  },
  sources: SOURCE_CATALOG,
  createdAt: null,
  updatedAt: null
};

export function createStore(filePath) {
  let state = structuredClone(defaultState);

  async function persist() {
    state.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  return {
    async init() {
      try {
        state = normalizeState(JSON.parse(await readFile(filePath, 'utf8')));
        await this.purgeExpired();
      } catch {
        state = { ...structuredClone(defaultState), createdAt: new Date().toISOString() };
        await persist();
      }
    },

    async getState(options = {}) {
      await this.purgeExpired();
      const discoveries = filterDiscoveriesByDate(state.discoveries, options);
      return structuredClone({
        ...state,
        sources: SOURCE_CATALOG,
        discoveries: [...discoveries].sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt)).slice(0, 120)
      });
    },

    async addKeyword(input) {
      if (!input.keyword) throw new Error('Keyword is required');
      const keyword = {
        id: randomUUID(),
        keyword: input.keyword,
        scope: input.scope || 'AI programming',
        intervalMinutes: clamp(Math.round(input.intervalMinutes || 15), 1, 1440),
        enabled: true,
        createdAt: new Date().toISOString(),
        lastScannedAt: null,
        nextRunAt: new Date().toISOString()
      };
      state.keywords.unshift(keyword);
      await persist();
      return keyword;
    },

    async removeKeyword(id) {
      state.keywords = state.keywords.filter((keyword) => keyword.id !== id);
      await persist();
    },

    async touchKeyword(id, patch) {
      state.keywords = state.keywords.map((keyword) => keyword.id === id ? { ...keyword, ...patch } : keyword);
      await persist();
    },

    async addDiscoveries(items) {
      if (!items.length) return;
      await this.purgeExpired();
      state.discoveries = [...items, ...state.discoveries].slice(0, 500);
      await persist();
    },

    async setSettings(input) {
      state.settings = {
        ...state.settings,
        retentionHours: clamp(Math.round(Number(input.retentionHours || state.settings.retentionHours)), 1, 24 * 30),
        enabledSources: input.enabledSources ? normalizeSourceIds(input.enabledSources) : normalizeSourceIds(state.settings.enabledSources)
      };
      await this.purgeExpired();
      await persist();
      return structuredClone(state.settings);
    },

    async updateDiscovery(id, patch) {
      let updated = null;
      state.discoveries = state.discoveries.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, ...patch };
        return updated;
      });
      if (!updated) throw new Error('Discovery not found');
      await persist();
      return structuredClone(updated);
    },

    async findDiscovery(id) {
      await this.purgeExpired();
      const discovery = state.discoveries.find((item) => item.id === id);
      return discovery ? structuredClone(discovery) : null;
    },

    async purgeExpired() {
      const retentionMs = clamp(Math.round(Number(state.settings?.retentionHours || 24)), 1, 24 * 30) * 3_600_000;
      const cutoff = Date.now() - retentionMs;
      const before = state.discoveries.length;
      state.discoveries = state.discoveries.filter((item) => new Date(item.discoveredAt || item.publishedAt || 0).getTime() >= cutoff);
      if (state.discoveries.length !== before) await persist();
    }
  };
}

function normalizeState(input) {
  return {
    ...structuredClone(defaultState),
    ...input,
    settings: {
      ...defaultState.settings,
      ...(input.settings || {}),
      enabledSources: normalizeSourceIds(input.settings?.enabledSources)
    },
    sources: SOURCE_CATALOG,
    keywords: Array.isArray(input.keywords) ? input.keywords : [],
    discoveries: Array.isArray(input.discoveries) ? input.discoveries : []
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function filterDiscoveriesByDate(discoveries, options) {
  const { start, end } = dateRangeBounds(options.from, options.to);
  if (!start && !end) return discoveries;

  return discoveries.filter((item) => {
    const time = new Date(item.discoveredAt || item.publishedAt || 0).getTime();
    if (!Number.isFinite(time) || time <= 0) return false;
    if (start && time < start) return false;
    if (end && time > end) return false;
    return true;
  });
}

function dateRangeBounds(fromValue, toValue) {
  let from = normalizeDateInput(fromValue);
  let to = normalizeDateInput(toValue);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    start: parseDateBound(from, false),
    end: parseDateBound(to, true)
  };
}

function normalizeDateInput(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function parseDateBound(value, endOfDay) {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const time = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(time) ? time : null;
}
