import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRPCHeaderRule, stripRPCHeaders, RPC_REMOVED_HEADERS, RPC_HEADER_RULE_FIRST, RPC_HEADER_RULE_LIMIT } from '../src/rpc-headers.js';
import { createRPCPolicyInstaller } from '../src/rpc-policy.js';
import { createRPCTransport } from '../src/rpc.js';

const id = 'a'.repeat(32);
test('Header removal is limited to this extension, exact HTTPS endpoint, POST and preflight', () => {
  const rule = makeRPCHeaderRule('https://rpc.example/v1/key?api-key=secret', id, 2000);
  assert.deepEqual(rule.condition.initiatorDomains, [id]);
  assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest']);
  assert.deepEqual(rule.condition.requestMethods, ['post', 'options']);
  assert.equal(rule.action.type, 'modifyHeaders');
  assert.ok(rule.action.requestHeaders.every(header => header.operation === 'remove'));
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.ok(pattern.test('https://rpc.example/v1/key?api-key=another'));
  for (const url of ['https://rpc.example.evil/v1/key', 'https://rpc.example/v1/key/extra', 'https://rpc.example/v1/other', 'https://other.example/v1/key', 'http://rpc.example/v1/key']) assert.ok(!pattern.test(url));
  assert.doesNotMatch(JSON.stringify(rule), /secret/);
  assert.throws(() => makeRPCHeaderRule('http://rpc.example', id, 2000));
});

test('Application headers lose source/SDK metadata while Content-Type and API authentication survive', () => {
  const supplied = new Headers(Object.fromEntries(RPC_REMOVED_HEADERS.map(name => [name, 'private'])));
  supplied.set('authorization', 'Bearer token'); supplied.set('x-api-key', 'secret'); supplied.set('content-type', 'application/json');
  supplied.set('x-debug-page', 'chrome-extension://aaaa/resolve.html');
  supplied.set('x-debug-worker', 'chrome-extension://aaaa/background.js');
  const result = stripRPCHeaders(supplied);
  for (const name of [...RPC_REMOVED_HEADERS, 'x-debug-page', 'x-debug-worker']) assert.equal(result.get(name), null);
  assert.equal(result.get('authorization'), 'Bearer token');
  assert.equal(result.get('x-api-key'), 'secret');
  assert.equal(result.get('content-type'), 'application/json');
});

function fakeAPI() {
  let rules = [];
  const api = {
    runtime: { id }, permissions: { contains: async () => true },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      isRegexSupported: async () => ({ isSupported: true }),
      updateSessionRules: async ({ removeRuleIds, addRules }) => { rules = [...rules.filter(r => !removeRuleIds.includes(r.id)), ...addRules]; },
    },
  };
  return api;
}

test('Concurrent probe and resolution endpoint rules coexist and refresh after worker restart', async () => {
  const api = fakeAPI(); const prepare = createRPCPolicyInstaller(api);
  await Promise.all([prepare('https://one.example/rpc'), prepare('https://two.example/rpc')]);
  const rules = await api.declarativeNetRequest.getSessionRules();
  assert.equal(rules.length, 2); assert.equal(new Set(rules.map(r => r.id)).size, 2);
  await createRPCPolicyInstaller(api)('https://one.example/rpc?key=new');
  assert.equal((await api.declarativeNetRequest.getSessionRules()).length, 2);
});

test('Denied host permission, unsupported scope and exhausted rule IDs fail closed', async () => {
  const api = fakeAPI();
  api.permissions.contains = async () => false;
  await assert.rejects(createRPCPolicyInstaller(api)('https://rpc.example'), /权限/);
  assert.deepEqual(await api.declarativeNetRequest.getSessionRules(), []);
  api.permissions.contains = async () => true;
  api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false });
  await assert.rejects(createRPCPolicyInstaller(api)('https://rpc.example'), /请求保护/);
  api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: true });
  api.declarativeNetRequest.getSessionRules = async () => Array.from({ length: RPC_HEADER_RULE_LIMIT }, (_, i) => makeRPCHeaderRule(`https://endpoint${i}.example`, id, RPC_HEADER_RULE_FIRST + i));
  await assert.rejects(createRPCPolicyInstaller(api)('https://new.example'), /过多/);
});

test('A Chrome RPC cannot fetch until its protection rule is acknowledged; auth is preserved', async t => {
  const original = globalThis.chrome;
  t.after(() => { globalThis.chrome = original; });
  let release; let fetched = false;
  globalThis.chrome = { runtime: { id, sendMessage: async () => new Promise(resolve => { release = resolve; }) } };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    fetched = true;
    assert.equal(options.headers.get('origin'), null);
    assert.equal(options.headers.get('authorization'), 'Bearer token');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrer, '');
    return Response.json({ result: 1 });
  });
  const transport = createRPCTransport('https://rpc.example', AbortSignal.timeout(1000));
  const pending = transport.fetch('https://rpc.example', { method: 'POST', body: '{"method":"getAccountInfo"}', headers: { origin: 'chrome-extension://abc', authorization: 'Bearer token' } });
  assert.equal(fetched, false); release({ ok: true }); await pending; assert.equal(fetched, true);
});

test('Failed rule installation or invalidated extension tabs never send the RPC request', async t => {
  const original = globalThis.chrome; t.after(() => { globalThis.chrome = original; });
  let fetched = false;
  t.mock.method(globalThis, 'fetch', async () => { fetched = true; return Response.json({ result: 1 }); });
  for (const sendMessage of [async () => ({ ok: false }), async () => { throw new Error('Extension context invalidated'); }]) {
    globalThis.chrome = { runtime: { id, sendMessage } };
    await assert.rejects(createRPCTransport('https://rpc.example', AbortSignal.timeout(1000)).call('getAccountInfo'), error => error.code === 'RPC_HEADER_POLICY');
  }
  assert.equal(fetched, false);
});
