import { makeRPCHeaderRule, RPC_HEADER_RULE_FIRST, RPC_HEADER_RULE_LIMIT } from './rpc-headers.js';

// Called only by the background worker after verifying the message sender.
// Serialize installs so simultaneous popup probes and resolver requests cannot
// overwrite each other's rules. Session rules survive worker suspension.
export function createRPCPolicyInstaller(api) {
  let queue = Promise.resolve();
  return function prepareRPC(rpc) {
    const task = queue.catch(() => {}).then(async () => {
      const url = new URL(rpc);
      // Chrome host permissions cover all ports; the rule itself still
      // matches the exact origin (including a port) and endpoint path.
      if (!await api.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) throw new Error('RPC 主机访问权限未授予。');
      const rules = await api.declarativeNetRequest.getSessionRules();
      const scoped = makeRPCHeaderRule(rpc, api.runtime.id, RPC_HEADER_RULE_FIRST);
      const owned = rules.filter(rule => rule.id >= RPC_HEADER_RULE_FIRST && rule.id < RPC_HEADER_RULE_FIRST + RPC_HEADER_RULE_LIMIT);
      const existing = owned.find(rule => rule.condition.regexFilter === scoped.condition.regexFilter);
      const occupied = new Set(rules.map(rule => rule.id));
      const id = existing?.id ?? Array.from({ length: RPC_HEADER_RULE_LIMIT }, (_, i) => RPC_HEADER_RULE_FIRST + i).find(id => !occupied.has(id));
      if (id === undefined) throw new Error('本次会话已验证过多 RPC 地址，请重启浏览器后重试。');
      scoped.id = id;
      const check = await api.declarativeNetRequest.isRegexSupported({ regex: scoped.condition.regexFilter, isCaseSensitive: true, requireCapturing: false });
      if (!check.isSupported) throw new Error('此 RPC 地址过长或不受请求保护规则支持。');
      // Reinstall atomically on every handshake: never trust a stale page cache.
      await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [scoped] });
    });
    queue = task;
    return task;
  };
}
