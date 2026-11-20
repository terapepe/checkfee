// Check creator fees on the tax launchpads (Clanker, o1): tokens of a wallet / by CA, fees earned, claimable (escrow.owed)
import { getAddress, pad, parseAbi, decodeAbiParameters, zeroAddress } from 'viem';
import { TOPIC_TAX_LAUNCHED, TAX_TOPICS as T, FACTORY_ABI, HOOK_ABI, taxOwed, cfgOf } from './tax';
import { getLogsOn } from './chains';

const tokAbi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']);

// sum of ETH fees credited per poolId
function earnedByPool(logs) {
  const m = new Map();
  for (const l of logs) {
    const [currency, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], l.data);
    if (currency !== zeroAddress) continue;
    m.set(l.topics[1], (m.get(l.topics[1]) || 0n) + amount);
  }
  return m;
}

async function poolInfo(pf, id, poolId) {
  const { client, hook } = cfgOf(pf, id);
  const cfg = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'poolConfig', args: [poolId] });
  const token = cfg[2];
  const [name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: tokAbi, functionName: 'name' }).catch(() => '?'),
    client.readContract({ address: token, abi: tokAbi, functionName: 'symbol' }).catch(() => '?'),
  ]);
  return { platform: pf, chainId: Number(id), token, poolId, name, symbol, creator: cfg[4], recipient: cfg[5] };
}

const poolIdOf = async (pf, id, token) => (await cfgOf(pf, id).client.readContract({ address: cfgOf(pf, id).factory, abi: FACTORY_ABI, functionName: 'creatorRights', args: [token] })).poolId;

// Many wallets at once (the multi-wallet page): one log scan per platform + network with every wallet in the
// topic filter, instead of four scans per wallet. checkTaxWallet then reads its logs from here.
const prefetched = new Map(); // `${pf}:${id}` → { at, ws, A, C }
const lc = a => a.toLowerCase();
export async function prefetchTaxWallets(pf, wallets, id = 4663) {
  const P = cfgOf(pf, id);
  const ws = [...new Set(wallets.map(x => lc(pad(getAddress(x)))))];
  const A = [], C = [];
  for (let i = 0; i < ws.length; i += 50) {
    const part = ws.slice(i, i + 50);
    const [a, c] = await Promise.all([
      getLogsOn(id, { address: [P.hook, P.factory], topics: [[T.registered, TOPIC_TAX_LAUNCHED, T.recipientUpdated], null, null, part] }, P.start),
      getLogsOn(id, { address: P.hook, topics: [T.credited, null, part] }, P.start),
    ]);
    A.push(...a); C.push(...c);
  }
  prefetched.set(`${pf}:${id}`, { at: Date.now(), ws: new Set(ws), A, C });
}

async function walletLogs(pf, id, P, w) {
  const c = prefetched.get(`${pf}:${id}`);
  if (c && c.ws.has(w) && Date.now() - c.at < 15 * 60_000) {
    const pick = (addr, t0, i) => c.A.filter(l => lc(l.address) === lc(addr) && lc(l.topics[0]) === t0 && lc(l.topics[i] || '') === w);
    return [pick(P.hook, T.registered, 3), pick(P.factory, TOPIC_TAX_LAUNCHED, 3), pick(P.factory, T.recipientUpdated, 3), c.C.filter(l => lc(l.topics[2] || '') === w)];
  }
  return Promise.all([
    getLogsOn(id, { address: [P.hook, P.factory], topics: [[T.registered, TOPIC_TAX_LAUNCHED, T.recipientUpdated], null, null, w] }, P.start),
    getLogsOn(id, { address: P.hook, topics: [T.credited, null, w] }, P.start),
  ]).then(([a, cr]) => {
    const pick = (addr, t0) => a.filter(l => lc(l.address) === lc(addr) && lc(l.topics[0]) === t0);
    return [pick(P.hook, T.registered), pick(P.factory, TOPIC_TAX_LAUNCHED), pick(P.factory, T.recipientUpdated), cr];
  });
}

export async function checkTaxWallet(pf, wallet, id = 4663) {
  const P = cfgOf(pf, id);
  wallet = getAddress(wallet);
  const w = lc(pad(wallet));
  const [[reg, launched, upd, credited], owed] = await Promise.all([walletLogs(pf, id, P, w), taxOwed(pf, id, wallet)]);
  const earned = earnedByPool(credited);
  const pools = new Set([...reg.map(l => l.topics[1]), ...launched.map(l => l.topics[2]), ...earned.keys()]);
  for (const id of await Promise.all(upd.map(l => poolIdOf(pf, id, getAddress('0x' + l.topics[1].slice(26)))))) pools.add(id);
  const tokens = await Promise.all([...pools].map(async id => ({ ...(await poolInfo(pf, P.chainId, id)), earned: earned.get(id) || 0n })));
  // current recipient first, then most earned
  tokens.sort((a, b) => (b.recipient === wallet) - (a.recipient === wallet) || (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : 0));
  return { platform: pf, chainId: P.chainId, wallet, owed, tokens };
}

export async function checkTaxTokens(pf, cas, id = 4663) {
  const P = cfgOf(pf, id);
  const getLogsChunked = (f, from) => getLogsOn(id, f, from);
  const tokens = await Promise.all(cas.map(async ca => {
    try {
      const info = await poolInfo(pf, id, await poolIdOf(pf, id, getAddress(ca)));
      const logs = await getLogsChunked({ address: P.hook, topics: [T.credited, info.poolId, pad(info.recipient).toLowerCase()] }, P.start);
      return { ...info, earned: earnedByPool(logs).get(info.poolId) || 0n };
    } catch (e) { return { platform: pf, token: ca, error: e.shortMessage || e.message }; }
  }));
  const recips = [...new Set(tokens.filter(t => !t.error).map(t => t.recipient))];
  const recipients = await Promise.all(recips.map(async r => ({ wallet: r, owed: await taxOwed(pf, id, r) })));
  return { platform: pf, chainId: P.chainId, tokens, recipients };
}
