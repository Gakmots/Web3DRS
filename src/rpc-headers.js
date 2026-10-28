import { ResolutionError } from './errors.js';

export const RPC_HEADER_RULE_FIRST = 2000;
export const RPC_HEADER_RULE_LIMIT = 128;
export const RPC_REMOVED_HEADERS = Object.freeze([
  'origin', 'referer', 'cookie', 'solana-client', 'x-client-data',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user', 'sec-fetch-storage-access',
]);
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeRPCHeaderRule(raw, extensionID, id) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || !extensionID) throw new Error('RPC 请求保护只支持 HTTPS 地址。');
  return {
    id, priority: 1000,
    action: { type: 'modifyHeaders', requestHeaders: RPC_REMOVED_HEADERS.map(header => ({ header, operation: 'remove' })) },
    condition: {
      // Match the exact endpoint path, regardless of API-key query parameters.
      // URL canonicalization makes this ASCII. Never match a hostname substring.
      regexFilter: `^${escapeRE(url.origin + url.pathname)}(?:\\?[^#]*)?$`,
      isUrlFilterCaseSensitive: true,
      initiatorDomains: [extensionID], resourceTypes: ['xmlhttprequest'], requestMethods: ['post', 'options'],
    },
  };
}

export function stripRPCHeaders(input) {
  const headers = new Headers(input);
  for (const name of RPC_REMOVED_HEADERS) headers.delete(name);
  // Do not allow an application-added header to accidentally disclose a page
  // or worker URL either. Ordinary authentication headers remain untouched.
  for (const [name, value] of [...headers]) if (/chrome-extension:\/\//i.test(value)) headers.delete(name);
  return headers;
}

export async function ensureRPCHeaderPolicy(rpc) {
  if (!globalThis.chrome?.runtime?.id) {
    // The same source is also exercised by Node SDK tests; Node fetch does not
    // automatically attach a browser Origin. A browser without our runtime
    // must fail closed instead of silently sending an unprotected request.
    if (typeof process !== 'undefined' && process.versions?.node) return;
    throw new ResolutionError('RPC_HEADER_POLICY', 'RPC 请求保护未就绪，已停止发送。请重新加载扩展。');
  }
  let result;
  try { result = await chrome.runtime.sendMessage({ type: 'PREPARE_RPC', rpc }); }
  catch { /* A reloaded extension invalidates old tabs. Do not send from them. */ }
  if (!result?.ok) throw new ResolutionError('RPC_HEADER_POLICY', '无法启用 RPC 来源头移除规则，已停止发送。请重新加载扩展或重新授权 RPC 主机。', { stage: 'RPC 请求保护', detail: result?.error });
}
