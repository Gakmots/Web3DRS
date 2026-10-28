import { CID } from 'multiformats/cid';
import { base32 } from 'multiformats/bases/base32';
import { base36 } from 'multiformats/bases/base36';
import { base58btc } from 'multiformats/bases/base58';
import { appendRequest, safeHTTPS } from './core.js';
import { ResolutionError } from './errors.js';

function parseCID(value) {
  return CID.parse(value, base32.decoder.or(base36.decoder).or(base58btc.decoder));
}

export function recordTarget(type, content, request) {
  if (typeof content !== 'string' || content.length > 4096) throw new Error('网站记录内容无效。');
  const value = content.trim().replace(/\0+$/g, '');
  let base;
  if (type === 'IPFS') {
    const cleaned = value.replace(/^ipfs:\/\/(?:ipfs\/)?/i, '').replace(/^\/ipfs\//i, '');
    const [id, ...parts] = cleaned.split('/');
    const cid = parseCID(id).toV1().toString(base32);
    base = `https://${cid}.ipfs.dweb.link/${parts.join('/')}`;
  } else if (type === 'IPNS') {
    const cleaned = value.replace(/^ipns:\/\//i, '').replace(/^\/ipns\//i, '');
    const [id, ...parts] = cleaned.split('/');
    // v0 PeerIDs use sha2-256 multihashes, encoded like CIDv0.
    const parsed = parseCID(id);
    const key = CID.createV1(0x72, parsed.multihash).toString(base36);
    base = `https://${key}.ipns.dweb.link/${parts.join('/')}`;
  } else if (type === 'ARWV') {
    const cleaned = value.replace(/^ar:\/\//i, '');
    const [id, ...parts] = cleaned.split('/');
    if (!/^[a-zA-Z0-9_-]{43}$/.test(id)) throw new Error('Arweave 交易 ID 无效。');
    base = `https://arweave.net/${id}/${parts.join('/')}`;
  } else if (type === 'url') {
    if (/^ipfs:\/\//i.test(value)) return recordTarget('IPFS', value, request);
    if (/^ipns:\/\//i.test(value)) return recordTarget('IPNS', value, request);
    if (/^ar:\/\//i.test(value)) return recordTarget('ARWV', value, request);
    base = safeHTTPS(value).href;
  } else throw new Error('不支持此网站记录类型。');
  return appendRequest(base, request);
}

export function chooseRecord(results, request) {
  let invalid = false;
  let unverifiedCandidate;
  const errors = [];
  // This is a product policy, not a protocol-defined priority.
  for (const type of ['IPFS', 'IPNS', 'ARWV', 'url']) {
    const entry = results.find(record => record?.record === type);
    if (!entry) continue;
    if (entry.verified?.staleness !== true) { invalid = true; continue; }
    if (!entry.deserializedContent?.replace(/\0/g, '').trim()) continue;
    if (entry.verified?.roa === false) {
      // The current name owner endorsed this URL, but website association is
      // unverified. Offer a manual, origin-visible action; never auto-redirect.
      try { unverifiedCandidate ||= recordTarget(type, entry.deserializedContent, request); }
      catch (error) { errors.push(error.message); }
      continue;
    }
    try { return { url: recordTarget(type, entry.deserializedContent, request), record: type }; }
    catch (error) { errors.push(error.message); }
  }
  if (unverifiedCandidate) throw new ResolutionError('SNS_ROA_UNVERIFIED', '网站记录已通过当前域名持有者验证，但目标网站的关联认证未通过。请核对下方地址后手动打开。', { stage: '网站关联认证', candidateURL: unverifiedCandidate });
  if (errors.length) throw new Error(`网站记录无法打开：${errors[0]}`);
  if (invalid) throw new Error('网站记录未通过当前域名持有者验证，可能已过期。');
  throw new Error('此域名没有配置可用的网站记录。钱包地址不能作为网站打开。');
}
