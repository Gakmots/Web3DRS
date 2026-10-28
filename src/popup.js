import { DEFAULT_RPC, normalizedSettings, parseDomainInput, safeHTTPS } from './core.js';
import { probeRPC } from './rpc.js';
import { errorPresentation } from './errors.js';

const $ = selector => document.querySelector(selector);
let settings;
function status(text, error = false) {
  $('#status').textContent = text;
  $('#status').dataset.error = String(error);
}

async function save(next) {
  settings = next;
  await chrome.storage.local.set({ settings });
  const result = await chrome.runtime.sendMessage({ type: 'SYNC_RULES' });
  if (!result?.ok) throw new Error(result?.error || '无法更新规则，请重新加载插件。');
  status(settings.enabled ? '已启用 · 无需更改搜索引擎' : '已暂停 · 可随时恢复');
}

function toggle(id, key) {
  $(id).addEventListener('change', async event => {
    const element = event.target;
    element.disabled = true;
    try { await save({ ...settings, [key]: element.checked }); }
    catch (error) { status(error.message, true); }
    finally { element.disabled = false; }
  });
}
toggle('#enabled', 'enabled');
toggle('#google', 'google');

$('#lookup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const parsed = parseDomainInput($('#lookup').value.trim());
  if (!parsed) { status('请输入 .eth / .sns 域名，可附带路径。', true); return; }
  await chrome.tabs.create({ url: `${chrome.runtime.getURL('resolve.html')}#${parsed.url}` });
  window.close();
});

async function saveRPC(raw) {
  const button = $('#save-rpc');
  button.disabled = true;
  $('#reset-rpc').disabled = true;
  try {
    const rpc = safeHTTPS(raw.trim() || DEFAULT_RPC).href.replace(/\/$/, '');
    if (rpc !== DEFAULT_RPC) {
      // Permission request stays in this user gesture. Only this origin is granted.
      const granted = await chrome.permissions.request({ origins: [`${new URL(rpc).origin}/*`] });
      if (!granted) throw new Error('未获得此 RPC 的访问权限。');
    }
    status('正在验证 RPC 主网与账户读取能力…');
    await probeRPC(rpc, AbortSignal.timeout(12000));
    await save({ ...settings, rpc });
    await chrome.storage.local.remove('rpcMigrationNotice');
    $('#rpc').value = rpc;
    status('主网与账户读取验证通过，RPC 已保存。');
  } catch (error) { status(`未保存：${errorPresentation(error).message}`, true); }
  finally { button.disabled = false; $('#reset-rpc').disabled = false; }
}

$('#rpc-form').addEventListener('submit', event => {
  event.preventDefault();
  saveRPC($('#rpc').value);
});
$('#reset-rpc').addEventListener('click', () => saveRPC(DEFAULT_RPC));

try {
  const { settings: stored, ruleError, rpcMigrationNotice } = await chrome.storage.local.get(['settings', 'ruleError', 'rpcMigrationNotice']);
  settings = normalizedSettings(stored);
  $('#enabled').checked = settings.enabled;
  $('#google').checked = settings.google;
  $('#rpc').value = settings.rpc;
  status(ruleError || rpcMigrationNotice || (settings.enabled ? '已启用 · 无需更改搜索引擎' : '已暂停 · 可随时恢复'), Boolean(ruleError));
} catch (error) { status(error.message, true); }
