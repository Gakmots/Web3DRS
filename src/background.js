import { normalizedSettings } from './core.js';
import { makeRules, RULE_IDS } from './rules.js';
import { createRPCPolicyInstaller } from './rpc-policy.js';

const prepareRPC = createRPCPolicyInstaller(chrome);

// Serialize rule mutations, including a quick succession of popup switches.
let queue = Promise.resolve();
function updateRules() {
  queue = queue.catch(() => {}).then(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const rules = makeRules(chrome.runtime.getURL('resolve.html'), normalizedSettings(settings));
    for (const rule of rules) {
      const check = await chrome.declarativeNetRequest.isRegexSupported({ regex: rule.condition.regexFilter, isCaseSensitive: false, requireCapturing: rule.action.type === 'redirect' });
      if (!check.isSupported) throw new Error(`规则 ${rule.id} 不受此浏览器支持：${check.reason}`);
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: RULE_IDS, addRules: rules });
    await chrome.storage.local.remove('ruleError');
  }).catch(async error => {
    console.error('Rule installation failed', error);
    await chrome.storage.local.set({ ruleError: String(error.message) });
  });
  return queue;
}

chrome.runtime.onInstalled.addListener(async () => {
  // 0.1.3 preserves the selected provider; compatibility is handled by scoped
  // request-header removal instead of replacing a user's endpoint.
  await chrome.storage.local.remove('rpcMigrationNotice');
  await updateRules();
});
chrome.runtime.onStartup.addListener(updateRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) updateRules();
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'PREPARE_RPC') {
    let allowed = false;
    try { const url = new URL(sender.url); allowed = url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && ['/popup.html', '/resolve.html'].includes(url.pathname); }
    catch { /* Reject malformed or missing sender URLs. */ }
    if (!allowed) { respond({ ok: false, error: '请求来源不受支持。' }); return; }
    prepareRPC(message.rpc).then(() => respond({ ok: true }), () => respond({ ok: false, error: 'RPC 主机未授权或请求保护规则安装失败。' }));
    return true;
  }
  if (message?.type !== 'SYNC_RULES') return;
  updateRules().then(async () => {
    const { ruleError } = await chrome.storage.local.get('ruleError');
    respond({ ok: !ruleError, error: ruleError });
  });
  return true;
});
