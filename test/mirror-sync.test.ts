/**
 * End-to-end test of scripts/sync-public-mirrors.mjs for the secureflows-mcp mirror, against a
 * local bare git repository standing in for GitHub. Runs the real script with --commit --push and
 * inspects what arrived in the "remote".
 *
 * Hermetic: the script is run from a throwaway copy of the pieces of the monorepo it reads, so the
 * real working tree is never touched (it writes mcp-server/docs/ while bundling and removes it
 * afterwards, which would race other tests reading that folder).
 *
 * Monorepo-only: skips itself in the public mirror, which has no sync script.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');
const available =
  fs.existsSync(path.join(realRoot, 'scripts', 'sync-public-mirrors.mjs')) &&
  spawnSync('rsync', ['--version']).status === 0 &&
  spawnSync('git', ['--version']).status === 0;
const opts = { skip: !available && 'needs the monorepo sync script plus git and rsync' };

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'mirror-sync-test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'mirror-sync-test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  // Ignore the developer's own git config (signing, hooks, default branch).
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout.trim();
}

let tmp = '';
let mono = '';
let bare = '';
let mirrors = '';

function runSync(): { status: number | null; output: string } {
  const r = spawnSync(
    process.execPath,
    [path.join(mono, 'scripts', 'sync-public-mirrors.mjs'), '--only=secureflows-mcp', '--commit', '--push', `--dest=${mirrors}`],
    { cwd: mono, env: GIT_ENV, encoding: 'utf8' },
  );
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function remoteFiles(): string[] {
  return git(bare, 'ls-tree', '-r', '--name-only', 'main').split('\n');
}

function remoteFile(p: string): string {
  return git(bare, 'show', `main:${p}`);
}

before(() => {
  if (!available) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mirror-sync-'));
  mono = path.join(tmp, 'monorepo');
  bare = path.join(tmp, 'origin.git');
  mirrors = path.join(tmp, 'mirrors');

  // Throwaway monorepo: only what the script reads for this package.
  const skip = (src: string) => {
    const parts = src.split(path.sep);
    return !parts.includes('node_modules') && !parts.includes('dist') && !parts.includes('.git');
  };
  const copy = (rel: string, filter = skip) =>
    fs.cpSync(path.join(realRoot, rel), path.join(mono, rel), { recursive: true, filter });
  fs.mkdirSync(path.join(mono, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(realRoot, 'scripts', 'sync-public-mirrors.mjs'),
    path.join(mono, 'scripts', 'sync-public-mirrors.mjs'),
  );
  copy('scripts/public-mirrors/overlays/secureflows-mcp');
  // mcp-server without its generated docs/ — like a fresh CI checkout — so the bundling step
  // has to recreate it, as it does in the real workflow.
  copy('mcp-server', src => skip(src) && path.relative(path.join(realRoot, 'mcp-server'), src) !== 'docs');
  copy('docs/openapi');
  copy('templates/web-app-secureflows/src');
  git(mono, 'init', '--quiet', '--initial-branch=main');
  git(mono, 'add', '-A');
  git(mono, 'commit', '--quiet', '-m', 'monorepo snapshot');

  // "GitHub": a bare repo with one seed commit, cloned where the script expects the checkout.
  git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', bare);
  const seed = path.join(tmp, 'seed');
  git(tmp, 'clone', '--quiet', bare, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# secureflows-mcp\n\nSeed commit.\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'seed');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  fs.mkdirSync(mirrors, { recursive: true });
  git(tmp, 'clone', '--quiet', bare, path.join(mirrors, 'secureflows-mcp'));
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('first sync pushes the plugin, marketplace, hosted .mcp.json and both skills', opts, () => {
  const { status, output } = runSync();
  assert.equal(status, 0, output);
  assert.match(output, /Sync from secureFlows monorepo @/);

  const files = remoteFiles();
  for (const expected of [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json', // overlay: only exists in the mirror
    '.mcp.json',
    'skills/security-review/SKILL.md',
    'src/prompts/security-review.ts',
    'test/security-review-prompt.test.ts',
    'server.json', // overlay
    '.github/workflows/publish-mcp-registry.yml', // overlay
    'docs/openapi/session/secure-flows-session-api.yaml', // bundled during sync
  ]) {
    assert.ok(files.includes(expected), `mirror is missing ${expected}`);
  }
  assert.ok(!files.some(f => f.startsWith('node_modules/') || f.startsWith('dist/')), 'no build output in the mirror');
});

test('the pushed plugin files are the ones a stranger installs from', opts, () => {
  const plugin = JSON.parse(remoteFile('.claude-plugin/plugin.json')) as { name: string; skills: string[] };
  const marketplace = JSON.parse(remoteFile('.claude-plugin/marketplace.json')) as {
    name: string;
    plugins: Array<{ name: string; source: string }>;
  };
  const mcp = JSON.parse(remoteFile('.mcp.json')) as { mcpServers: { secureflows: { type: string; url: string } } };

  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, './');
  assert.deepEqual(mcp.mcpServers.secureflows, { type: 'http', url: 'https://www.secure-flows.com/mcp' });
  for (const skill of plugin.skills) {
    const name = path.basename(skill);
    // The integration skill is generated by a separate workflow step; the review skill is committed.
    if (name === 'security-review') {
      assert.ok(remoteFiles().includes(`skills/${name}/SKILL.md`));
    }
  }

  const mirrorPackage = JSON.parse(remoteFile('package.json')) as { repository: { url: string } };
  assert.equal(mirrorPackage.repository.url, 'https://github.com/michal-lefler/secureflows-mcp.git');
});

test('the mirror keeps its registry listing pointing at the hosted endpoint', opts, () => {
  const server = JSON.parse(remoteFile('server.json')) as { remotes: Array<{ url: string }> };
  assert.deepEqual(server.remotes.map(r => r.url), ['https://www.secure-flows.com/mcp']);
});

test('a second sync with no changes is a no-op (no empty commit, no failure)', opts, () => {
  const before = git(bare, 'rev-list', '--count', 'main');
  const { status, output } = runSync();
  assert.equal(status, 0, output);
  assert.match(output, /already up to date/);
  assert.equal(git(bare, 'rev-list', '--count', 'main'), before);
});

test('removing a file in the monorepo removes it from the mirror on the next sync', opts, () => {
  fs.rmSync(path.join(mono, 'mcp-server', 'skills', 'security-review'), { recursive: true });
  git(mono, 'add', '-A');
  git(mono, 'commit', '--quiet', '-m', 'drop security-review skill');

  const { status, output } = runSync();
  assert.equal(status, 0, output);
  assert.ok(!remoteFiles().includes('skills/security-review/SKILL.md'), 'stale file must not linger in the mirror');
});
