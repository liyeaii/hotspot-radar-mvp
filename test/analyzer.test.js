import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeItem, fingerprint } from '../src/analyzer.js';

test('accepts relevant trusted source items', () => {
  const result = analyzeItem({
    title: 'AI coding agent update improves repository editing',
    url: 'https://github.com/example/ai-coding-agent',
    source: 'GitHub',
    summary: 'AI coding workflow release',
    publishedAt: new Date().toISOString()
  }, { keyword: 'AI coding', scope: 'AI programming' });

  assert.equal(result.authenticity, 'verified');
  assert.ok(result.relevance >= 45);
  assert.ok(result.heat >= 40);
});

test('flags suspicious official claims outside known domains', () => {
  const result = analyzeItem({
    title: 'OpenAI leaked!! free token giveaway',
    url: 'https://openai-free-token-wallet-connect.example.net',
    source: 'Unknown',
    summary: 'Act now to claim.',
    publishedAt: new Date().toISOString()
  }, { keyword: 'OpenAI', scope: 'AI models' });

  assert.equal(result.authenticity, 'reject');
  assert.ok(result.reasons.some((reason) => reason.includes('OpenAI claim')));
});

test('fingerprint is stable for same item', () => {
  const item = { title: 'Same title', url: 'https://example.com/post' };
  assert.equal(fingerprint(item), fingerprint({ ...item }));
});
