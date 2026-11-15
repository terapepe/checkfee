// Launch a Clanker v5 (Tax factory) token on Robinhood Chain, using the official clanker-sdk.
// Fee recipient = the creator fee wallet (single reward slot, 100%); CheckFee only charges the flat launch fee.
import { Clanker, TAX_ADDRESSES, TaxRWAERC20LaunchpadFactory_abi, TaxLaunchHook_abi, FeeEscrow_abi } from 'clanker-sdk/v5';
import { encodeFunctionData, decodeEventLog, formatEther, getAddress, toHex, pad, parseAbi, parseAbiItem, keccak256, encodeAbiParameters, zeroAddress } from 'viem';
import { client } from './pons';

export const CLANKER = TAX_ADDRESSES[4663]; // factory 0xcA111dcd…bcA16
export const clankerUrl = token => `https://www.clanker.world/clanker/${token}`;

const sdk = () => new Clanker({ publicClient: client, chainId: 4663 });
const read = functionName => client.readContract({ address: CLANKER.factory, abi: TaxRWAERC20LaunchpadFactory_abi, functionName });

export async function readClankerInfo() {
  const [launchFee, enabled] = await Promise.all([read('nativeLaunchFee'), read('launchCreationEnabled')]);
  return { launchFee, canLaunch: enabled };
}

const SOCIALS = [['twitter', 'x'], ['telegram', 'telegram'], ['website', 'website'], ['discord', 'discord'], ['farcaster', 'farcaster']];

export async function buildClankerTx({ account, form, image, quoteIn }) {
  account = getAddress(account);
  const payout = getAddress(form.payout);
  const token = {
    name: form.name.trim(),
    symbol: form.symbol.trim(),
    image,
    metadata: {
      description: form.description.trim(),
      socialMediaUrls: SOCIALS.filter(([k]) => form[k]?.trim()).map(([k, platform]) => ({ platform, url: form[k].trim() })),
    },
    context: { interface: 'CheckFee' },
    buyFee: Number(form.fee),  // buy & sell tax %, includes Clanker's cut (factory allows 1–10%)
    sellFee: Number(form.fee),
    // one reward slot: 100% to the fee wallet, admin = launching wallet (can change the recipient later)
    rewards: { recipients: [{ recipient: payout, admin: account, bps: 10_000 }] },
    ...(quoteIn > 0n ? { devBuy: { ethAmount: formatEther(quoteIn) } } : {}),
  };
  // reads config, mines the …cccc salt, builds the route + minOut for the first buy
  const t = await sdk().getDeployTransaction(token, { account });
  const tx = { to: t.address, value: t.value, data: encodeFunctionData({ abi: t.abi, functionName: t.functionName, args: t.args }), expected: t.expectedAddress };
  await simulate(account, tx);
  return tx;
}

async function simulate(account, tx) {
  const r = await client.request({
    method: 'eth_simulateV1',
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Launch simulation failed: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
  return parseClankerLaunch(c.logs);
}

export function parseClankerLaunch(logs) {
  for (const l of logs || []) {
    if (l.address.toLowerCase() !== CLANKER.factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: TaxRWAERC20LaunchpadFactory_abi, data: l.data, topics: l.topics });
      if (ev.eventName === 'Launched') return { token: ev.args.token };
    } catch {}
  }
  return null;
}

/* ---------- market data (token page / Launches) ---------- */
export const TOPIC_CLANKER_LAUNCHED = '0x207384e895174175cc774fe7f7457b37c382f27ebf53d37d5257b862f80eaf9c';
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951'; // hook.poolManager() on Robinhood
const swapEv = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const tokAbi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)', 'function extraMetadata(string) view returns (string)',
]);
const extAbi = parseAbi(['function extsload(bytes32) view returns (bytes32)']);
const abs = x => (x < 0n ? -x : x);

export const isClankerToken = token => client.readContract({ address: CLANKER.factory, abi: TaxRWAERC20LaunchpadFactory_abi, functionName: 'isLaunchToken', args: [token] });

// Clanker launches by a wallet (Launched topic3 = originalCreator)
export async function clankerLaunchesBy(wallet, fromBlock, getLogsChunked) {
  const logs = await getLogsChunked({ address: CLANKER.factory, topics: [TOPIC_CLANKER_LAUNCHED, null, null, pad(wallet).toLowerCase()] }, fromBlock);
  return logs.map(l => ({ platform: 'clanker', token: getAddress('0x' + l.topics[1].slice(26)), poolId: l.topics[2], deployer: getAddress(wallet), block: BigInt(l.blockNumber) }));
}

export async function clankerLaunchBlock(token) {
  const latest = await client.getBlockNumber();
  for (let to = latest; to > 100_000_000n; to -= 10_000_000n) {
    const from = to - 9_999_999n;
    const logs = await client.request({ method: 'eth_getLogs', params: [{ address: CLANKER.factory, fromBlock: toHex(from), toBlock: toHex(to), topics: [TOPIC_CLANKER_LAUNCHED, pad(token).toLowerCase()] }] });
    if (logs.length) return BigInt(logs[0].blockNumber);
  }
  return null;
}

export async function clankerSummary(token) {
  token = getAddress(token);
  const rights = await client.readContract({ address: CLANKER.factory, abi: TaxRWAERC20LaunchpadFactory_abi, functionName: 'creatorRights', args: [token] });
  const slot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [rights.poolId, 6n])); // PoolManager pools mapping
  const [cfg, slot0, name, symbol, supply, image, meta] = await Promise.all([
    client.readContract({ address: CLANKER.hook, abi: TaxLaunchHook_abi, functionName: 'poolConfig', args: [rights.poolId] }),
    client.readContract({ address: POOL_MANAGER, abi: extAbi, functionName: 'extsload', args: [slot] }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'name' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'symbol' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'totalSupply' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'extraMetadata', args: ['image'] }).catch(() => ''),
    client.readContract({ address: token, abi: tokAbi, functionName: 'extraMetadata', args: ['metadata'] }).catch(() => ''),
  ]);
  const tokenIs0 = cfg[1];
  const sq = Number(BigInt(slot0) & ((1n << 160n) - 1n)) / 2 ** 96;
  const p = sq * sq; // currency1 per currency0
  const priceEth = sq ? (tokenIs0 ? p : 1 / p) : null; // ETH pair, both 18 decimals
  let m = {};
  try { m = JSON.parse(meta || '{}'); } catch {}
  const soc = Object.fromEntries((m.socialMediaUrls || []).map(x => [x.platform === 'x' ? 'twitter' : x.platform, /^https?:/.test(x.url) ? x.url : `https://${x.url}`]));
  const tax = cfg[12];
  return {
    platform: 'clanker', token, name, symbol, poolId: rights.poolId, tokenIs0, quote: cfg[3],
    deployer: rights.originalCreator, creator: rights.currentCreator, creatorFeeRecipient: rights.creatorFeeRecipient,
    buyTax: tax.buyTaxRate / 1e6, sellTax: tax.sellTaxRate / 1e6, supply,
    image, description: m.description || '', socials: soc,
    priceEth, mcapEth: priceEth != null ? priceEth * Number(supply) / 1e18 : null,
  };
}

// swaps on the Uniswap v4 pool → same shape as Pons curve trades
export async function clankerTrades(poolId, tokenIs0, fromBlock, getLogsChunked, withTime = true) {
  const raw = await getLogsChunked({ address: POOL_MANAGER, topics: [SWAP_TOPIC, poolId] }, fromBlock);
  const trades = [];
  for (const l of raw) {
    try {
      const d = decodeEventLog({ abi: [swapEv], data: l.data, topics: l.topics });
      const q = tokenIs0 ? d.args.amount1 : d.args.amount0; // ETH delta (swapper view: <0 = paid)
      const t = tokenIs0 ? d.args.amount0 : d.args.amount1;
      const eth = abs(q), tokens = abs(t);
      trades.push({ side: q < 0n ? 'Buy' : 'Sell', trader: null, eth, tokens, price: tokens ? Number(eth) / Number(tokens) : 0, block: BigInt(l.blockNumber), tx: l.transactionHash, logIndex: Number(l.logIndex) });
    } catch {}
  }
  trades.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  if (withTime && trades.length) {
    const recent = trades.slice(-300);
    const blocks = [...new Set(recent.map(t => t.block))];
    const hashes = [...new Set(recent.slice(-100).map(t => t.tx))];
    const ts = new Map(), from = new Map();
    await Promise.all([
      ...blocks.map(async b => ts.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))),
      ...hashes.map(async h => from.set(h, (await client.getTransaction({ hash: h })).from)), // real trader = tx sender
    ]);
    for (const t of trades) { t.time = ts.get(t.block) ?? null; t.trader = from.get(t.tx) || null; }
  }
  return trades;
}

// fees: credited to the escrow on every trade, per recipient (all their Clanker tokens), paid in ETH
export const clankerOwed = recipient => client.readContract({ address: CLANKER.escrow, abi: FeeEscrow_abi, functionName: 'owed', args: [recipient, zeroAddress] });
export const clankerClaimData = recipient => encodeFunctionData({ abi: FeeEscrow_abi, functionName: 'claimFor', args: [recipient, zeroAddress] });
