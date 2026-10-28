import './polyfills.js';
import { Connection } from '@solana/web3.js';
import { getMultipleRecords, Record } from '@bonfida/spl-name-service/record';
import { unpackMint, unpackAccount } from '@solana/spl-token';
import { chooseRecord } from './targets.js';
import { ResolutionError } from './errors.js';
import { createRPCTransport } from './rpc.js';

export async function resolveSNS(request, rpc, signal) {
  signal.throwIfAborted();
  const transport = createRPCTransport(rpc, signal);
  const connection = new Connection(rpc, {
    commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: transport.fetch,
  });

  const getAccountInfo = connection.getAccountInfo.bind(connection);
  let requiredTokenAccount;
  connection.getAccountInfo = async (key, commitment) => {
    const account = await getAccountInfo(key, commitment);
    if (requiredTokenAccount?.address.equals(key)) {
      let token;
      try { token = unpackAccount(key, account); } catch { /* Invalid/missing holder must fail closed. */ }
      if (!token || token.amount !== 1n || !token.mint.equals(requiredTokenAccount.mint)) throw new ResolutionError('SNS_NFT_OWNER_INVALID', '无法验证域名 NFT 的当前持有人，请重试。', { stage: 'NFT 持有人验证' });
    }
    return account;
  };
  const largestAccounts = connection.getTokenLargestAccounts.bind(connection);
  connection.getTokenLargestAccounts = async (mint, commitment) => {
    // SDK 4.0.1 asks for NFT holders for every domain, including absent mints
    // and burned/unwrapped names (supply=0). This expensive method is often
    // rate-limited separately. Preflight the mint using a cheap account read.
    const mintAccount = await connection.getAccountInfo(mint, commitment);
    if (!mintAccount) return { context: { slot: 0 }, value: [] };
    let mintInfo;
    try { mintInfo = unpackMint(mint, mintAccount); }
    catch { throw new ResolutionError('SNS_MINT_INVALID', '域名的 NFT mint 账户格式无效，已停止持有者验证。', { stage: 'NFT mint 验证' }); }
    if (mintInfo.supply === 0n) return { context: { slot: 0 }, value: [] };
    // Active NFTs MUST still resolve their actual token owner. Do not catch
    // failures and fall back to the registry owner; that weakens verification.
    let result;
    try { result = await largestAccounts(mint, commitment); }
    catch {
      // In particular, do not let the SDK treat -32602 as an absent mint
      // after we have positively confirmed a circulating NFT exists.
      throw transport.failure || new ResolutionError('SNS_NFT_OWNER_UNAVAILABLE', '无法查询域名 NFT 的当前持有人。', { stage: 'NFT 持有人验证' });
    }
    if (result.value[0]?.amount !== '1') throw new ResolutionError('SNS_NFT_OWNER_INVALID', '未找到域名 NFT 的有效持有人，已停止解析。', { stage: 'NFT 持有人验证' });
    requiredTokenAccount = { address: result.value[0].address, mint };
    return result;
  };

  let results;
  try {
    results = await getMultipleRecords(connection, request.name, [Record.IPFS, Record.IPNS, Record.ARWV, Record.Url], { deserialize: true });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    // web3.js wraps fetch errors in plain Error, losing custom properties.
    // Preserve a typed HTTP/transport failure from this connection instead.
    throw transport.failure || error;
  }
  signal.throwIfAborted();
  // A handled RPC error (e.g. missing NFT mint) must not overwrite record
  // validation/no-website errors after a successful SDK return.
  return chooseRecord(results, request);
}
