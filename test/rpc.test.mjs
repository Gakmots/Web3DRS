import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRPC, createRPCTransport } from '../src/rpc.js';
import { DEFAULT_RPC, MAINNET_GENESIS } from '../src/rpc-config.js';

const response = payload => {
  if (payload.method === 'getGenesisHash') return { jsonrpc: '2.0', id: 1, result: MAINNET_GENESIS };
  if (payload.method === 'getAccountInfo') return { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { data: ['', 'base64'] } } };
  return { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [{ data: ['', 'base64'] }] } };
};

test('RPC validation checks mainnet and both account methods before allowing save', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload.method);
    return Response.json(response(payload));
  });
  const result = await probeRPC(DEFAULT_RPC, AbortSignal.timeout(1000));
  assert.equal(result.cluster, 'mainnet');
  assert.deepEqual(calls, ['getGenesisHash', 'getAccountInfo', 'getMultipleAccounts']);
});

test('A browser-origin 403 is distinguished from wrong cluster and disabled account methods', async t => {
  let mock = t.mock.method(globalThis, 'fetch', async () => new Response('Access forbidden', { status: 403 }));
  await assert.rejects(probeRPC('https://api.mainnet.solana.com', AbortSignal.timeout(1000)), error => error.code === 'RPC_HTTP' && error.info.httpStatus === 403);
  mock.mock.restore();
  mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ result: 'devnet-genesis' }));
  await assert.rejects(probeRPC(DEFAULT_RPC, AbortSignal.timeout(1000)), error => error.code === 'RPC_WRONG_CLUSTER');
  mock.mock.restore();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const payload = JSON.parse(options.body);
    return Response.json(payload.method === 'getMultipleAccounts' ? { error: { code: -32601, message: 'Method disabled' } } : response(payload));
  });
  await assert.rejects(probeRPC(DEFAULT_RPC, AbortSignal.timeout(1000)), error => error.code === 'RPC_METHOD' && error.info.method === 'getMultipleAccounts');
});

test('Transport rejects JSON endpoints that are not RPCs', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ healthy: true }));
  await assert.rejects(createRPCTransport(DEFAULT_RPC, AbortSignal.timeout(1000)).call('getGenesisHash'), error => error.code === 'RPC_INVALID_RESPONSE');
});
