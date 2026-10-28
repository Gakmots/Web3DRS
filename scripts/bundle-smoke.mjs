import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { rpcResponse } from '../test/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'extension/chunks');
const build = JSON.parse(await readFile(path.join(root, 'extension/BUILD.json'), 'utf8'));
const chunk = build.outputs.find(file => /^chunks\/sns-.*\.js$/.test(file))?.slice('chunks/'.length);
assert.ok(chunk, 'Build the extension before testing the bundled SNS module');
const original = { process: globalThis.process, Buffer: globalThis.Buffer, fetch: globalThis.fetch, window: globalThis.window, chrome: globalThis.chrome };
const methods = [];
try {
  // Exercise the actual browser build, without Node's process or Buffer.
  delete globalThis.process;
  delete globalThis.Buffer;
  globalThis.window = globalThis;
  globalThis.chrome = { runtime: { id: 'a'.repeat(32), sendMessage: async message => { assert.equal(message.type, 'PREPARE_RPC'); return { ok: true }; } } };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body); methods.push(payload.method);
    return Response.json(rpcResponse(payload));
  };
  const { resolveSNS } = await import(pathToFileURL(path.join(directory, chunk)).href);
  for (const name of ['website', 'burned', 'active']) {
    const result = await resolveSNS({ name: `${name}.sns`, pathname: '/docs', search: '?q=1', hash: '#part' }, 'https://rpc.example', new AbortController().signal);
    assert.equal(result.url, 'https://website.example/base/docs?q=1#part');
  }
  assert.equal(methods.filter(method => method === 'getTokenLargestAccounts').length, 1);
} finally { Object.assign(globalThis, original); }
console.log('PASS browser-bundled SNS module: unminted, burned, active NFT; no Node globals');
