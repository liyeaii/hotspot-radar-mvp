import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeDiscoveryTitle } from '../public/title-localizer.js';

test('localizes GitHub repository titles for hotspot display', () => {
  const title = localizeDiscoveryTitle({
    title: 'clsaa/termarium: macOS terminal app for running and managing AI coding agents (Terminal + Terrarium)',
    keyword: 'AI coding'
  });

  assert.match(title, /GitHub 项目 clsaa\/termarium/);
  assert.match(title, /macOS 终端应用/);
  assert.match(title, /AI 编程代理/);
  assert.doesNotMatch(title, /running and managing/i);
});

test('localizes local demo titles for hotspot display', () => {
  const title = localizeDiscoveryTitle({
    title: 'AI coding: model tooling update is gaining developer attention',
    keyword: 'AI coding'
  });

  assert.match(title, /AI 编程/);
  assert.match(title, /模型工具更新正在受到开发者关注/);
  assert.doesNotMatch(title, /model tooling update/i);
});
