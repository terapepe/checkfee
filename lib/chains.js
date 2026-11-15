// Networks CheckFee launches on: Robinhood Chain (Pons, Clanker, o1) and Base (Clanker, o1)
import { createPublicClient, http, fallback, toHex } from 'viem';
import { base } from 'viem/chains';
import { client as rhClient, chain as rhChain } from './pons';

const baseClient = createPublicClient({
  chain: base,
  batch: { multicall: { batchSize: 4_096, wait: 20 } },
  // public RPCs; history logs come from Blockscout (public RPCs cap eth_getLogs ranges)
  transport: fallback(['https://base-rpc.publicnode.com', 'https://mainnet.base.org'].map(u => http(u, { retryCount: 3, retryDelay: 300 }))),
});

export const CHAINS = {
  4663: {
    id: 4663, key: 'robinhood', name: 'Robinhood', hex: '0x1237', client: rhClient,
    explorer: 'https://robinhoodchain.blockscout.com', logsVia: 'rpc',
    add: { chainId: '0x1237', chainName: 'Robinhood Chain', nativeCurrency: rhChain.nativeCurrency, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com'] },
  },
  8453: {
    id: 8453, key: 'base', name: 'Base', hex: '0x2105', client: baseClient,
    explorer: 'https://base.blockscout.com', logsVia: 'blockscout',
    add: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://base.blockscout.com'] },
  },
};
export const CHAIN_IDS = [4663, 8453];
export const chainOf = id => CHAINS[Number(id) || 4663] || CHAINS[4663];
export const clientOf = id => chainOf(id).client;

// MetaMask: switch, adding the network if the wallet doesn't know it yet
export async function switchChain(eth, id) {
  const c = chainOf(id);
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: c.hex }] }); }
  catch (e) {
    if (e.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
    await eth.request({ method: 'wallet_addEthereumChain', params: [c.add] });
  }
}

export const waitOn = (id, hash) => clientOf(id).waitForTransactionReceipt({ hash, timeout: 120_000 });
export const blockTimeOn = async (id, block) => Number((await clientOf(id).getBlock({ blockNumber: BigInt(block) })).timestamp);

/* ---------- logs: Robinhood = RPC in 10M-block chunks, Base = Blockscout (filters by topic, max 1000 per call) ---------- */
const CHUNK = 9_999_999n;
async function rpcLogs(client, filter, fromBlock) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let f = fromBlock; f <= latest; f += CHUNK + 1n) ranges.push([f, f + CHUNK > latest ? latest : f + CHUNK]);
  const res = await Promise.all(ranges.map(([f, t]) => client.request({ method: 'eth_getLogs', params: [{ ...filter, fromBlock: toHex(f), toBlock: toHex(t) }] })));
  return res.flat();
}

async function blockscoutLogs(explorer, filter, fromBlock) {
  const out = [];
  let from = BigInt(fromBlock);
  for (let page = 0; page < 30; page++) {
    const q = new URLSearchParams({ module: 'logs', action: 'getLogs', fromBlock: from.toString(), toBlock: 'latest', address: filter.address });
    const topics = filter.topics || [];
    const set = topics.map((t, i) => [i, t]).filter(([, t]) => t);
    for (const [i, t] of set) q.set(`topic${i}`, t);
    for (let a = 0; a < set.length; a++) for (let b = a + 1; b < set.length; b++) q.set(`topic${set[a][0]}_${set[b][0]}_opr`, 'and');
    const j = await fetch(`${explorer}/api?${q}`).then(r => r.json());
    const items = Array.isArray(j.result) ? j.result : [];
    out.push(...items);
    if (items.length < 1000) break;
    from = BigInt(items[items.length - 1].blockNumber) + 1n; // next page (may re-read nothing: last block boundary)
  }
  // dedupe (tx + logIndex) and normalise to the RPC shape
  const seen = new Set();
  return out.filter(l => { const k = l.transactionHash + l.logIndex; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => ({ ...l, topics: (l.topics || []).filter(Boolean), blockNumber: toHex(BigInt(l.blockNumber)), logIndex: toHex(BigInt(l.logIndex || 0)) }));
}

export function getLogsOn(id, filter, fromBlock) {
  const c = chainOf(id);
  return c.logsVia === 'rpc' ? rpcLogs(c.client, filter, BigInt(fromBlock)) : blockscoutLogs(c.explorer, filter, fromBlock);
}

// token holders from the chain's Blockscout
export async function holdersOn(id, token) {
  const ex = chainOf(id).explorer;
  const [info, list] = await Promise.all([
    fetch(`${ex}/api/v2/tokens/${token}`).then(r => r.json()).catch(() => ({})),
    fetch(`${ex}/api/v2/tokens/${token}/holders`).then(r => r.json()).catch(() => ({})),
  ]);
  return {
    count: Number(info.holders_count || info.holders || 0),
    items: (list.items || []).map(h => ({ address: h.address.hash, value: BigInt(h.value) })),
  };
}
