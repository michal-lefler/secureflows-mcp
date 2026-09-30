/**
 * Renders the files generated from the security-review prompt source (./security-review.ts).
 * Pure functions (text in, text out) so a test can prove the files on disk are up to date;
 * scripts/generate-security-review.mjs does the reading and writing.
 */
import { SECURITY_REVIEW_PROMPT, STEP_PROMPTS } from './security-review.js';

export const GENERATED_NOTE =
  'GENERATED from mcp-server/src/prompts/security-review.ts by `npm run generate:prompts` (in mcp-server/). Edit the source, not this file.';

/** The docs page's prompts: element id of each <pre> and the text it carries. */
export const DOCS_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['oneshot-prompt', SECURITY_REVIEW_PROMPT],
  ['review-prompt', STEP_PROMPTS.review],
  ['fit-prompt', STEP_PROMPTS.fit],
  ['plan-prompt', STEP_PROMPTS.plan],
];

// No literal tags in the note: the generator looks for the prompt blocks by their markup, and a
// comment that quotes it would be found first.
const DOCS_NOTE = `<!-- ${GENERATED_NOTE} The prompt blocks below (ids oneshot-prompt, review-prompt, fit-prompt and plan-prompt) are generated; change the source and regenerate. -->`;
const NOTE_PATTERN = /<!-- GENERATED from mcp-server\/src\/prompts\/security-review\.ts[\s\S]*?-->\n {6}/;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The plugin skill: the prompt as the body, under the skill's own front matter. The front matter
 * (name, description) is kept as written; only the "generated" note line at its top is managed here.
 */
export function renderSkill(existing: string): string {
  const match = /^---\n([\s\S]*?)\n---\n\n/.exec(existing);
  if (!match) {
    throw new Error('SKILL.md must start with YAML front matter (--- ... ---)');
  }
  const fields = match[1]
    .split('\n')
    .filter(line => !line.startsWith('# GENERATED'))
    .join('\n');
  return `---\n# ${GENERATED_NOTE}\n${fields}\n---\n\n${SECURITY_REVIEW_PROMPT}\n`;
}

/** The docs page with each generated prompt replaced by the current text. Everything else is untouched. */
export function renderDocsPage(html: string): string {
  // Take the note out first so nothing in it can be mistaken for a prompt block; it goes back at the end.
  let out = html.replace(NOTE_PATTERN, '');
  for (const [id, text] of DOCS_PROMPTS) {
    const open = `<pre id="${id}">`;
    const start = out.indexOf(open);
    if (start < 0) {
      throw new Error(`docs page has no <pre id="${id}">`);
    }
    const contentStart = start + open.length;
    const end = out.indexOf('</pre>', contentStart);
    if (end < 0) {
      throw new Error(`docs page: <pre id="${id}"> is never closed`);
    }
    out = out.slice(0, contentStart) + escapeHtml(text) + out.slice(end);
  }
  // One note above the first generated prompt's section.
  const anchor = '<h2 id="one-shot">';
  const at = out.indexOf(anchor);
  if (at < 0) {
    throw new Error(`docs page has no ${anchor}`);
  }
  return `${out.slice(0, at)}${DOCS_NOTE}\n      ${out.slice(at)}`;
}
