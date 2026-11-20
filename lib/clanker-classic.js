// Clanker v0–v4 on Base (the "classic" Clanker before the v5 tax launchpad).
// Tokens come from clanker.world (via /api/clanker-classic); fees are read on chain:
//  - v0–v3.1: the token's Uniswap v3 LP position. Uncollected fees use the pool's fee-growth math
//    (same numbers as NonfungiblePositionManager.collect), times the creator's share of that version.
//  - v4: the ClankerFeeLocker balance of the wallet, after a simulated collectRewards of each token
//    (pending pool fees move into the fee locker), all in one eth_call through Multicall3.
// Claims: v2 / v3 / v3.1 claimRewards and v4 collectRewards + feeLocker.claim are callable by anyone
// (fees still go to the recipients), so they batch into Multicall3; v0 / v1 need the position owner.
import { parseAbi, getAddress, encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem';
import { clientOf } from './chains';

export const BASE = 8453;
const WETH = '0x4200000000000000000000000000000000000006';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
export const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const Q192 = 2n ** 192n, Q128 = 2n ** 128n, M256 = 2n ** 256n;

export const CLASSIC = {
  proxy: { v: 'v0', factory: '0x250c9FB2b411B48273f69879007803790A6AeA47' },
  clanker: { v: 'v1', factory: '0x9B84fcE5Dcd9a38d2D01d5D72373F6b6b067c3e1' },
  clanker_v2: { v: 'v2', factory: '0x732560fa1d1A76350b1A500155BA978031B53833' },
  clanker_v3: { v: 'v3', factory: '0x375C15db32D28cEcdcAB5C03Ab889bf15cbD2c5E' },
  clanker_v3_1: { v: 'v3.1', factory: '0x2A787b2362021cC3eEa3C24C4748a6cD5B687382' },
  clanker_v4: { v: 'v4', factory: '0xE85A59c628F7d27878ACeB4bf3b35733630083a9' },
};
export const classicUrl = t => `https://www.clanker.world/clanker/${t}`;

const NPM_ABI = parseAbi([
  'function positions(uint256) view returns (uint96, address, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 fg0, uint256 fg1, uint128 owed0, uint128 owed1)',
]);
const POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24) view returns (uint128, int128, uint256 fo0, uint256 fo1, int56, uint160, uint32, bool)',
]);
const LOCK_ABI = parseAbi([
  'function owner() view returns (address)',                                                    // v1 locker (one per token)
  'function _clankerTeamReward() view returns (uint256)',                                       // v2 / v3 locker
  'function _userRewardRecipientForToken(uint256) view returns (address recipient, uint256 lpTokenId)',
  'function tokenRewards(uint256) view returns (uint256 lpTokenId, uint256 creatorReward, (address admin, address recipient) creator, (address admin, address recipient) interfacer)', // v3.1
  'function collectFees(address recipient, uint256 tokenId)',                                   // v0 / v1 locker
  'function collectFees(uint256 tokenId)',                                                      // v0 meta-locker
]);
const V4_LOCK_ABI = parseAbi([
  'function feeLocker() view returns (address)',
  'function collectRewards(address token)',
  'function tokenRewards(address token) view returns ((address token, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 positionId, uint256 numPositions, uint16[] rewardBps, address[] rewardAdmins, address[] rewardRecipients))',
]);
const FEE_LOCKER_ABI = parseAbi(['function availableFees(address feeOwner, address token) view returns (uint256)', 'function claim(address feeOwner, address token)']);
const CLAIM_ABI = parseAbi(['function claimRewards(address token)']);
const ERC20_ABI = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
const MC3_ABI = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const mod = x => ((x % M256) + M256) % M256;

/* ---------- discovery ---------- */
export async function classicTokensOf(wallet) {
  const r = await fetch(`/api/clanker-classic?wallet=${wallet}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Clanker v0–v4 lookup failed (${r.status})`);
  return j.tokens;
}

/* ---------- v0–v3.1: Uniswap v3 position fees ---------- */
async function v3Fees(client, t) {
  const id = BigInt(t.positionId);
  const p = await client.readContract({ address: NPM, abi: NPM_ABI, functionName: 'positions', args: [id] });
  const [token0, token1, , tickLower, tickUpper, liq, in0, in1, owed0, owed1] = p.slice(2);
  const pool = t.pool;
  const [s0, g0, g1, lo, up] = await Promise.all([
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'slot0' }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'feeGrowthGlobal0X128' }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'feeGrowthGlobal1X128' }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'ticks', args: [tickLower] }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'ticks', args: [tickUpper] }),
  ]);
  const tick = s0[1];
  const inside = (g, loOut, upOut) => {
    const below = tick >= tickLower ? loOut : mod(g - loOut);
    const above = tick < tickUpper ? upOut : mod(g - upOut);
    return mod(g - below - above);
  };
  const f0 = owed0 + (liq * mod(inside(g0, lo[2], up[2]) - in0)) / Q128;
  const f1 = owed1 + (liq * mod(inside(g1, lo[3], up[3]) - in1)) / Q128;
  const tokIs0 = same(token0, t.token);
  return { tokFee: tokIs0 ? f0 : f1, pairFee: tokIs0 ? f1 : f0, pair: tokIs0 ? token1 : token0, sqrtP: s0[0], tokIs0 };
}

// creator share (percent of all LP fees) and who receives it
async function v3Split(client, t, wallet) {
  const id = BigInt(t.positionId);
  switch (t.type) {
    case 'proxy': // v0: 40% (Clanker docs); the locker has no getters, the deployer is the recipient
      return { share: 40n, recipient: t.admin };
    case 'clanker': { // v1: one locker per token, its owner collects; Clanker keeps _fee = 60%
      const owner = await client.readContract({ address: t.locker, abi: LOCK_ABI, functionName: 'owner' });
      return { share: 40n, recipient: owner };
    }
    case 'clanker_v2':
    case 'clanker_v3': {
      const [team, r] = await Promise.all([
        client.readContract({ address: t.locker, abi: LOCK_ABI, functionName: '_clankerTeamReward' }),
        client.readContract({ address: t.locker, abi: LOCK_ABI, functionName: '_userRewardRecipientForToken', args: [id] }),
      ]);
      return { share: 100n - team, recipient: r[0] };
    }
    case 'clanker_v3_1': { // Clanker 20%, creator `creatorReward`%, interface the rest
      const r = await client.readContract({ address: t.locker, abi: LOCK_ABI, functionName: 'tokenRewards', args: [id] });
      const creator = r[1], intf = 80n - r[1];
      // the same wallet can also be the interface recipient
      if (same(r[3].recipient, wallet) && !same(r[2].recipient, wallet)) return { share: intf, recipient: r[3].recipient };
      return { share: creator + (same(r[3].recipient, r[2].recipient) ? intf : 0n), recipient: r[2].recipient };
    }
  }
  return { share: 0n, recipient: zeroAddress };
}

const symCache = new Map();
async function symbolOf(client, a) {
  const k = a.toLowerCase();
  if (k === WETH.toLowerCase()) return 'WETH';
  if (!symCache.has(k)) symCache.set(k, client.readContract({ address: a, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => '?'));
  return symCache.get(k);
}

async function v3Row(client, t, wallet) {
  const [f, s] = await Promise.all([v3Fees(client, t), v3Split(client, t, wallet)]);
  const tok = (f.tokFee * s.share) / 100n, pair = (f.pairFee * s.share) / 100n;
  const isWeth = same(f.pair, WETH);
  // the token part valued in the pair token at the pool price (both 18 decimals on Clanker pools)
  const p2 = f.sqrtP * f.sqrtP;
  const tokInPair = p2 === 0n ? 0n : f.tokIs0 ? (tok * p2) / Q192 : (tok * Q192) / p2;
  return {
    ...t, version: CLASSIC[t.type].v, recipient: s.recipient, creator: t.admin, share: Number(s.share),
    pairToken: f.pair, pairSymbol: isWeth ? 'WETH' : await symbolOf(client, f.pair),
    feePair: pair, feeToken: tok, // creator's part, raw
    earned: isWeth ? pair + tokInPair : null, // ETH value; null when paired with another token
    hasFees: f.tokFee > 0n || f.pairFee > 0n,
  };
}

/* ---------- v4: fee locker, after a simulated collectRewards ---------- */
async function mc3Call(client, calls) {
  const data = encodeFunctionData({ abi: MC3_ABI, functionName: 'aggregate3', args: [calls.map(c => ({ target: c.to, allowFailure: true, callData: c.data }))] });
  const r = await client.call({ to: MC3, data, gas: 50_000_000n });
  return decodeFunctionResult({ abi: MC3_ABI, functionName: 'aggregate3', data: r.data });
}
const readU = (res, i) => (res[i]?.success && res[i].returnData.length >= 66 ? BigInt(res[i].returnData.slice(0, 66)) : 0n);

async function v4Rows(client, list, wallet) {
  if (!list.length) return { rows: [], weth: 0n, feeLockers: [] };
  // locker → fee locker, token → recipients
  const lockers = [...new Set(list.map(t => t.locker.toLowerCase()))];
  const fl = Object.fromEntries(await Promise.all(lockers.map(async l => [l, await client.readContract({ address: l, abi: V4_LOCK_ABI, functionName: 'feeLocker' })])));
  const rewards = await Promise.all(list.map(t => client.readContract({ address: t.locker, abi: V4_LOCK_ABI, functionName: 'tokenRewards', args: [t.token] }).catch(() => null)));
  const rows = list.map((t, i) => {
    const r = rewards[i];
    const idx = r ? r.rewardRecipients.findIndex(a => same(a, wallet)) : -1;
    return { ...t, version: 'v4', feeLocker: fl[t.locker.toLowerCase()], creator: t.admin,
      recipient: r ? (idx >= 0 ? r.rewardRecipients[idx] : r.rewardRecipients[0]) : t.admin,
      share: r && idx >= 0 ? Number(r.rewardBps[idx]) / 100 : r ? Number(r.rewardBps[0]) / 100 : null,
      pairToken: r ? (same(r.poolKey.currency0, t.token) ? r.poolKey.currency1 : r.poolKey.currency0) : WETH };
  });
  // per fee locker, in chunks: read WETH, then [collect(t), WETH, token] for each token
  let weth = 0n;
  const feeLockers = [...new Set(rows.map(r => r.feeLocker.toLowerCase()))];
  for (const L of feeLockers) {
    const mine = rows.filter(r => r.feeLocker.toLowerCase() === L);
    let base = null;
    for (let i = 0; i < mine.length; i += 25) {
      const part = mine.slice(i, i + 25);
      const avail = tok => ({ to: L, data: encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'availableFees', args: [wallet, tok] }) });
      const calls = [avail(WETH)];
      for (const r of part) calls.push({ to: r.locker, data: encodeFunctionData({ abi: V4_LOCK_ABI, functionName: 'collectRewards', args: [r.token] }) }, avail(WETH), avail(r.token));
      const res = await mc3Call(client, calls);
      const start = readU(res, 0);
      if (base == null) { base = start; weth += start; }
      let prev = start;
      part.forEach((r, k) => {
        const w = readU(res, 2 + k * 3), tk = readU(res, 3 + k * 3);
        r.pendingWeth = w > prev ? w - prev : 0n; // pool fees this token adds when collected
        r.feeToken = tk; r.feePair = r.pendingWeth;
        r.pending = res[1 + k * 3]?.success && r.pendingWeth > 0n;
        prev = w;
        weth += r.pendingWeth;
      });
    }
  }
  for (const r of rows) {
    r.pairSymbol = same(r.pairToken, WETH) ? 'WETH' : await symbolOf(client, r.pairToken);
    r.earned = same(r.pairToken, WETH) ? r.pendingWeth || 0n : null;
    r.hasFees = (r.pendingWeth || 0n) > 0n || (r.feeToken || 0n) > 0n;
  }
  return { rows, weth, base: weth - rows.reduce((a, r) => a + (r.pendingWeth || 0n), 0n), feeLockers };
}

/* ---------- one wallet ---------- */
export async function checkClassicWallet(wallet, tokens) {
  wallet = getAddress(wallet);
  const client = clientOf(BASE);
  const list = tokens || await classicTokensOf(wallet);
  const legacy = list.filter(t => t.type !== 'clanker_v4' && t.positionId && t.pool && t.locker);
  const v4 = list.filter(t => t.type === 'clanker_v4' && t.locker);
  const rows = [];
  for (let i = 0; i < legacy.length; i += 20) {
    rows.push(...await Promise.all(legacy.slice(i, i + 20).map(t => v3Row(client, t, wallet).catch(e => ({ ...t, version: CLASSIC[t.type].v, error: e.shortMessage || e.message })))));
  }
  const v4r = await v4Rows(client, v4, wallet).catch(e => ({ rows: v4.map(t => ({ ...t, version: 'v4', error: e.shortMessage || e.message })), weth: 0n, base: 0n, feeLockers: [] }));
  const all = [...rows, ...v4r.rows];
  // what this wallet can collect: its own v0–v3.1 shares + its whole v4 WETH balance (earlier collects included)
  const owed = rows.filter(r => !r.error && same(r.recipient, wallet)).reduce((a, r) => a + (r.earned || 0n), 0n) + v4r.weth;
  return {
    platform: 'classic', chainId: BASE, wallet, owed, v4Weth: v4r.weth, v4Base: v4r.base || 0n, v4FeeLockers: v4r.feeLockers,
    tokens: all.map(r => ({ ...r, token: getAddress(r.token) })).sort((a, b) => ((b.earned || 0n) > (a.earned || 0n) ? 1 : (b.earned || 0n) < (a.earned || 0n) ? -1 : 0)),
    found: list.length,
  };
}

/* ---------- claims ---------- */
// calls anyone may send (fees go to the token's recipients): v2 / v3 / v3.1 claimRewards, v4 collect + fee locker claims
export function classicOpenCalls(results) {
  const calls = [];
  const seen = new Set();
  const add = (to, data, key) => { if (seen.has(key)) return; seen.add(key); calls.push({ to, data }); };
  for (const res of results) {
    for (const t of res.tokens) {
      if (t.error || !t.hasFees) continue;
      if (['clanker_v2', 'clanker_v3', 'clanker_v3_1'].includes(t.type)) add(CLASSIC[t.type].factory, encodeFunctionData({ abi: CLAIM_ABI, functionName: 'claimRewards', args: [t.token] }), 'c' + t.token);
      if (t.type === 'clanker_v4' && t.pending) add(t.locker, encodeFunctionData({ abi: V4_LOCK_ABI, functionName: 'collectRewards', args: [t.token] }), 'r' + t.token);
    }
    // v4 fee locker balances of this wallet (WETH + each token it holds fees in)
    for (const L of res.v4FeeLockers || []) {
      if (res.v4Weth > 0n) add(L, encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [res.wallet, WETH] }), `f${L}${res.wallet}w`);
      for (const t of res.tokens) if (t.type === 'clanker_v4' && t.feeLocker?.toLowerCase() === L && t.feeToken > 0n) {
        add(L, encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [res.wallet, t.token] }), `f${L}${res.wallet}${t.token}`);
      }
    }
  }
  return calls;
}

// v0 / v1: the position owner calls the token's locker (v1 locker.collectFees(recipient, id); v0 locker or meta-locker)
export async function classicOwnerCall(t, account) {
  const client = clientOf(BASE);
  const id = BigInt(t.positionId);
  const a = encodeFunctionData({ abi: LOCK_ABI, functionName: 'collectFees', args: [account, id] });
  try {
    await client.call({ account, to: t.locker, data: a });
    return { to: t.locker, data: a };
  } catch {
    const b = encodeFunctionData({ abi: LOCK_ABI, functionName: 'collectFees', args: [id] });
    await client.call({ account, to: t.locker, data: b }); // throws if this wallet can't claim either way
    return { to: t.locker, data: b };
  }
}

// one call as is, more as Multicall3 batches
export function batchTxs(calls, size = 30) {
  if (calls.length === 1) return [calls[0]];
  const out = [];
  for (let i = 0; i < calls.length; i += size) {
    const part = calls.slice(i, i + size);
    out.push({ to: MC3, data: encodeFunctionData({ abi: MC3_ABI, functionName: 'aggregate3', args: [part.map(c => ({ target: c.to, allowFailure: true, callData: c.data }))] }), n: part.length });
  }
  return out;
}
