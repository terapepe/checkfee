// Uniswap v4 "tax" launchpads on Robinhood Chain: Clanker v5 and o1 run the same o1 contract suite
// (factory → v4 pool + hook → FeeEscrow). One code path for both; only addresses, the launch-param
// layout (Clanker adds creator + feeSlots) and the token address suffix differ.
import { TaxRWAERC20LaunchpadFactory_abi as FACTORY_ABI, TaxLaunchHook_abi as HOOK_ABI, FeeEscrow_abi as ESCROW_ABI } from 'clanker-sdk/v5';
import {
  encodeFunctionData, decodeEventLog, decodeFunctionResult, getAddress, toHex, pad, parseAbi, parseAbiItem, keccak256,
  encodeAbiParameters, zeroAddress, zeroHash, hexToBytes, bytesToHex,
} from 'viem';
import { clientOf, getLogsOn, CHAIN_IDS } from './chains';

// per platform, per chain (Robinhood 4663, Base 8453); pm = Uniswap v4 PoolManager the hook uses
export const TAX = {
  clanker: {
    key: 'clanker', label: 'Clanker', v5: true,
    suffixOk: h => h[30] === 0xcc && h[31] === 0xcc, // token address ends in cccc
    url: t => `https://www.clanker.world/clanker/${t}`,
    chains: {
      4663: { start: 106_650_000n, factory: '0xcA111dcdd2cE924c3378d6514fDCbC46217bcA16', hook: '0x565189a6780D1a50FC1792F64db8e4881119AaCC',
        escrow: '0xFBB6e837A2eA96d6b4beb4788c2749Cf34A997e7', deployer: '0xE76c413b26c7006CF3ac747b46A8F05E0Ccf3287', pm: '0x8366a39CC670B4001A1121B8F6A443A643e40951' },
      8453: { start: 53_331_000n, factory: '0x572e88D3cD7f23E4241EB6ceDD96667271bF09A0', hook: '0x5E320eA6278107968C119942E57d876c5F922AcC',
        escrow: '0x5dd237d1f716C65426CCd2FAe82B95109825FA61', deployer: '0xc25FfE6374EdcCb5bFCcA3b9684046a426AbCE6A', pm: '0x498581fF718922c3f8e6A244956aF099B2652b2b' },
    },
  },
  o1: {
    key: 'o1', label: 'o1', v5: false,
    suffixOk: h => h[31] === 0x01, // token address ends in 01
    url: (t, id = 4663) => `https://launch.o1.exchange/token/${t}?chain=${id}`,
    chains: {
      4663: { start: 73_128_000n, factory: '0x29CAD997f3cf1aa9CA51E12BE29C09E3E00F119A', hook: '0xe05521566199A3Ba8D8721C0e44E96018EB1EaCc',
        escrow: '0x1Dede99A17e1C7775541d73B675470Ba4BeE0318', deployer: '0x0598EB4bD64E0dA829a4A82EfAeae2EE019AEC94', pm: '0x8366a39CC670B4001A1121B8F6A443A643e40951' },
      8453: { start: 51_776_000n, factory: '0x53C59d8d335681d58F564cF62073fA3C57cF81ee', hook: '0x9C7155D7216454D9d894F792c8B5C564F2c66AcC',
        escrow: '0xFae34Bd1311b37d315bF412cc1a4e441F07f4517', deployer: '0xBEcbA599C8bd5373ba9C680eA4B3AfFC5C7a4311', pm: '0x498581fF718922c3f8e6A244956aF099B2652b2b' },
    },
  },
};
export const TAX_KEYS = Object.keys(TAX);
// platform + chain → one config object (label, v5, suffix, url + addresses)
const cfgOf = (pf, id = 4663) => ({ ...TAX[pf], ...TAX[pf].chains[Number(id)], chainId: Number(id), client: clientOf(id) });
export const taxUrl = (pf, token, id = 4663) => TAX[pf].url(token, id);

// o1's deployed factory predates `creator` / `feeSlots` in LaunchParams
const LP = '(string tokenName, string tokenSymbol, string tokenContractURI, bytes32 creatorSalt, address quoteToken, uint64 expectedConfigVersion, uint64 deadline, bool metadataEditable, string[] metadataKeys, string[] metadataValues, (uint32 buyTaxRate, uint32 sellTaxRate, uint32 creatorAllocationShare, uint32 burnAllocationShare, uint32 dividendAllocationShare, uint32 integratorAllocationShare, uint256 minimumDividendHolding) taxConfiguration, address creatorFeeRecipient, address integratorFeeRecipient, bool antiSnipeEnabled)';
const O1_ABI = parseAbi([
  `function launchTokenInitCodeHash(${LP} p) view returns (bytes32)`,
  `function createLaunch(${LP} p) payable returns (address token, bytes32 poolId)`,
  `function createLaunchAndBuy(${LP} p, (address fundingToken, uint256 amountIn, uint256 minAmountOut, bytes routeData) b) payable returns (address token, bytes32 poolId, uint256 amountOut)`,
]);
const launchAbi = P => (P.v5 ? FACTORY_ABI : O1_ABI);
const fread = (P, functionName, args, account) => P.client.readContract({ address: P.factory, abi: FACTORY_ABI, functionName, args, account });

/* ---------- launch ---------- */
export async function readTaxInfo(pf, id) {
  const P = cfgOf(pf, id);
  const [launchFee, enabled] = await Promise.all([fread(P, 'nativeLaunchFee'), fread(P, 'launchCreationEnabled')]);
  return { launchFee, canLaunch: enabled };
}

const SOCIALS = [['twitter', 'x'], ['telegram', 'telegram'], ['website', 'website'], ['discord', 'discord'], ['farcaster', 'farcaster']];
const routeAbi = [{ type: 'tuple[]', components: [
  { name: 'swapType', type: 'uint8' }, { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'poolAddress', type: 'address' },
  { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }, { name: 'hookData', type: 'bytes' },
] }];

// CREATE2 salt search: address = f(deployer, keccak(caller, salt), initCodeHash) must end in the platform suffix
async function mineSalt(P, caller, initCodeHash) {
  const scope = hexToBytes(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [caller, toHex(crypto.getRandomValues(new Uint8Array(32)))]));
  const pre = new Uint8Array(85);
  pre[0] = 0xff; pre.set(hexToBytes(P.deployer), 1); pre.set(hexToBytes(initCodeHash), 53);
  for (let i = 0; i < 2_000_000; i++) {
    if (i % 2048 === 0) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    pre.set(keccak256(scope, 'bytes'), 21);
    const h = keccak256(pre, 'bytes');
    if (P.suffixOk(h)) return { salt: bytesToHex(scope.subarray(32)), token: getAddress(bytesToHex(h.subarray(12))) };
    for (let k = 63; k >= 32; k--) { scope[k] = (scope[k] + 1) & 255; if (scope[k] !== 0) break; }
  }
  throw new Error('No token address found, try again');
}

// token metadata JSON (o1 reads contractURI: name, symbol, description, image, links), pinned via /api/upload
export function contractMeta(form, image) {
  const links = Object.fromEntries(['website', 'twitter', 'telegram', 'discord', 'farcaster'].map(k => [k, (form[k] || '').trim()]).filter(([, v]) => v));
  return { name: form.name.trim(), symbol: form.symbol.trim(), description: (form.description || '').trim(), image, links };
}
export async function pinContractMeta(meta) {
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Metadata upload failed: ${j.error || r.status}`);
  return j.uri;
}
// creator (metadata editable) sets contractURI later, e.g. for tokens launched before it was set
export const setContractUriTx = (pf, id, token, uri) => ({ to: cfgOf(pf, id).factory, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: 'updateTokenContractURI', args: [token, uri] }) });

export async function buildTaxTx(pf, id, { account, form, image, quoteIn, contractURI = '' }) {
  const P = cfgOf(pf, id);
  const client = P.client;
  account = getAddress(account);
  const payout = getAddress(form.payout);
  const rate = Math.round(Number(form.fee) * 1_000_000); // % → 1e6 scale, buy = sell
  const [blk, cfg, fee, ts] = await Promise.all([client.getBlock(), fread(P, 'configVersion'), fread(P, 'nativeLaunchFee'), fread(P, 'tickSpacing')]);
  const meta = {
    description: form.description.trim(),
    socialMediaUrls: SOCIALS.filter(([k]) => form[k]?.trim()).map(([k, platform]) => ({ platform, url: form[k].trim() })),
  };
  const params = {
    ...(P.v5 ? { creator: zeroAddress, feeSlots: [{ recipient: payout, admin: account, relativeWeightBps: 10_000, isCreator: true }] } : {}),
    tokenName: form.name.trim(), tokenSymbol: form.symbol.trim(), tokenContractURI: contractURI, creatorSalt: zeroHash, quoteToken: zeroAddress,
    expectedConfigVersion: cfg, deadline: blk.timestamp + (quoteIn > 0n ? 300n : 1200n), metadataEditable: true,
    metadataKeys: ['image', 'metadata'], metadataValues: [image, JSON.stringify(meta)],
    taxConfiguration: { buyTaxRate: rate, sellTaxRate: rate, creatorAllocationShare: 100_000_000, burnAllocationShare: 0, dividendAllocationShare: 0, integratorAllocationShare: 0, minimumDividendHolding: 0n },
    creatorFeeRecipient: payout, integratorFeeRecipient: zeroAddress, antiSnipeEnabled: true,
  };
  const abi = launchAbi(P);
  const ich = await client.readContract({ address: P.factory, abi, functionName: 'launchTokenInitCodeHash', args: [params], account });
  const { salt, token } = await mineSalt(P, account, ich);
  params.creatorSalt = salt;
  if (quoteIn <= 0n) {
    const tx = { to: P.factory, value: fee, data: encodeFunctionData({ abi, functionName: 'createLaunch', args: [params] }), expected: token };
    await simulate(client, account, tx);
    return tx;
  }
  // first buy in the launch tx: one hop through the new pool, minOut = 95% of the simulated amount
  const routeData = encodeAbiParameters(routeAbi, [[{ swapType: 2, tokenIn: zeroAddress, tokenOut: token, poolAddress: zeroAddress, fee: 0, tickSpacing: ts, hooks: P.hook, hookData: '0x' }]]);
  const mk = min => ({ to: P.factory, value: fee + quoteIn, expected: token,
    data: encodeFunctionData({ abi, functionName: 'createLaunchAndBuy', args: [params, { fundingToken: zeroAddress, amountIn: quoteIn, minAmountOut: min, routeData }] }) });
  const c = await simulate(client, account, mk(1n));
  const [, , out] = decodeFunctionResult({ abi, functionName: 'createLaunchAndBuy', data: c.returnData });
  return mk(out * 95n / 100n);
}

async function simulate(client, account, tx) {
  const r = await client.request({
    method: 'eth_simulateV1',
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Launch simulation failed: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
  return c;
}

export function parseTaxLaunch(pf, id, logs) {
  const P = cfgOf(pf, id);
  for (const l of logs || []) {
    if (l.address.toLowerCase() !== P.factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: l.data, topics: l.topics });
      if (ev.eventName === 'Launched') return { token: ev.args.token, poolId: ev.args.poolId };
    } catch {}
  }
  return null;
}

/* ---------- market data ---------- */
export const TOPIC_TAX_LAUNCHED = '0x207384e895174175cc774fe7f7457b37c382f27ebf53d37d5257b862f80eaf9c'; // Launched(token, poolId, originalCreator, …)
const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const swapEv = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
const tokAbi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)', 'function extraMetadata(string) view returns (string)',
  'function contractURI() view returns (string)',
]);
const extAbi = parseAbi(['function extsload(bytes32) view returns (bytes32)']);
const abs = x => (x < 0n ? -x : x);

// which tax platform launched this token on a chain (null = none); chains = where to look
export async function taxPlatformOf(token, chains = CHAIN_IDS) {
  for (const id of chains) {
    const r = await Promise.all(TAX_KEYS.map(k => fread(cfgOf(k, id), 'isLaunchToken', [token]).catch(() => false)));
    if (r.includes(true)) return { pf: TAX_KEYS[r.indexOf(true)], chainId: Number(id) };
  }
  return null;
}

export async function taxLaunchesBy(pf, id, wallet, fromBlock = 0n) {
  const P = cfgOf(pf, id);
  const from = fromBlock > P.start ? fromBlock : P.start;
  const logs = await getLogsOn(id, { address: P.factory, topics: [TOPIC_TAX_LAUNCHED, null, null, pad(wallet).toLowerCase()] }, from);
  return logs.map(l => ({ platform: pf, chainId: P.chainId, token: getAddress('0x' + l.topics[1].slice(26)), poolId: l.topics[2], deployer: getAddress(wallet), block: BigInt(l.blockNumber) }));
}

export async function taxLaunchBlock(pf, id, token) {
  const P = cfgOf(pf, id);
  const logs = await getLogsOn(id, { address: P.factory, topics: [TOPIC_TAX_LAUNCHED, pad(token).toLowerCase()] }, P.start);
  return logs.length ? BigInt(logs[0].blockNumber) : null;
}

export async function taxSummary(pf, id, token) {
  const P = cfgOf(pf, id);
  const client = P.client;
  token = getAddress(token);
  const rights = await fread(P, 'creatorRights', [token]);
  const slot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [rights.poolId, 6n])); // PoolManager pools mapping
  const [cfg, slot0, name, symbol, supply, image, meta, curi] = await Promise.all([
    client.readContract({ address: P.hook, abi: HOOK_ABI, functionName: 'poolConfig', args: [rights.poolId] }),
    client.readContract({ address: P.pm, abi: extAbi, functionName: 'extsload', args: [slot] }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'name' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'symbol' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'totalSupply' }),
    client.readContract({ address: token, abi: tokAbi, functionName: 'extraMetadata', args: ['image'] }).catch(() => ''),
    client.readContract({ address: token, abi: tokAbi, functionName: 'extraMetadata', args: ['metadata'] }).catch(() => ''),
    client.readContract({ address: token, abi: tokAbi, functionName: 'contractURI' }).catch(() => ''),
  ]);
  const tokenIs0 = cfg[1];
  const sq = Number(BigInt(slot0) & ((1n << 160n) - 1n)) / 2 ** 96;
  const p = sq * sq; // currency1 per currency0
  const priceEth = sq ? (tokenIs0 ? p : 1 / p) : null; // ETH pair, both 18 decimals
  let m = {};
  try { m = JSON.parse(meta || '{}'); } catch {}
  const fix = u => (/^https?:/.test(u) ? u : `https://${u}`);
  let soc = Object.fromEntries((m.socialMediaUrls || []).map(x => [x.platform === 'x' ? 'twitter' : x.platform, fix(x.url)]));
  // tokens launched on o1 itself keep everything in the contractURI JSON
  let cj = {};
  if (curi.startsWith('ipfs://') && (!image || !Object.keys(soc).length)) {
    try { cj = await fetch(`/api/ipfs/${curi.slice(7).split('/')[0]}`).then(x => x.json()); } catch {}
    if (!Object.keys(soc).length) soc = Object.fromEntries(Object.entries(cj.links || {}).filter(([, v]) => v).map(([k, v]) => [k, fix(v)]));
  }
  const tax = cfg[12];
  return {
    platform: pf, chainId: P.chainId, token, name, symbol, poolId: rights.poolId, tokenIs0, quote: cfg[3],
    deployer: rights.originalCreator, creator: rights.currentCreator, creatorFeeRecipient: rights.creatorFeeRecipient,
    buyTax: tax.buyTaxRate / 1e6, sellTax: tax.sellTaxRate / 1e6, supply,
    image: image || cj.image || '', description: m.description || cj.description || '', socials: soc,
    contractURI: curi, metadataEditable: rights.metadataEditable,
    priceEth, mcapEth: priceEth != null ? priceEth * Number(supply) / 1e18 : null,
  };
}

// swaps on the v4 pool → same shape as Pons curve trades (native ETH is always currency0)
export async function taxTrades(pf, id, poolId, tokenIs0, fromBlock, withTime = true) {
  const P = cfgOf(pf, id);
  const client = P.client;
  const raw = await getLogsOn(id, { address: P.pm, topics: [SWAP_TOPIC, poolId] }, fromBlock);
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

/* ---------- fees: credited to the escrow on every trade, per recipient, paid in ETH ---------- */
export const taxOwed = (pf, id, recipient) => clientOf(id).readContract({ address: cfgOf(pf, id).escrow, abi: ESCROW_ABI, functionName: 'owed', args: [recipient, zeroAddress] });
export const taxClaimTx = (pf, id, recipient) => ({ to: cfgOf(pf, id).escrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'claimFor', args: [recipient, zeroAddress] }) });

// shared with the check pages
export const TAX_TOPICS = {
  registered: '0xfafdbdd88ac30f0aa936e576be61816ea751908540523fa81b80c4a406ad7bec',       // hook PoolRegistered(poolId, originalCreator, creatorFeeRecipient)
  credited: '0x05a13effdcee25886a79b711b2d8d68cd0e07dbe24a5510dcf650ceed2428ec1',         // hook CreatorTaxCredited(poolId, recipient, currency, amount)
  recipientUpdated: '0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980', // factory CreatorFeeRecipientUpdated(token, prev, new)
};
export { FACTORY_ABI, HOOK_ABI, cfgOf };

