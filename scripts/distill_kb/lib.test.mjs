// 跑法: node --test scripts/distill_kb/lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripThinkSection,
  unwrapInlineThink,
  softenWikiLinks,
  processContent,
  checkRules,
} from './lib.mjs';

test('stripThinkSection 删末尾🧠整节（标题到文件尾）', () => {
  const body = '## A\n\n正文。\n\n### 🧠 整理思考\n\n结构判断：xx\n';
  assert.equal(stripThinkSection(body), '## A\n\n正文。\n');
});

test('stripThinkSection 无🧠整节时原样返回', () => {
  const body = '## A\n\n正文。\n';
  assert.equal(stripThinkSection(body), body);
});

test('unwrapInlineThink 去行内🧠前缀留内容', () => {
  assert.equal(unwrapInlineThink('> 🧠 旁注内容'), '旁注内容');
  assert.equal(unwrapInlineThink('> 🧠旁注'), '旁注');
  assert.equal(unwrapInlineThink('普通行'), '普通行');
});

test('softenWikiLinks 互链转书名号 + 清理前缀空格', () => {
  assert.equal(softenWikiLinks('见 [[某文件]]。'), '见《某文件》。');
  assert.equal(softenWikiLinks('详见 [[网文入门]] 与 [[爽点]]'), '详见《网文入门》与《爽点》');
});

test('processContent 保留 frontmatter + 正文三件清理', () => {
  const input =
    '---\ntags: [测试]\n---\n\n> **一句话**：tldr。\n\n## A\n\n见 [[某文件]]。\n\n> 🧠 旁注。\n\n### 🧠 整理思考\n\n结构判断：xx\n';
  const out = processContent(input);
  assert.ok(out.startsWith('---\ntags: [测试]\n---\n'), 'frontmatter 保留');
  assert.ok(!out.includes('🧠'), '无 🧠 残留');
  assert.ok(!out.includes('[['), '无 [[ 残留');
  assert.ok(out.includes('见《某文件》。'), '互链已转');
  assert.ok(out.includes('旁注。'), '行内旁注内容保留');
});

test('checkRules 干净内容通过', () => {
  const clean =
    '---\ntags: [x]\n---\n\n## 标题\n\n这是一段足够长的正文内容，用于验证 checkRules 的长度检查门槛能够正确放行正常篇幅的文档段落，不会误报正文过短。\n';
  assert.deepEqual(checkRules(clean), []);
});

test('checkRules 抓出 🧠 / [[ / 缺 tags', () => {
  const bad = '---\ntags: [x]\n---\n\n## A\n\n正文 🧠 残留 [[链]]。\n';
  const p = checkRules(bad);
  assert.ok(p.some((x) => x.includes('🧠')));
  assert.ok(p.some((x) => x.includes('[[')));
});
