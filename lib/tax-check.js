// Check creator fees on the tax launchpads (Clanker, o1): tokens of a wallet / by CA, fees earned, claimable (escrow.owed)
import { getAddress, pad, parseAbi, decodeAbiParameters, zeroAddress } from 'viem';
import { client } from './pons';
import { TAX, TOPIC_TAX_LAUNCHED, TAX_TOPICS as T, FACTORY_ABI, HOOK_ABI, taxOwed } from './tax';
import { getLogsChunked } from './market';

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

async function poolInfo(pf, poolId) {
  const cfg = await client.readContract({ address: TAX[pf].hook, abi: HOOK_ABI, functionName: 'poolConfig', args: [poolId] });
  const token = cfg[2];
  const [name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: tokAbi, functionName: 'name' }).catch(() => '?'),
    client.readContract({ address: token, abi: tokAbi, functionName: 'symbol' }).catch(() => '?'),
  ]);
  return { platform: pf, token, poolId, name, symbol, creator: cfg[4], recipient: cfg[5] };
}

const poolIdOf = async (pf, token) => (await client.readContract({ address: TAX[pf].factory, abi: FACTORY_ABI, functionName: 'creatorRights', args: [token] })).poolId;

export async function checkTaxWallet(pf, wallet) {
  const P = TAX[pf];
  wallet = getAddress(wallet);
  const w = pad(wallet).toLowerCase();
  const [reg, launched, upd, credited, owed] = await Promise.all([
    getLogsChunked({ address: P.hook, topics: [T.registered, null, null, w] }, P.start),
    getLogsChunked({ address: P.factory, topics: [TOPIC_TAX_LAUNCHED, null, null, w] }, P.start),
    getLogsChunked({ address: P.factory, topics: [T.recipientUpdated, null, null, w] }, P.start),
    getLogsChunked({ address: P.hook, topics: [T.credited, null, w] }, P.start),
    taxOwed(pf, wallet),
  ]);
  const earned = earnedByPool(credited);
  const pools = new Set([...reg.map(l => l.topics[1]), ...launched.map(l => l.topics[2]), ...earned.keys()]);
  for (const id of await Promise.all(upd.map(l => poolIdOf(pf, getAddress('0x' + l.topics[1].slice(26)))))) pools.add(id);
  const tokens = await Promise.all([...pools].map(async id => ({ ...(await poolInfo(pf, id)), earned: earned.get(id) || 0n })));
  // current recipient first, then most earned
  tokens.sort((a, b) => (b.recipient === wallet) - (a.recipient === wallet) || (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : 0));
  return { platform: pf, wallet, owed, tokens };
}

export async function checkTaxTokens(pf, cas) {
  const P = TAX[pf];
  const tokens = await Promise.all(cas.map(async ca => {
    try {
      const info = await poolInfo(pf, await poolIdOf(pf, getAddress(ca)));
      const logs = await getLogsChunked({ address: P.hook, topics: [T.credited, info.poolId, pad(info.recipient).toLowerCase()] }, P.start);
      return { ...info, earned: earnedByPool(logs).get(info.poolId) || 0n };
    } catch (e) { return { platform: pf, token: ca, error: e.shortMessage || e.message }; }
  }));
  const recips = [...new Set(tokens.filter(t => !t.error).map(t => t.recipient))];
  const recipients = await Promise.all(recips.map(async r => ({ wallet: r, owed: await taxOwed(pf, r) })));
  return { platform: pf, tokens, recipients };
}
