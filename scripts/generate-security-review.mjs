// Regenerates the files derived from src/prompts/security-review.ts:
//   - skills/security-review/SKILL.md                               (always)
//   - ../docs/getting-started/security-review/index.html            (only in the monorepo, where it exists)
//
//   npm run generate:prompts          # write
//   npm run generate:prompts -- --check   # exit 1 if a file is stale, change nothing
//
// Run through tsx (see the npm script) because it imports the TypeScript source directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderDocsPage, renderSkill } from '../src/prompts/security-review-artifacts.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const targets = [
  { file: path.join(packageRoot, 'skills', 'security-review', 'SKILL.md'), render: renderSkill, required: true },
  {
    file: path.join(packageRoot, '..', 'docs', 'getting-started', 'security-review', 'index.html'),
    render: renderDocsPage,
    required: false,
  },
];

let stale = 0;
for (const { file, render, required } of targets) {
  const label = path.relative(packageRoot, file);
  if (!fs.existsSync(file)) {
    if (required) {
      console.error(`missing ${label}`);
      process.exit(1);
    }
    console.log(`skip   ${label} (not present here)`);
    continue;
  }
  const current = fs.readFileSync(file, 'utf8');
  const next = render(current);
  if (next === current) {
    console.log(`ok     ${label}`);
  } else if (check) {
    console.log(`STALE  ${label}`);
    stale++;
  } else {
    fs.writeFileSync(file, next);
    console.log(`wrote  ${label}`);
  }
}

if (stale > 0) {
  console.error('\nGenerated files are out of date. Run: npm run generate:prompts (in mcp-server/)');
  process.exit(1);
}
