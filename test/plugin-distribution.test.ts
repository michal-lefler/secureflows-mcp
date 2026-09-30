/**
 * Guards the Claude Code plugin's distribution wiring: manifests, the hosted MCP destination, the
 * install commands shown to users, and the CI job that publishes the public mirror.
 *
 * These are cross-file consistency checks — each one fails when two files that must agree drift
 * apart (a renamed marketplace, a CI job that loses `secrets: inherit`, a stale install command).
 *
 * Plugin-manifest checks run in both the monorepo and the public mirror (mcp-server is the repo
 * root there). Checks that need monorepo-only files (docs pages, CI workflows, marketplace overlay
 * source) skip themselves in the mirror.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const monorepoRoot = path.resolve(pluginRoot, '..');
const inMonorepo = fs.existsSync(path.join(monorepoRoot, 'scripts', 'sync-public-mirrors.mjs'));
const monorepoOnly = { skip: !inMonorepo && 'monorepo-only file (this is the public mirror)' };

/** Skills whose SKILL.md is generated (gitignored) — absent in a fresh CI checkout by design. */
const GENERATED_SKILLS = new Set(['secureflows-integration']);

const HOSTED_MCP_URL = 'https://www.secure-flows.com/mcp';

function readJson<T = Record<string, unknown>>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function readYaml<T = Record<string, unknown>>(p: string): T {
  return parse(fs.readFileSync(p, 'utf8')) as T;
}

function frontmatterName(skillMd: string): string | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(skillMd);
  return m ? (parse(m[1]) as { name?: string }).name : undefined;
}

const plugin = readJson<{
  name: string;
  version: string;
  repository: string;
  skills: string[];
  mcpServers: string;
}>(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));

/** The marketplace the mirror ships: overlay source in the monorepo, repo root in the mirror. */
function mirrorMarketplacePath(): string {
  const overlay = path.join(
    monorepoRoot,
    'scripts',
    'public-mirrors',
    'overlays',
    'secureflows-mcp',
    '.claude-plugin',
    'marketplace.json',
  );
  return inMonorepo ? overlay : path.join(pluginRoot, '.claude-plugin', 'marketplace.json');
}

const mirrorMarketplace = readJson<{
  name: string;
  plugins: Array<{ name: string; source: string }>;
}>(mirrorMarketplacePath());

/** `michal-lefler/secureflows-mcp` from `https://github.com/michal-lefler/secureflows-mcp(.git)`. */
function repoSlug(url: string): string {
  const m = /github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  assert.ok(m, `not a GitHub repo URL: ${url}`);
  return m[1];
}

const addCommand = `/plugin marketplace add ${repoSlug(plugin.repository)}`;
const installCommand = `/plugin install ${plugin.name}@${mirrorMarketplace.name}`;

test('plugin.json has a semver version and points at an existing .mcp.json', () => {
  assert.equal(plugin.name, 'secureflows');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(fs.existsSync(path.join(pluginRoot, plugin.mcpServers)), `${plugin.mcpServers} must exist`);
});

test('every skill listed in plugin.json exists with a matching frontmatter name', () => {
  assert.ok(plugin.skills.includes('./skills/security-review'), 'security-review skill must be registered');
  for (const entry of plugin.skills) {
    const dir = path.join(pluginRoot, entry);
    const skillName = path.basename(dir);
    const skillFile = path.join(dir, 'SKILL.md');
    if (GENERATED_SKILLS.has(skillName) && !fs.existsSync(skillFile)) {
      continue;
    }
    assert.ok(fs.existsSync(skillFile), `${entry}/SKILL.md must exist`);
    assert.equal(frontmatterName(fs.readFileSync(skillFile, 'utf8')), skillName, `${entry} frontmatter name`);
  }
});

test('every skill directory on disk is registered in plugin.json (no orphaned skill)', () => {
  const skillsDir = path.join(pluginRoot, 'skills');
  const onDisk = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md')))
    .map(e => `./skills/${e.name}`);
  for (const entry of onDisk) {
    assert.ok(plugin.skills.includes(entry), `${entry} exists but is not listed in plugin.json skills`);
  }
});

test('.mcp.json connects the hosted HTTP endpoint, not a local process', () => {
  const mcp = readJson<{ mcpServers: Record<string, Record<string, unknown>> }>(path.join(pluginRoot, '.mcp.json'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['secureflows']);
  const server = mcp.mcpServers.secureflows;
  assert.equal(server.type, 'http');
  assert.equal(server.url, HOSTED_MCP_URL);
  // Regression: the old config ran `npx secureflows`, which starts an HTTP server that Claude Code
  // cannot speak to over stdio, and passed an API key variable the server never reads.
  for (const forbidden of ['command', 'args', 'env']) {
    assert.ok(!(forbidden in server), `.mcp.json must not set "${forbidden}"`);
  }
});

test('mirror marketplace lists this plugin at the repo root', () => {
  assert.equal(mirrorMarketplace.name, 'secureflows-marketplace');
  assert.equal(mirrorMarketplace.plugins.length, 1);
  assert.equal(mirrorMarketplace.plugins[0].name, plugin.name);
  assert.equal(mirrorMarketplace.plugins[0].source, './');
});

test('README documents the same install commands the manifests imply', () => {
  const readme = fs.readFileSync(path.join(pluginRoot, 'README.md'), 'utf8');
  assert.ok(readme.includes(addCommand), `README must contain: ${addCommand}`);
  assert.ok(readme.includes(installCommand), `README must contain: ${installCommand}`);
  assert.ok(readme.includes('/secureflows:security-review'));
});

test('registry listing points at the same hosted endpoint as .mcp.json', monorepoOnly, () => {
  const serverJson = readJson<{ remotes: Array<{ type: string; url: string }>; repository: { url: string } }>(
    path.join(monorepoRoot, 'scripts', 'public-mirrors', 'overlays', 'secureflows-mcp', 'server.json'),
  );
  assert.deepEqual(serverJson.remotes.map(r => r.url), [HOSTED_MCP_URL]);
  assert.equal(repoSlug(serverJson.repository.url), repoSlug(plugin.repository));
});

test('monorepo and mirror marketplaces agree on name and plugin', monorepoOnly, () => {
  const root = readJson<{ name: string; plugins: Array<{ name: string; source: string }> }>(
    path.join(monorepoRoot, '.claude-plugin', 'marketplace.json'),
  );
  assert.equal(root.name, mirrorMarketplace.name);
  assert.deepEqual(root.plugins.map(p => p.name), mirrorMarketplace.plugins.map(p => p.name));
  // The monorepo marketplace points into mcp-server/, where plugin.json lives.
  assert.equal(root.plugins[0].source, './mcp-server');
});

test('docs pages show the exact install commands and the slash command', monorepoOnly, () => {
  for (const page of [
    ['getting-started', 'security-review'],
    ['introduction', 'mcp-server'],
  ]) {
    const html = fs.readFileSync(path.join(monorepoRoot, 'docs', ...page, 'index.html'), 'utf8');
    assert.ok(html.includes(addCommand), `${page.join('/')} must contain: ${addCommand}`);
    assert.ok(html.includes(installCommand), `${page.join('/')} must contain: ${installCommand}`);
  }
  const review = fs.readFileSync(path.join(monorepoRoot, 'docs', 'getting-started', 'security-review', 'index.html'), 'utf8');
  assert.ok(review.includes('/secureflows:security-review'));
});

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    {
      'runs-on'?: string;
      if?: string;
      needs?: string | string[];
      uses?: string;
      secrets?: unknown;
      steps?: WorkflowStep[];
    }
  >;
}

const syncWorkflowPath = path.join(monorepoRoot, '.github', 'workflows', 'sync-public-mirrors.yml');

test('sync workflow is reusable and manually runnable, with least-privilege token permissions', monorepoOnly, () => {
  const wf = readYaml<Workflow>(syncWorkflowPath);
  assert.ok('workflow_call' in wf.on, 'ci.yml calls it, so it needs workflow_call');
  assert.ok('workflow_dispatch' in wf.on, 'must be startable by hand from the Actions tab');
  assert.deepEqual(wf.permissions, { contents: 'read' });
});

test('sync job: GitHub-hosted runner, generates the skill before syncing, pushes with the PAT', monorepoOnly, () => {
  const wf = readYaml<Workflow>(syncWorkflowPath);
  const job = wf.jobs.sync;
  // A job holding a token that can push to public repos must not run on the self-hosted box.
  assert.equal(job['runs-on'], 'ubuntu-latest');

  const steps = job.steps ?? [];
  const checkout = steps.find(s => s.uses?.startsWith('actions/checkout'));
  assert.ok(checkout, 'checkout step');
  assert.equal(checkout.with?.['persist-credentials'], false, 'do not leave the default token in git config');

  const generate = steps.findIndex(s => s.run?.includes('scripts/publish-secureflows-skill-chunks.mjs'));
  const sync = steps.findIndex(s => s.run?.includes('scripts/sync-public-mirrors.mjs'));
  assert.ok(generate >= 0, 'must regenerate the gitignored plugin skill');
  assert.ok(sync >= 0, 'must run the sync script');
  assert.ok(generate < sync, 'skill generation must come before the sync (sync copies the directory as it is on disk)');

  const syncStep = steps[sync];
  assert.match(syncStep.run ?? '', /--commit\b/);
  assert.match(syncStep.run ?? '', /--push\b/);
  assert.equal(syncStep.env?.MIRRORS_PUSH_TOKEN, '${{ secrets.MIRRORS_PUSH_TOKEN }}');
});

test('sync workflow never writes the token into a file or command line', monorepoOnly, () => {
  const text = fs.readFileSync(syncWorkflowPath, 'utf8');
  // The only place the secret may appear is the step-level env mapping.
  const uses = text.split('\n').filter(line => line.includes('secrets.MIRRORS_PUSH_TOKEN'));
  assert.equal(uses.length, 1, `MIRRORS_PUSH_TOKEN referenced ${uses.length} times: ${uses.join(' | ')}`);
  assert.ok(!/x-access-token:\$/.test(text), 'no token embedded in a remote URL');
  assert.ok(!/git remote .*MIRRORS_PUSH_TOKEN/.test(text), 'no token in remote configuration');
});

test('ci.yml runs the sync on tags only, after all three npm publishes, with secrets inherited', monorepoOnly, () => {
  const ci = readYaml<Workflow>(path.join(monorepoRoot, '.github', 'workflows', 'ci.yml'));
  const job = ci.jobs['sync-public-mirrors'];
  assert.ok(job, 'ci.yml must define the sync-public-mirrors job');
  assert.equal(job.uses, './.github/workflows/sync-public-mirrors.yml');
  assert.ok(fs.existsSync(path.join(monorepoRoot, job.uses.replace(/^\.\//, ''))), 'referenced workflow file exists');
  assert.equal(job.if, "startsWith(github.ref, 'refs/tags/')");
  // Without `secrets: inherit` a called workflow sees an empty MIRRORS_PUSH_TOKEN and the push 403s.
  assert.equal(job.secrets, 'inherit');

  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  for (const publish of ['secureflows-js-publish', 'mcp-server-publish', 'create-app-publish']) {
    assert.ok(ci.jobs[publish], `${publish} must exist in ci.yml`);
    assert.ok(needs.includes(publish), `sync must wait for ${publish}`);
  }
});
