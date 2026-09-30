/**
 * Opt-in live check of the destination the Claude Code plugin connects to (the URL in .mcp.json).
 * Skipped unless SECUREFLOWS_LIVE_MCP=1, so `npm test` stays offline. Run with `npm run test:live`.
 *
 *   SECUREFLOWS_LIVE_MCP=1 npm run test:live                          # endpoint speaks MCP, serves the tools
 *   SECUREFLOWS_LIVE_MCP=1 SECUREFLOWS_LIVE_MCP_PROMPTS=1 npm run test:live   # ...and the security-review prompt
 *                                                                     # (only true once the new server is deployed)
 *   SECUREFLOWS_LIVE_MCP_URL=https://secure-flows-staging.onrender.com/mcp   # point at staging instead
 *
 * Read-only: initialize + listTools/listPrompts/getPrompt. Sends no credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SECURITY_REVIEW_PROMPT, SECURITY_REVIEW_PROMPT_NAME } from '../src/prompts/security-review.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const live = process.env.SECUREFLOWS_LIVE_MCP === '1';
const livePrompts = live && process.env.SECUREFLOWS_LIVE_MCP_PROMPTS === '1';

function pluginMcpUrl(): string {
  const mcp = JSON.parse(fs.readFileSync(path.resolve(here, '..', '.mcp.json'), 'utf8')) as {
    mcpServers: { secureflows: { url: string } };
  };
  return mcp.mcpServers.secureflows.url;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.SECUREFLOWS_LIVE_MCP_URL ?? pluginMcpUrl();
  const client = new Client({ name: 'plugin-destination-live-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test(
  'the plugin destination answers MCP initialize and lists the static tools',
  { skip: !live && 'set SECUREFLOWS_LIVE_MCP=1', timeout: 60_000 },
  async () => {
    const names = await withClient(async client => (await client.listTools()).tools.map(t => t.name));
    for (const tool of ['secureflows_build_login_url', 'secureflows_build_logout_url', 'secureflows_lint_integration']) {
      assert.ok(names.includes(tool), `hosted server is missing ${tool}`);
    }
  },
);

test(
  'the plugin destination serves the security-review prompt unchanged',
  { skip: !livePrompts && 'set SECUREFLOWS_LIVE_MCP=1 SECUREFLOWS_LIVE_MCP_PROMPTS=1 (after the new server is deployed)', timeout: 60_000 },
  async () => {
    const result = await withClient(async client => {
      const { prompts } = await client.listPrompts();
      assert.ok(prompts.some(p => p.name === SECURITY_REVIEW_PROMPT_NAME), 'prompt is not listed');
      return client.getPrompt({ name: SECURITY_REVIEW_PROMPT_NAME });
    });
    assert.deepEqual(result.messages[0].content, { type: 'text', text: SECURITY_REVIEW_PROMPT });
  },
);
