import { GOOGLE_DOMAINS } from './core.js';

// The domain allowlist is in requestDomains, keeping RE2 programs small.
const googleOrigin = '^https?://(?:www\\.)?google\\.[^/]+/search\\?';
// RE2-compatible and bounded in size. UTF-8 %-escapes are accepted here, then
// decoded/validated in the bridge. Unencoded spaces/quotes do not match.
const hostPrefix = '(?:[a-z0-9_.-]|%[3-9a-f][0-9a-f]|%2[de])+';
const dot = '(?:\\.|%2e)';
const name = `${hostPrefix}${dot}(?:eth|sns)`;
const scheme = '(?:https?(?::|%3a)(?://|%2f%2f))?';
export const GOOGLE_REGEX = `${googleOrigin}(?:[^&]*&)*q=${scheme}${name}(?:(?:/|%2f|%3f|%23)[^&]*)?(?:&.*)?$`;
export const DIRECT_REGEX = '^https?://(?:[a-z0-9_-]+\\.)+(?:eth|sns)(?:[/?#].*)?$';
export const BYPASS_REGEX = `${googleOrigin}(?:[^&#]*&)*w3r=off(?:&[^#]*)?(?:#.*)?$`;
export const RULE_IDS = [1, 2, 3];

export function makeRules(resolveURL, settings) {
  if (!settings.enabled) return [];
  const redirect = { type: 'redirect', redirect: { regexSubstitution: `${resolveURL}#\\0` } };
  const condition = regexFilter => ({ regexFilter, resourceTypes: ['main_frame'], requestMethods: ['get'], isUrlFilterCaseSensitive: false });
  const rules = [{ id: 1, priority: 10, action: redirect, condition: condition(DIRECT_REGEX) }];
  if (settings.google) rules.push(
    { id: 2, priority: 10, action: redirect, condition: { ...condition(GOOGLE_REGEX), requestDomains: GOOGLE_DOMAINS } },
    { id: 3, priority: 100, action: { type: 'allow' }, condition: { ...condition(BYPASS_REGEX), requestDomains: GOOGLE_DOMAINS } },
  );
  return rules;
}
