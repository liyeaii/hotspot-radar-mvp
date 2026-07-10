import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiscovery } from '../src/summarizer.js';

test('localizes extracted English highlights into Chinese summary text', async () => {
  const summary = await summarizeDiscovery({
    title: 'Arclue/Arterm-CLI: Terminal AI coding agent that runs local models. Connect to Ollama, any OpenAI-compatible server, or load a GGUF directly — plus optional cloud providers. No cloud or API keys required.',
    url: 'https://example.com/arclue',
    source: 'GitHub',
    keyword: 'AI coding',
    scope: 'AI programming',
    summary: 'Stars: 2. Updated: 2026-07-10T09:53:52Z.',
    analysis: { heat: 57, authenticityScore: 63, authenticity: 'needs-review' }
  });

  assert.match(summary.content, /终端里的 AI 编程代理工具/);
  assert.match(summary.content, /连接 Ollama/);
  assert.match(summary.content, /不需要云端服务或 API Key/);
  assert.doesNotMatch(summary.content, /Connect to/);
  assert.doesNotMatch(summary.content, /No cloud or API keys required/);
  assert.doesNotMatch(summary.content, /\bor\b/i);
  assert.doesNotMatch(summary.content, /\bthat\b/i);
});

test('localizes local demo summary text into Chinese', async () => {
  const summary = await summarizeDiscovery({
    title: 'AI coding: model tooling update is gaining developer attention',
    url: 'https://example.com/demo',
    source: 'Local Demo Pulse',
    keyword: 'AI coding',
    scope: 'AI programming',
    summary: 'A local sample item used to verify the notification and review flow without external network access.',
    analysis: { heat: 55, authenticityScore: 73, authenticity: 'verified' }
  });

  assert.match(summary.content, /AI 编程/);
  assert.match(summary.content, /本地示例信息/);
  assert.doesNotMatch(summary.content, /A local sample item/);
  assert.doesNotMatch(summary.content, /without external network access/);
});

test('summarizes GitHub repository titles as Chinese facts instead of raw English', async () => {
  const cases = [
    {
      title: 'clsaa/termarium: macOS terminal app for running and managing AI coding agents (Terminal + Terrarium)',
      forbidden: /for running and managing|coding agents/i,
      expected: /macOS 终端应用/
    },
    {
      title: 'iPythoning/pulseagent-mcp-server: MCP server for PulseAgent — let Claude Code, Cursor, and Codex interact with your AI digital workers, CRM, and pipeline',
      forbidden: /MCP server for|interact with your/i,
      expected: /MCP 服务/
    },
    {
      title: 'iPythoning/publish-all: One Markdown → publish to blog + WeChat + Zhihu + Xiaohongshu. Claude Code skill for Chinese social media content distribution',
      forbidden: /publish to blog|content distribution/i,
      expected: /微信、知乎、小红书/
    }
  ];

  for (const item of cases) {
    const summary = await summarizeDiscovery({
      title: item.title,
      url: 'https://example.com/repo',
      source: 'GitHub',
      keyword: 'AI coding',
      scope: 'AI programming',
      summary: 'Stars: 1. Updated: 2026-07-10T09:00:00Z.',
      analysis: { heat: 57, authenticityScore: 63, authenticity: 'needs-review' }
    });

    assert.match(summary.content, item.expected);
    assert.doesNotMatch(summary.content, item.forbidden);
  }
});
