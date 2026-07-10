import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQueries, normalizeSourceIds } from '../src/sources.js';

test('builds broader source queries from keyword and scope', () => {
  const queries = buildSearchQueries({ keyword: 'Claude Code', scope: 'AI 编程' });
  assert.deepEqual(queries, ['claude code', 'ai 编程', 'claude code ai 编程']);
});

test('normalizes enabled source ids', () => {
  assert.deepEqual(normalizeSourceIds(['github', 'github', 'bad-source', 'arxiv']), ['github', 'arxiv']);
  assert.ok(normalizeSourceIds([]).includes('google-news'));
});
