import { parseNavigation, googleSearchURL, ethTarget, normalizedSettings, DEFAULT_RPC, isGoogleSearch, safeHTTPS } from './core.js';
import { errorPresentation } from './errors.js';

const $ = selector => document.querySelector(selector);
const raw = location.hash.slice(1); // Do NOT decode this: it contains an entire URL.
const request = parseNavigation(raw);
let attempt = null;
let target = null;

function showError(message, detail = '') {
  $('#state').textContent = '暂时无法打开';
  $('#message').textContent = message;
  document.body.dataset.state = 'error';
  $('#retry').hidden = !request;
  $('#spinner').hidden = true;
  $('#diagnostics').hidden = !detail;
  $('#error-detail').textContent = detail;
}

function searchURL() {
  return googleSearchURL(request?.name || '', request?.source === 'google' ? request.original : undefined);
}

$('#search').addEventListener('click', () => {
  attempt?.abort();
  location.replace(searchURL());
});
$('#retry').addEventListener('click', () => run());
$('#open').addEventListener('click', () => { if (target) location.replace(target); });

async function run() {
  attempt?.abort();
  const controller = new AbortController();
  attempt = controller;
  target = null;
  document.body.dataset.state = 'loading';
  $('#retry').hidden = true;
  $('#open').hidden = true;
  $('#open').textContent = '打开目标网站 ↗';
  $('#spinner').hidden = false;
  $('#state').textContent = '正在解析网站';
  $('#message').textContent = request.tld === 'eth' ? '即将通过 ENS 网关打开。' : '正在读取并验证 Solana 网站记录。';
  $('#destination').textContent = '';
  $('#record').textContent = '';
  $('#diagnostics').hidden = true;
  $('#error-detail').textContent = '';
  const timer = setTimeout(() => controller.abort(new DOMException('解析超时，请稍后重试或更换 Solana RPC。', 'TimeoutError')), 16000);
  try {
    const { settings: stored } = await chrome.storage.local.get('settings');
    const settings = normalizedSettings(stored);
    if (!settings.enabled || (request.source === 'google' && !settings.google)) {
      if (request.source === 'google') { location.replace(searchURL()); return; }
      throw new Error('插件已暂停。请在工具栏中启用后重试。');
    }
    let result;
    if (request.tld === 'eth') result = { url: ethTarget(request), record: 'ENS → eth.limo' };
    else {
      if (settings.rpc !== DEFAULT_RPC) {
        const origin = `${new URL(settings.rpc).origin}/*`;
        if (!(await chrome.permissions.contains({ origins: [origin] }))) throw new Error('自定义 RPC 的访问权限未授权，请在插件设置中重新保存。');
      }
      const { resolveSNS } = await import('./sns.js');
      result = await resolveSNS(request, settings.rpc, controller.signal);
    }
    controller.signal.throwIfAborted();
    target = result.url;
    $('#destination').textContent = target;
    $('#record').textContent = result.record;
    $('#state').textContent = '解析成功，正在打开';
    $('#message').textContent = '跳转后，地址栏将显示目标网站或 HTTPS 网关地址。';
    $('#spinner').hidden = true;
    $('#open').hidden = false;
    document.body.dataset.state = 'success';
    // No delayed callback: abandoning/retrying a page cannot fire a stale redirect.
    location.replace(target);
  } catch (error) {
    if (attempt !== controller) return;
    if (controller.signal.aborted && controller.signal.reason?.name === 'AbortError') return;
    const presented = errorPresentation(controller.signal.reason?.name === 'TimeoutError' ? controller.signal.reason : error);
    showError(presented.message, presented.detail);
    if (error.code === 'SNS_ROA_UNVERIFIED' && error.info?.candidateURL) {
      target = safeHTTPS(error.info.candidateURL).href;
      $('#destination').textContent = target;
      $('#record').textContent = '持有者验证通过 · 网站关联认证未通过';
      $('#open').textContent = '核对后打开此网站 ↗';
      $('#open').hidden = false;
    }
  } finally { clearTimeout(timer); }
}

if (window.top !== window.self) {
  showError('请在独立标签页中打开。');
  $('#search').hidden = true;
} else if (!request) {
  // The regex is a prefilter. Decoded inputs can still be invalid, such as an
  // encoded space or a repeated q parameter. Bypass on the original URL once.
  let original;
  try { original = new URL(raw); } catch { /* Render the local error. */ }
  if (original && isGoogleSearch(original)) location.replace(googleSearchURL('', original.href));
  else { showError('请输入完整的 .eth 或 .sns 域名。'); $('#search').hidden = true; }
} else {
  $('#domain').textContent = request.name;
  $('#suffix').textContent = `.${request.tld}`;
  $('#suffix').dataset.tld = request.tld;
  $('#source').textContent = request.source === 'google' ? '来自 Google · 完整域名查询' : '来自网页导航';
  run();
}

window.addEventListener('pagehide', () => attempt?.abort());
