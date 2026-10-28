import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { rpcResponse } from '../test/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, 'test-results');
await mkdir(path.join(resultsDir, 'tmp'), { recursive: true });
process.env.TMPDIR = path.join(resultsDir, 'tmp');
const profile = path.join(resultsDir, 'browser-profile');
await rm(profile, { recursive: true, force: true });
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_PATH || undefined,
  channel: process.env.CHROME_PATH ? undefined : 'chromium',
  headless: true, viewport: { width: 1100, height: 780 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const report = [];
async function check(name, fn) {
  await fn(); report.push(name); console.log(`PASS ${name}`);
}

const observed = [];
await context.route('https://solana-rpc.publicnode.com/**', async route => {
  const payload = route.request().postDataJSON();
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rpcResponse(payload)) });
});
await context.route(/https?:\/\/(?:www\.)?google\.[^/]+\//, route => { observed.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: '<title>Google fixture</title><h1>Google fixture</h1>' }); });
await context.route(/https:\/\/[^/]+\.eth\.limo\//, route => route.fulfill({ contentType: 'text/html', body: '<title>ENS gateway fixture</title><h1>ENS website</h1>' }));
await context.route('https://website.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>SNS fixture</title><h1>SNS website</h1>' }));

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionID = new URL(worker.url()).host;
  const extensionURL = file => `chrome-extension://${extensionID}/${file}`;
  const page = await context.newPage();
  await check('Manifest loads; every redirect regex compiles in Chrome RE2', async () => {
    await page.goto(extensionURL('popup.html'));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SYNC_RULES' }));
    const state = await worker.evaluate(async () => {
      return { ...(await chrome.storage.local.get('ruleError')), rules: await chrome.declarativeNetRequest.getDynamicRules() };
    });
    assert.equal(state.ruleError, undefined);
    assert.equal(state.rules.length, 3);
  });
  async function navigate(url, target) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(error => {
      if (!/interrupted|ERR_ABORTED/.test(error.message)) throw error;
    });
    await page.waitForURL(target, { timeout: 12000 });
    await page.waitForLoadState('domcontentloaded');
  }
  await check('Google naked ENS query redirects before the Google request is sent', async () => {
    observed.length = 0;
    await navigate('https://www.google.com/search?client=chrome&q=alice.eth&sourceid=chrome', 'https://alice.eth.limo/');
    assert.equal(observed.length, 0);
    assert.equal(await page.title(), 'ENS gateway fixture');
  });
  await check('Direct navigation preserves path, query, percent escapes and fragment', async () => {
    await navigate('https://alice.eth/docs/a%20b?x=1&y=%26#part2', 'https://alice.eth.limo/docs/a%20b?x=1&y=%26#part2');
  });
  await check('Google URL-encoded path/query/fragment and Unicode ENS are preserved', async () => {
    await navigate(`https://www.google.co.jp/search?q=${encodeURIComponent('alice.eth/docs?x=1&y=2#part')}`, 'https://alice.eth.limo/docs?x=1&y=2#part');
    await navigate(`https://www.google.com/search?q=${encodeURIComponent('💩.eth')}`, 'https://xn--ls8h.eth.limo/');
  });
  await check('Ordinary and quoted searches remain on Google', async () => {
    for (const q of ['buy alice.sns', 'alice.eth 是什么', '"alice.eth"']) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      await navigate(url, url);
      assert.equal(await page.title(), 'Google fixture');
    }
  });
  await check('Malformed percent escapes pass through once without a redirect loop', async () => {
    await navigate('https://www.google.com/search?q=%FF.eth', /google\.com\/search\?.*w3r=off/);
    assert.equal(await page.title(), 'Google fixture');
  });
  await check('SNS website record resolves through real bundled SDK and validated RPC fixture', async () => {
    await navigate('https://www.google.com/search?q=website.sns%2Fdocs%3Fx%3D1%23part', 'https://website.example/base/docs?x=1#part');
    assert.equal(await page.title(), 'SNS fixture');
  });
  await check('Unverified website association exposes a manual target and never auto-navigates', async () => {
    await navigate('https://www.google.com/search?q=unverified.sns', /chrome-extension:\/\/.*\/resolve.html/);
    await page.waitForFunction(() => document.body.dataset.state === 'error');
    assert.match(await page.locator('#message').textContent(), /关联认证未通过/);
    assert.equal(await page.locator('#destination').textContent(), 'https://website.example/base/');
    await page.locator('#open').click();
    await page.waitForURL('https://website.example/base/');
  });
  for (const [name, text] of [['stale', '未通过'], ['empty', '没有配置'], ['unsafe', '无法打开'], ['missing', '未找到']]) {
    await check(`SNS ${name} record shows an error instead of navigating`, async () => {
      await navigate(`https://www.google.com/search?q=${name}.sns`, /chrome-extension:\/\/.*\/resolve.html/);
      await page.waitForFunction(() => document.body.dataset.state === 'error', { timeout: 10000 });
      assert.match(await page.locator('#message').textContent(), new RegExp(text));
    });
  }
  await page.screenshot({ path: path.join(resultsDir, 'resolver-error.png'), fullPage: true });
  await check('Explicit search fallback is allowed without disabling the extension', async () => {
    await page.locator('#search').click();
    await page.waitForURL(/google\.com\/search\?.*w3r=off/);
    assert.equal(await page.title(), 'Google fixture');
  });
  await check('Popup toggles Google interception off and on while direct rules remain', async () => {
    await page.goto(extensionURL('popup.html'));
    await page.locator('#status').filter({ hasText: '已启用' }).waitFor();
    await page.screenshot({ path: path.join(resultsDir, 'popup.png') });
    await page.locator('#google').uncheck({ force: true });
    await page.waitForFunction(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length === 1);
    const url = 'https://www.google.com/search?q=alice.eth';
    await navigate(url, url);
    await navigate('https://alice.eth/', 'https://alice.eth.limo/');
    await page.goto(extensionURL('popup.html'));
    await page.locator('#google').check({ force: true });
    await page.waitForFunction(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length === 3);
  });
  assert.deepEqual(errors, [], 'Uncaught page errors');
  const summary = { browser: await context.browser().version(), passed: report, pageErrors: errors, rpc: 'deterministic protocol-shaped fixtures; not live mainnet' };
  await writeFile(path.join(resultsDir, 'browser-results.json'), JSON.stringify(summary, null, 2));
  console.log(`Browser checks passed: ${report.length}`);
} finally { await context.close(); }
