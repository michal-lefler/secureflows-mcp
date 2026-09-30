/**
 * The security-review prompt has ONE source (src/prompts/security-review.ts). The plugin skill and the
 * docs page's four prompts are generated from it (npm run generate:prompts). These tests prove the
 * generated files are up to date, that the generators behave, and that the MCP server serves the prompt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  registerPrompts,
  SECURITY_REVIEW_PROMPT,
  SECURITY_REVIEW_PROMPT_NAME,
  STEP_PROMPTS,
} from '../src/prompts/security-review.js';
import { DOCS_PROMPTS, escapeHtml, GENERATED_NOTE, renderDocsPage, renderSkill } from '../src/prompts/security-review-artifacts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillPath = path.resolve(here, '..', 'skills', 'security-review', 'SKILL.md');
// Only present in the monorepo: the public mirror has mcp-server as its repo root.
const docsPagePath = path.resolve(here, '..', '..', 'docs', 'getting-started', 'security-review', 'index.html');
const noDocs = { skip: !fs.existsSync(docsPagePath) && 'docs page not present (public mirror)' };
const REGENERATE = 'Run `npm run generate:prompts` in mcp-server/ and commit the result.';

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const PAGE = `<html><body>
  <p>intro</p>
      <h2 id="one-shot">Run the full review</h2>
      <pre id="oneshot-prompt">old one-shot</pre>
      <pre id="review-prompt">old review</pre>
      <pre id="fit-prompt">old fit</pre>
      <pre id="plan-prompt">old plan</pre>
  <p>outro</p>
</body></html>
`;

// ---- the generated files on disk are current -------------------------------------------------

test('the plugin skill is up to date with the prompt source', () => {
  const onDisk = fs.readFileSync(skillPath, 'utf8');
  assert.equal(renderSkill(onDisk), onDisk, `SKILL.md is stale. ${REGENERATE}`);
});

test('the plugin skill body is exactly the one-shot prompt, under generated front matter', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(skill);
  assert.ok(match, 'SKILL.md must start with YAML front matter');
  assert.equal(match[2].trimEnd(), SECURITY_REVIEW_PROMPT);
  assert.match(match[1], /^# GENERATED from mcp-server\/src\/prompts\/security-review\.ts/);
  assert.match(match[1], /\nname: security-review\n/);
});

test('the docs page prompts are up to date with the prompt source', noDocs, () => {
  const onDisk = fs.readFileSync(docsPagePath, 'utf8');
  assert.equal(renderDocsPage(onDisk), onDisk, `The docs page is stale. ${REGENERATE}`);
});

test('what the docs page shows is exactly the source text, once unescaped', noDocs, () => {
  const html = fs.readFileSync(docsPagePath, 'utf8');
  for (const [id, text] of DOCS_PROMPTS) {
    const m = new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`).exec(html);
    assert.ok(m, `docs page must contain the ${id} block`);
    assert.equal(unescapeHtml(m[1]), text, id);
  }
});

// ---- the renderers ---------------------------------------------------------------------------

test('renderSkill keeps the skill front matter, manages only the generated note, and is idempotent', () => {
  const existing = '---\nname: security-review\ndescription: >\n  Reviews things.\n---\n\nstale body\n';
  const once = renderSkill(existing);
  assert.match(once, /^---\n# GENERATED from/);
  assert.ok(once.includes('name: security-review\ndescription: >\n  Reviews things.\n'), 'name and description untouched');
  assert.ok(once.endsWith(`\n---\n\n${SECURITY_REVIEW_PROMPT}\n`));
  assert.ok(!once.includes('stale body'));
  assert.equal(renderSkill(once), once, 'idempotent');
  assert.equal(once.split('# GENERATED').length - 1, 1, 'the note is never duplicated');
});

test('renderSkill refuses a file without front matter', () => {
  assert.throws(() => renderSkill('no front matter here'), /front matter/);
});

test('renderDocsPage replaces exactly the four prompt blocks and nothing else', () => {
  const out = renderDocsPage(PAGE);
  for (const [id, text] of DOCS_PROMPTS) {
    const m = new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`).exec(out);
    assert.ok(m);
    assert.equal(unescapeHtml(m[1]), text, id);
  }
  const strip = (s: string) =>
    s
      .replace(/<pre id="[a-z-]+">[\s\S]*?<\/pre>/g, '<pre/>')
      .replace(/<!-- GENERATED[\s\S]*?-->\n {6}/, '');
  assert.equal(strip(out), strip(PAGE), 'the rest of the page is byte for byte unchanged');
});

test('renderDocsPage is idempotent, keeps one note, and the note does not confuse the next run', () => {
  const once = renderDocsPage(PAGE);
  assert.equal(renderDocsPage(once), once);
  assert.equal(renderDocsPage(renderDocsPage(once)), once);
  assert.equal(once.split('<!-- GENERATED').length - 1, 1);
  assert.ok(once.includes(GENERATED_NOTE));
  assert.ok(!/<!-- GENERATED[^>]*<pre id=/.test(once), 'the note quotes no prompt markup');
});

test('renderDocsPage escapes the prompt text for HTML', () => {
  const out = renderDocsPage(PAGE);
  assert.ok(out.includes('q=&lt;your question&gt;&amp;limit=8'), 'the search URL is escaped');
  assert.equal(escapeHtml('a & <b> "c"'), 'a &amp; &lt;b&gt; "c"');
});

test('renderDocsPage fails loudly if a prompt block is missing or never closed', () => {
  assert.throws(() => renderDocsPage(PAGE.replace('<pre id="fit-prompt">old fit</pre>', '')), /no <pre id="fit-prompt">/);
  assert.throws(() => renderDocsPage(PAGE.replace('<pre id="plan-prompt">old plan</pre>', '<pre id="plan-prompt">old plan')), /never closed/);
  assert.throws(() => renderDocsPage(PAGE.replace('<h2 id="one-shot">', '<h2>')), /no <h2 id="one-shot">/);
});

// ---- the prompts themselves ------------------------------------------------------------------

test('the step-by-step prompts reuse the one-shot text: the rules under each part are identical', () => {
  const rulesOf = (text: string, heading: string): string[] => {
    const start = text.indexOf(heading);
    assert.ok(start >= 0, `"${heading}" not found`);
    return text.slice(start + heading.length).replace(/^\n/, '').split('\n\n')[0].split('\n');
  };
  for (const [step, heading] of [
    [STEP_PROMPTS.review, 'Rules for Part 1:'],
    [STEP_PROMPTS.fit, 'Rules for Part 2:'],
    [STEP_PROMPTS.plan, 'Rules for Part 3:'],
  ] as const) {
    const oneShot = rulesOf(SECURITY_REVIEW_PROMPT, heading);
    assert.ok(oneShot.length >= 3, `found the rules under "${heading}"`);
    assert.deepEqual(rulesOf(step, 'Rules:'), oneShot, heading);
  }
});

test('the step-by-step prompts point at the same documentation as the one-shot', () => {
  const urls = (t: string) => new Set(t.match(/https:\/\/[^\s)]+/g) ?? []);
  const oneShot = urls(SECURITY_REVIEW_PROMPT);
  for (const url of urls(STEP_PROMPTS.fit)) assert.ok(oneShot.has(url), `step 2 cites ${url}`);
  for (const url of urls(STEP_PROMPTS.plan)) assert.ok(oneShot.has(url), `step 3 cites ${url}`);
});

test('step 1 stays neutral: it never mentions secureFlows', () => {
  assert.doesNotMatch(STEP_PROMPTS.review, /securef(?:l)?ows/i);
});

test('MCP server lists and serves the security-review prompt', async () => {
  const server = new McpServer({ name: 'secureflows', version: 'test' });
  registerPrompts(server);
  const client = new Client({ name: 'security-review-prompt-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(
      prompts.map(p => p.name),
      [SECURITY_REVIEW_PROMPT_NAME],
    );

    const result = await client.getPrompt({ name: SECURITY_REVIEW_PROMPT_NAME });
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
    assert.deepEqual(result.messages[0].content, { type: 'text', text: SECURITY_REVIEW_PROMPT });
  } finally {
    await client.close();
    await server.close();
  }
});
