import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSNS } from '../src/sns.js';
import { parseDomainInput } from '../src/core.js';
import { rpcResponse, tokenAccountKey } from './fixtures.mjs';

test('Real SNS SDK + protocol accounts: success, absent domain, empty, stale and unsafe records', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload.method);
    return new Response(JSON.stringify(rpcResponse(payload)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const signal = new AbortController().signal;
  const request = parseDomainInput('website.sns/docs?x=1#part');
  assert.equal((await resolveSNS(request, 'https://rpc.example', signal)).url, 'https://website.example/base/docs?x=1#part');
  for (const [name, pattern] of [['empty', /没有配置/], ['stale', /未通过/], ['unsafe', /无法打开/], ['missing', /does not exist/]]) {
    await assert.rejects(resolveSNS(parseDomainInput(`${name}.sns`), 'https://rpc.example', signal), pattern);
  }
  assert.ok(calls.includes('getAccountInfo'));
  assert.ok(calls.includes('getMultipleAccounts'));
  assert.ok(!calls.includes('getTokenLargestAccounts'), 'unminted names do not need an NFT holder query');
});

test('Absent and burned NFT mints resolve even when the RPC rejects all holder queries', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload.method);
    if (payload.method === 'getTokenLargestAccounts') return new Response('Rate limited', { status: 429 });
    return Response.json(rpcResponse(payload));
  });
  for (const name of ['website', 'burned']) {
    assert.equal((await resolveSNS(parseDomainInput(`${name}.sns`), 'https://rpc.example', new AbortController().signal)).url, 'https://website.example/base/');
  }
  assert.ok(!calls.includes('getTokenLargestAccounts'));
});

test('Active NFT names still verify the actual token holder, rather than registry.owner', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload.method);
    return Response.json(rpcResponse(payload));
  });
  const result = await resolveSNS(parseDomainInput('active.sns'), 'https://rpc.example', new AbortController().signal);
  assert.equal(result.url, 'https://website.example/base/');
  assert.ok(calls.includes('getTokenLargestAccounts'));
});

test('Holder-query HTTP 429 on an active NFT stays a method-specific error, with no unsafe owner fallback', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    return payload.method === 'getTokenLargestAccounts' ? new Response('Rate limited', { status: 429 }) : Response.json(rpcResponse(payload));
  });
  await assert.rejects(resolveSNS(parseDomainInput('active.sns'), 'https://rpc.example/private-api-key', new AbortController().signal), e => {
    assert.equal(e.code, 'RPC_HTTP');
    assert.equal(e.info.method, 'getTokenLargestAccounts');
    assert.equal(e.info.httpStatus, 429);
    assert.equal(e.info.endpointHost, 'rpc.example');
    assert.doesNotMatch(JSON.stringify(e), /private-api-key/);
    return true;
  });
});

test('Transport, HTTP auth, malformed response and JSON-RPC method errors remain distinct', async t => {
  for (const [fixture, code] of [[() => { throw new TypeError('Failed to fetch'); }, 'RPC_NETWORK'], [() => new Response('Forbidden', { status: 403 }), 'RPC_HTTP'], [() => new Response('<html>not an RPC</html>'), 'RPC_INVALID_RESPONSE'], [payload => Response.json({ jsonrpc: '2.0', id: payload.id, error: { code: -32601, message: 'Method not found' } }), 'RPC_METHOD']]) {
    const mocked = t.mock.method(globalThis, 'fetch', async (url, options) => fixture(JSON.parse(options.body)));
    await assert.rejects(resolveSNS(parseDomainInput('website.sns'), 'https://rpc.example', new AbortController().signal), error => error.code === code);
    mocked.mock.restore();
  }
});

test('Active NFT JSON-RPC invalid-params error cannot be mistaken for an unminted name', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    return Response.json(payload.method === 'getTokenLargestAccounts'
      ? { jsonrpc: '2.0', id: payload.id, error: { code: -32602, message: 'could not find mint' } }
      : rpcResponse(payload));
  });
  await assert.rejects(resolveSNS(parseDomainInput('active.sns'), 'https://rpc.example', new AbortController().signal), error => error.code === 'RPC_METHOD' && error.info.rpcCode === -32602);
});

test('Missing NFT token account cannot silently fall back to registry.owner', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    const response = rpcResponse(payload);
    if (payload.method === 'getAccountInfo' && payload.params[0] === tokenAccountKey.toBase58()) response.result.value = null;
    return Response.json(response);
  });
  await assert.rejects(resolveSNS(parseDomainInput('active.sns'), 'https://rpc.example', new AbortController().signal), error => error.code === 'SNS_NFT_OWNER_INVALID');
});

test('A live-shaped unverified URL record reaches manual confirmation, not an RPC/staleness error', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => Response.json(rpcResponse(JSON.parse(options.body))));
  await assert.rejects(resolveSNS(parseDomainInput('unverified.sns/docs'), 'https://rpc.example', new AbortController().signal), error => error.code === 'SNS_ROA_UNVERIFIED' && error.info.candidateURL === 'https://website.example/base/docs');
});
