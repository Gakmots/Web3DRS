import { ResolutionError } from './errors.js';
import { MAINNET_GENESIS } from './rpc-config.js';
import { ensureRPCHeaderPolicy, stripRPCHeaders } from './rpc-headers.js';

export function createRPCTransport(rpc, signal) {
  const endpointHost = new URL(rpc).hostname;
  let failure;
  const rpcFetch = async (url, options) => {
    signal.throwIfAborted();
    const method = JSON.parse(options.body).method;
    const info = { stage: 'Solana RPC', method, endpointHost };
    try { await ensureRPCHeaderPolicy(rpc); }
    catch (error) { failure = error; throw error; }
    signal.throwIfAborted();
    let response;
    try { response = await fetch(url, { ...options, headers: stripRPCHeaders(options.headers), signal, credentials: 'omit', referrer: '', referrerPolicy: 'no-referrer', redirect: 'error' }); }
    catch {
      if (signal.aborted) throw signal.reason;
      failure = new ResolutionError('RPC_NETWORK', '无法连接 Solana RPC。请检查网络、扩展访问权限，并使用无需跳转的 RPC 地址。', info);
      throw failure;
    }
    if (!response.ok) {
      const message = response.status === 429 ? `RPC 对 ${method} 请求限流（HTTP 429），不代表整个 RPC 地址不可用。`
        : [401, 403].includes(response.status) ? `RPC 拒绝访问（HTTP ${response.status}）。请检查 API Key 或服务商的来源限制。`
        : `RPC 返回 HTTP ${response.status}，请求方法为 ${method}。`;
      failure = new ResolutionError('RPC_HTTP', message, { ...info, httpStatus: response.status });
      throw failure;
    }
    let body;
    try { body = await response.clone().json(); }
    catch { /* Handle JSON and schema errors together below. */ }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('result' in body || 'error' in body)) {
      failure = new ResolutionError('RPC_INVALID_RESPONSE', '此地址未返回有效的 JSON-RPC 响应，请确认填写的是 RPC endpoint。', info);
      throw failure;
    }
    if (body.error) failure = new ResolutionError('RPC_METHOD', `RPC 方法 ${method} 返回错误（${body.error.code}）。`, { ...info, rpcCode: body.error.code, detail: body.error.message });
    // Return protocol errors for the SDK's numeric-code handling. The caller
    // can recover this typed error if web3.js wraps it into a plain Error.
    return response;
  };
  return {
    fetch: rpcFetch,
    get failure() { return failure; },
    async call(method, params = []) {
      const response = await rpcFetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await response.json();
      if (body.error) throw failure;
      return body.result;
    },
  };
}

// Run in the popup's actual extension context after obtaining host permission.
// A saved URL is not considered usable merely because it parses as HTTPS.
export async function probeRPC(rpc, signal) {
  const transport = createRPCTransport(rpc, signal);
  const genesis = await transport.call('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new ResolutionError('RPC_WRONG_CLUSTER', '该 RPC 不是 Solana 主网，未保存。SNS 域名需要主网数据。', { stage: 'RPC 主网验证', endpointHost: new URL(rpc).hostname });
  const params = { encoding: 'base64', commitment: 'confirmed' };
  const system = '11111111111111111111111111111111';
  const account = await transport.call('getAccountInfo', [system, params]);
  const accounts = await transport.call('getMultipleAccounts', [[system], params]);
  if (!account?.value || !Array.isArray(accounts?.value) || !accounts.value[0]) throw new ResolutionError('RPC_INVALID_RESPONSE', 'RPC 未返回预期的主网账户数据，未保存。', { stage: 'RPC 账户读取验证' });
  return { endpointHost: new URL(rpc).hostname, cluster: 'mainnet' };
}
