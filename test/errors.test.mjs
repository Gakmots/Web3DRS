import test from 'node:test';
import assert from 'node:assert/strict';
import { errorPresentation, redactDiagnostic, ResolutionError } from '../src/errors.js';

test('JS chunk fetch failures are packaging errors, not RPC failures', () => {
  const result = errorPresentation(new TypeError('Failed to fetch dynamically imported module: chrome-extension://abc/chunks/sns.js'));
  assert.match(result.message, /解析组件加载失败/);
  assert.doesNotMatch(result.message, /RPC/);
});

test('Domain/record errors are not masked by broad "failed to get" keyword matching', () => {
  const missing = new Error('The name account does not exist'); missing.type = 'AccountDoesNotExist';
  assert.match(errorPresentation(missing).message, /未找到这个 SNS 域名/);
  for (const message of ['网站记录未通过当前域名持有者验证', '此域名没有配置可用的网站记录', 'failed to get unknown SDK structure']) assert.equal(errorPresentation(new Error(message)).message, message);
});

test('Diagnostic details expose the method/status while redacting credentials', () => {
  const result = errorPresentation(new ResolutionError('RPC_METHOD', 'RPC 方法返回错误', { method: 'getMultipleAccounts', rpcCode: -32601, endpointHost: 'rpc.example', detail: 'Failed at https://rpc.example/private-key?api-key=secret token=abc' }));
  assert.match(result.detail, /getMultipleAccounts/);
  assert.match(result.detail, /-32601/);
  assert.doesNotMatch(result.detail, /private-key|secret|abc/);
  assert.doesNotMatch(redactDiagnostic('api_key=MYSECRET'), /MYSECRET/);
});
