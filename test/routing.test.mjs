import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDomainInput, parseNavigation, googleSearchURL, ethTarget, appendRequest, safeHTTPS, normalizedSettings, DEFAULT_RPC } from '../src/core.js';
import { GOOGLE_REGEX, DIRECT_REGEX, BYPASS_REGEX, makeRules } from '../src/rules.js';

const google = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
test('Google: exact names, encoded separators, Unicode, reordered parameters and regional hosts', () => {
  for (const query of ['alice.eth', 'ALICE.ETH', 'sub.alice.eth', 'alice.sns', 'alice.eth/docs?x=1&y=2#read', 'https://alice.eth/a', '测试.eth', '💩.eth']) {
    const url = google(query);
    assert.match(url, new RegExp(GOOGLE_REGEX, 'i'), query);
    assert.ok(parseNavigation(url), query);
  }
  assert.ok(parseNavigation('https://www.google.co.jp/search?client=chrome&q=alice%2Eeth&sourceid=chrome'));
  assert.match('https://www.google.com/search?client=chrome&q=alice%2Eeth&sourceid=chrome', new RegExp(GOOGLE_REGEX, 'i'));
});

test('Ordinary searches, quotes, unrelated engines and spoofed Google hosts stay searches', () => {
  for (const query of ['alice.eth 是什么', 'buy alice.sns', '"alice.eth"', 'site:alice.eth', 'alice.eth.evil.com', 'alice.eth@evil.com', ' alice.eth', 'alice.eth ']) assert.equal(parseNavigation(google(query)), null, query);
  for (const url of ['https://google.com.evil.test/search?q=alice.eth', 'https://mail.google.com/search?q=alice.eth', 'https://www.google.com/complete/search?q=alice.eth', 'https://bing.com/search?q=alice.eth', 'https://www.google.com/search?q=alice.eth&q=bob.eth']) assert.equal(parseNavigation(url), null, url);
  assert.doesNotMatch(google('alice.eth 是什么'), new RegExp(GOOGLE_REGEX, 'i'));
  assert.doesNotMatch(google('buy alice.sns'), new RegExp(GOOGLE_REGEX, 'i'));
});

test('Escaped invalid query is rejected after DNR prefilter; search bypass cannot loop', () => {
  const invalid = 'https://www.google.com/search?q=%ff.eth';
  assert.match(invalid, new RegExp(GOOGLE_REGEX, 'i'));
  assert.equal(parseNavigation(invalid), null);
  const url = googleSearchURL('alice.eth', google('alice.eth'));
  assert.match(url, new RegExp(BYPASS_REGEX, 'i'));
  assert.equal(parseNavigation(url), null);
  const rules = makeRules('chrome-extension://test/resolve.html', { enabled: true, google: true });
  const matching = rules.filter(rule => new RegExp(rule.condition.regexFilter, 'i').test(url)).sort((a,b) => b.priority-a.priority);
  assert.equal(matching[0].action.type, 'allow');
});

test('Direct navigations preserve path, query and fragment through ENS gateway conversion', () => {
  const raw = 'https://sub.alice.eth/docs/a%20b?x=1&y=%26#part2';
  assert.match(raw, new RegExp(DIRECT_REGEX, 'i'));
  assert.equal(ethTarget(parseNavigation(raw)), 'https://sub.alice.eth.limo/docs/a%20b?x=1&y=%26#part2');
  assert.equal(parseDomainInput('xn--ls8h.eth').name, '💩.eth');
  assert.equal(parseDomainInput('alice.eth.evil.test'), null);
});

test('Reject credentials, ports, alternative schemes, invalid labels and control characters', () => {
  for (const input of ['https://alice.eth:8443/', 'https://me:secret@alice.eth/', 'javascript:alice.eth', 'file://alice.eth', 'a..eth', 'bad name.sns', 'alice.eth\\evil', 'alice.eth\n']) assert.equal(parseDomainInput(input), null, input);
});

test('Target validation rejects executable/local targets and resolver loops', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://name.local', 'https://u:p@example.com', 'https://alice.eth', 'https://alice.sns', google('alice.sns')]) assert.throws(() => safeHTTPS(input), undefined, input);
});

test('Record base paths remain intact and double slash cannot change the origin', () => {
  const request = parseDomainInput('alice.sns//evil.test/docs?x=1#part');
  assert.equal(appendRequest('https://example.com/base/', request), 'https://example.com/base/evil.test/docs?x=1#part');
  assert.equal(appendRequest('https://example.com/base/?default=1#start', parseDomainInput('alice.sns')), 'https://example.com/base/?default=1#start');
});

test('Settings pause rules without touching search settings; Google toggle retains direct rules', () => {
  assert.deepEqual(makeRules('chrome-extension://test/resolve.html', { enabled: false, google: true }), []);
  assert.deepEqual(makeRules('chrome-extension://test/resolve.html', { enabled: true, google: false }).map(r => r.id), [1]);
  assert.equal(normalizedSettings({ rpc: 'javascript:evil' }).rpc, DEFAULT_RPC);
});
