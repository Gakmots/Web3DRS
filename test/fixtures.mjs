import { getSnsDomainKeySync } from '@bonfida/spl-name-service/domain';
import { getRecordV2Key, Record, GUARDIANS } from '@bonfida/spl-name-service/record';
import { PublicKey } from '@solana/web3.js';
import { getDomainMint } from '@bonfida/spl-name-service/nft';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Protocol-shaped accounts, never live-chain claims. These go through the
// installed official SDK rather than replacing its resolution functions.
export const owner = new PublicKey(new Uint8Array(32).fill(7));
function account(data) { return { data: [data.toString('base64'), 'base64'], executable: false, lamports: 1000000, owner: 'namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX', rentEpoch: 0 }; }
const fixtures = new Map();
export const tokenOwner = new PublicKey(new Uint8Array(32).fill(9));
export const tokenAccountKey = new PublicKey(new Uint8Array(32).fill(10));
export const activeMint = getDomainMint(getSnsDomainKeySync('active').pubkey);
for (const name of ['website', 'stale', 'empty', 'unsafe', 'burned', 'active', 'unverified']) {
  const domainKey = getSnsDomainKeySync(name).pubkey;
  const domainData = Buffer.alloc(96); owner.toBuffer().copy(domainData, 32);
  fixtures.set(domainKey.toBase58(), account(domainData));
  if (name === 'empty') continue;
  const content = Buffer.from(name === 'unsafe' ? 'javascript:alert(1)' : 'https://website.example/base/');
  const header = Buffer.alloc(8); header.writeUInt16LE(1, 0); header.writeUInt16LE(1, 2); header.writeUInt32LE(content.length, 4);
  if (name === 'unverified') header.writeUInt16LE(3, 2);
  const staleness = name === 'stale' ? Buffer.alloc(32, 8) : name === 'active' ? tokenOwner.toBuffer() : owner.toBuffer();
  const record = Buffer.concat([Buffer.alloc(96), header, staleness, GUARDIANS.get(Record.Url).toBuffer(), content]);
  fixtures.set(getRecordV2Key(name, Record.Url).toBase58(), account(record));
  if (name === 'burned' || name === 'active') {
    const mint = getDomainMint(domainKey);
    const data = Buffer.alloc(82);
    data.writeBigUInt64LE(name === 'active' ? 1n : 0n, 36);
    data[45] = 1; // SPL MintLayout.isInitialized
    fixtures.set(mint.toBase58(), { ...account(data), owner: TOKEN_PROGRAM_ID.toBase58() });
  }
}
const tokenData = Buffer.alloc(165);
activeMint.toBuffer().copy(tokenData, 0);
tokenOwner.toBuffer().copy(tokenData, 32);
tokenData.writeBigUInt64LE(1n, 64);
tokenData[108] = 1; // AccountState.Initialized
fixtures.set(tokenAccountKey.toBase58(), { ...account(tokenData), owner: TOKEN_PROGRAM_ID.toBase58() });

export function rpcResponse(payload) {
  let result;
  if (payload.method === 'getAccountInfo') result = { context: { slot: 300000000 }, value: fixtures.get(payload.params[0]) || null };
  else if (payload.method === 'getMultipleAccounts') result = { context: { slot: 300000000 }, value: payload.params[0].map(key => fixtures.get(key) || null) };
  else if (payload.method === 'getTokenLargestAccounts') result = { context: { slot: 300000000 }, value: payload.params[0] === activeMint.toBase58() ? [{ address: tokenAccountKey.toBase58(), amount: '1', decimals: 0, uiAmount: 1, uiAmountString: '1' }] : [] };
  else throw new Error(`Unexpected RPC method: ${payload.method}`);
  return { jsonrpc: '2.0', id: payload.id, result };
}
