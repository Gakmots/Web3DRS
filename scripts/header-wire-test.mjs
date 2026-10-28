// Real receiving-server test. No third-party echo service or live RPC needed.
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { RPC_REMOVED_HEADERS } from '../src/rpc-headers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'test-results', 'header-wire');
await mkdir(path.join(work, 'tmp'), { recursive: true });
process.env.TMPDIR = path.join(work, 'tmp');
const key = path.join(work, 'test.key');
const cert = path.join(work, 'test.crt');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=rpc-header-test.example', '-addext', 'subjectAltName=DNS:rpc-header-test.example'], { stdio: 'ignore' });
const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
  req.resume();
  if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Ordinary website</title>'); return; }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { headers: req.headers, path: req.url } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `https://rpc-header-test.example:${server.address().port}`;
const extension = path.join(work, 'extension');
await rm(extension, { recursive: true, force: true });
await cp(path.join(root, 'extension'), extension, { recursive: true });
const manifestPath = path.join(extension, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions.push('https://rpc-header-test.example/*');
await writeFile(manifestPath, JSON.stringify(manifest));
let context;
try {
  context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    executablePath: process.env.CHROME_PATH || undefined, channel: process.env.CHROME_PATH ? undefined : 'chromium', headless: true,
    ignoreHTTPSErrors: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP rpc-header-test.example 127.0.0.1', '--no-proxy-server', '--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const echo = (url, prepared) => page.evaluate(async ({ url, prepared }) => {
    if (prepared) {
      const ack = await chrome.runtime.sendMessage({ type: 'PREPARE_RPC', rpc: url });
      if (!ack.ok) throw new Error(ack.error);
    }
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'solana-client': 'test-sdk' }, body: '{"jsonrpc":"2.0","id":1,"method":"test"}', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    return (await response.json()).result.headers;
  }, { url, prepared });
  const control = await echo(`${origin}/control`, false);
  assert.equal(control.origin, `chrome-extension://${id}`, 'Control establishes that Chrome would ordinarily send an extension Origin');
  const headers = await echo(`${origin}/rpc-a?key=test-only`, true);
  for (const name of RPC_REMOVED_HEADERS) assert.equal(headers[name], undefined, `Receiving server must not see ${name}`);
  assert.equal(headers['content-type'], 'application/json');
  await echo(`${origin}/rpc-b`, true);
  const again = await echo(`${origin}/rpc-a?key=changed`, true);
  assert.equal(again.origin, undefined);
  await page.goto(`${origin}/page`);
  const normal = await echo(`${origin}/rpc-a`, false);
  assert.equal(normal.origin, origin, 'Normal website Origin remains untouched');
  assert.equal(normal['solana-client'], 'test-sdk');
  const report = { browser: await context.browser().version(), passed: true, receivedHeaderNames: Object.keys(headers), normalWebsiteOriginPreserved: true };
  await writeFile(path.join(work, 'results.json'), JSON.stringify(report, null, 2));
  console.log('PASS receiving HTTPS server: extension source headers absent; normal website unaffected');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
