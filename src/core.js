import { ens_normalize } from '@adraffy/ens-normalize';
import punycode from 'punycode/punycode.js';
import { DEFAULT_RPC } from './rpc-config.js';
export { DEFAULT_RPC } from './rpc-config.js';

// Deliberately enumerate origins: google.com.evil.example is never Google.
export const GOOGLE_DOMAINS = ['google.com', 'google.com.hk', 'google.com.tw', 'google.co.jp', 'google.co.uk', 'google.de', 'google.fr', 'google.ca', 'google.com.au', 'google.com.sg', 'google.co.in'];
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, google: true, rpc: DEFAULT_RPC });
export const BYPASS_PARAM = 'w3r';
export const MAX_INPUT = 4096;

export function isGoogleHost(host) {
  return GOOGLE_DOMAINS.some(d => host === d || host === `www.${d}`);
}

export function isGoogleSearch(url) {
  return ['http:', 'https:'].includes(url.protocol) && !url.port && !url.username && !url.password && isGoogleHost(url.hostname) && url.pathname === '/search';
}

export function parseDomainInput(input) {
  if (typeof input !== 'string' || !input || input.length > MAX_INPUT || input !== input.trim() || /[\s\\\u0000-\u001f\u007f]/u.test(input)) return null;
  try {
    // A scheme must be HTTP(S); naked domain names are prefixed locally.
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!/\.(eth|sns)$/i.test(url.hostname)) return null;
    let name = punycode.toUnicode(url.hostname);
    const tld = name.endsWith('.eth') ? 'eth' : 'sns';
    if (tld === 'eth') name = ens_normalize(name);
    else {
      name = name.normalize('NFC');
      if (!name.split('.').every(label => /^[\p{L}\p{N}\p{M}\p{S}_-]+$/u.test(label))) return null;
    }
    if (name.split('.').some(label => !label) || name.length > 253) return null;
    url.hostname = name;
    return { name, tld, url: url.href, pathname: url.pathname, search: url.search, hash: url.hash };
  } catch { return null; }
}

export function parseNavigation(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 16384) return null;
    const url = new URL(raw);
    if (isGoogleSearch(url)) {
      if (url.searchParams.get(BYPASS_PARAM) === 'off') return null;
      const queries = url.searchParams.getAll('q');
      if (queries.length !== 1) return null;
      const domain = parseDomainInput(queries[0]);
      return domain ? { ...domain, source: 'google', original: url.href } : null;
    }
    const domain = parseDomainInput(raw);
    return domain ? { ...domain, source: 'direct', original: url.href } : null;
  } catch { return null; }
}

export function googleSearchURL(input, original) {
  let url;
  try { url = new URL(original); } catch { /* Use the safe default below. */ }
  if (!url || !isGoogleSearch(url)) {
    url = new URL('https://www.google.com/search');
    url.searchParams.set('q', input);
  }
  url.searchParams.set(BYPASS_PARAM, 'off');
  return url.href;
}

export function safeHTTPS(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.') || /\.(eth|sns)$/i.test(url.hostname)) throw new Error('目标必须是无账号、无自定义端口的 HTTPS 地址。');
  // Records must not turn an on-chain name into a local network navigation.
  if (!url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[')) throw new Error('不支持本机、局域网或 IP 地址目标。');
  if (parseNavigation(url.href)) throw new Error('目标会再次进入域名解析，已阻止循环跳转。');
  return url;
}

export function ethTarget(request) {
  const url = new URL(request.url);
  url.protocol = 'https:';
  url.hostname = `${url.hostname}.limo`;
  return safeHTTPS(url.href).href;
}

// Preserve a record's base directory. Assign pathname instead of resolving a
// user path with new URL(), which would allow //host to replace the origin.
export function appendRequest(base, request) {
  const target = safeHTTPS(base);
  if (request.pathname !== '/') target.pathname = `${target.pathname.replace(/\/$/, '')}/${request.pathname.replace(/^\/+/, '')}`;
  if (request.search) target.search = request.search;
  if (request.hash) target.hash = request.hash;
  return safeHTTPS(target.href).href;
}

export function normalizedSettings(value = {}) {
  let rpc = DEFAULT_RPC;
  try { rpc = safeHTTPS(value.rpc || DEFAULT_RPC).href.replace(/\/$/, ''); } catch { /* Ignore corrupt settings. */ }
  return { enabled: value.enabled !== false, google: value.google !== false, rpc };
}
