import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDomainInput } from '../src/core.js';
import { recordTarget, chooseRecord } from '../src/targets.js';
const request = parseDomainInput('alice.sns/docs?x=1#part');
const cid = 'QmYwAPJzv5CZsnAzt8auVZRnGiRAyxE6wfnEb7e5i9yBfR';
const entry = (record, deserializedContent, verified = { staleness: true }) => ({ record, deserializedContent, verified });

test('IPFS CIDv0 converts to an isolated, lowercase CIDv1 HTTPS origin', () => {
  const url = recordTarget('IPFS', `ipfs://${cid}/base/`, request);
  assert.match(url, /^https:\/\/b[a-z2-7]+\.ipfs\.dweb\.link\/base\/docs\?x=1#part$/);
  assert.throws(() => recordTarget('IPFS', 'ipfs://not-a-cid', request));
});
test('IPNS PeerID and Arweave records map to valid gateways', () => {
  assert.match(recordTarget('IPNS', `ipns://${cid}`, request), /^https:\/\/k[0-9a-z]+\.ipns\.dweb\.link\/docs/);
  assert.match(recordTarget('ARWV', 'a'.repeat(43), request), /^https:\/\/arweave.net\/a{43}\/docs/);
  assert.throws(() => recordTarget('ARWV', 'fake', request));
});
test('Verified website records follow priority; unsafe, stale and missing records never navigate', () => {
  const result = chooseRecord([entry('url', 'https://example.com'), entry('IPFS', cid)], request);
  assert.equal(result.record, 'IPFS');
  assert.throws(() => chooseRecord([undefined], request), /没有配置/);
  assert.throws(() => chooseRecord([entry('url', 'https://example.com', { staleness: false })], request), /未通过/);
  assert.throws(() => chooseRecord([entry('url', 'https://example.com', { staleness: true, roa: false })], request), /未通过/);
  assert.throws(() => chooseRecord([entry('url', 'javascript:alert(1)')], request));
});
test('A valid lower-priority record can rescue an unusable higher-priority record', () => {
  assert.equal(chooseRecord([entry('IPFS', 'bad'), entry('url', 'https://example.com/root', { staleness: true, roa: true })], request).url, 'https://example.com/root/docs?x=1#part');
});

test('A fresh URL without association verification is exposed only as a safe manual candidate', () => {
  assert.throws(() => chooseRecord([entry('url', 'https://www.sns.id/', { staleness: true, roa: false })], request), error => error.code === 'SNS_ROA_UNVERIFIED' && error.info.candidateURL === 'https://www.sns.id/docs?x=1#part');
  assert.throws(() => chooseRecord([entry('url', 'https://www.sns.id/', { staleness: false, roa: false })], request), error => !error.info?.candidateURL);
  assert.throws(() => chooseRecord([entry('url', 'javascript:alert(1)', { staleness: true, roa: false })], request), error => !error.info?.candidateURL);
});
