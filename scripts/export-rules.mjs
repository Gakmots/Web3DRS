import { makeRules } from '../src/rules.js';
import { makeRPCHeaderRule } from '../src/rpc-headers.js';
console.log(JSON.stringify([
  ...makeRules('chrome-extension://test/resolve.html', { enabled: true, google: true }),
  makeRPCHeaderRule('https://rpc.example/v1/account?api-key=not-in-rule', 'a'.repeat(32), 2000),
]));
