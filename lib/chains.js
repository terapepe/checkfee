// Networks CheckFee launches on: Robinhood Chain (Pons, Clanker, o1, Pangea), Base (Clanker, o1, Pangea), Ethereum + BNB Chain (Pangea)
import { createPublicClient, http, fallback, toHex } from 'viem';
import { base, mainnet, bsc } from 'viem/chains';
import { client as rhClient, chain as rhChain } from './pons';

const baseClient = createPublicClient({
  chain: base,
  batch: { multicall: { batchSize: 4_096, wait: 20 } },
  // public RPCs; publicnode serves eth_getLogs in 50k-block chunks over its last ~8M blocks (all our launchpads)
  transport: fallback(['https://base-rpc.publicnode.com', 'https://mainnet.base.org'].map(u => http(u, { retryCount: 3, retryDelay: 300 }))),
});

const pub = (chain, urls) => createPublicClient({
  chain, batch: { multicall: { batchSize: 4_096, wait: 20 } },
  transport: fallback(urls.map(u => http(u, { retryCount: 3, retryDelay: 300 }))),
});

export const CHAINS = {
  4663: {
    id: 4663, key: 'robinhood', name: 'Robinhood', sym: 'ETH', hex: '0x1237', client: rhClient,
    explorer: 'https://robinhoodchain.blockscout.com', logsVia: 'rpc',
    add: { chainId: '0x1237', chainName: 'Robinhood Chain', nativeCurrency: rhChain.nativeCurrency, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com'] },
  },
  8453: {
    id: 8453, key: 'base', name: 'Base', sym: 'ETH', hex: '0x2105', client: baseClient,
    explorer: 'https://base.blockscout.com', logsVia: 'chunk', rpcChunk: 49_999n, rpcConc: 6,
    // Base Blockscout's API answers "Too many requests" to anonymous callers, so every log comes from the RPC
    checkfeeFrom: 57_700_000n, // CheckFee started launching on Base
    add: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://base.blockscout.com'] },
  },
  // Pangea only: logs from the RPC in small chunks (public RPC range caps), only from a coin's launch block
  1: {
    id: 1, key: 'ethereum', name: 'Ethereum', sym: 'ETH', hex: '0x1',
    client: pub(mainnet, ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com']),
    explorer: 'https://eth.blockscout.com', logsVia: 'chunk', rpcChunk: 49_999n,
    add: { chainId: '0x1', chainName: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-rpc.publicnode.com'], blockExplorerUrls: ['https://etherscan.io'] },
  },
  56: {
    id: 56, key: 'bsc', name: 'BNB Chain', sym: 'BNB', hex: '0x38',
    client: pub(bsc, ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org']),
    explorer: 'https://bscscan.com', logsVia: 'chunk', rpcChunk: 49_999n,
    add: { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.bnbchain.org'], blockExplorerUrls: ['https://bscscan.com'] },
  },
};
export const CHAIN_IDS = [4663, 8453]; // Clanker / o1 networks
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

/* ---------- logs: Robinhood = RPC in 10M-block chunks, Base / Ethereum / BNB = RPC in 50k-block chunks ---------- */
const CHUNK = 9_999_999n;
async function rpcLogs(client, filter, fromBlock) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let f = fromBlock; f <= latest; f += CHUNK + 1n) ranges.push([f, f + CHUNK > latest ? latest : f + CHUNK]);
  const res = await Promise.all(ranges.map(([f, t]) => client.request({ method: 'eth_getLogs', params: [{ ...filter, fromBlock: toHex(f), toBlock: toHex(t) }] })));
  return res.flat();
}

// small fixed-size chunks (public RPC range caps), a few at a time
// one range, retried: a failed chunk must fail the scan, never read as "no logs"
async function chunkOnce(client, filter, f, t, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await client.request({ method: 'eth_getLogs', params: [{ ...filter, fromBlock: toHex(f), toBlock: toHex(t) }] }); }
    catch (e) { if (i + 1 >= tries) throw e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
  }
}
async function rpcChunkLogs(client, filter, fromBlock, chunk, conc = 4) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let f = fromBlock; f <= latest; f += chunk + 1n) ranges.push([f, f + chunk > latest ? latest : f + chunk]);
  const out = [];
  for (let i = 0; i < ranges.length; i += conc) {
    const part = await Promise.all(ranges.slice(i, i + conc).map(([f, t]) => chunkOnce(client, filter, f, t)));
    out.push(...part.flat());
  }
  return out;
}

export async function getLogsOn(id, filter, fromBlock) {
  const c = chainOf(id);
  const from = BigInt(fromBlock);
  if (c.logsVia === 'rpc') return rpcLogs(c.client, filter, from);
  return rpcChunkLogs(c.client, filter, from, c.rpcChunk, c.rpcConc);
}

// token holders from the chain's Blockscout (BNB Chain has none: unknown)
export async function holdersOn(id, token) {
  const ex = chainOf(id).explorer;
  if (!ex.includes('blockscout')) return null;
  const [info, list] = await Promise.all([
    fetch(`${ex}/api/v2/tokens/${token}`).then(r => r.json()).catch(() => ({})),
    fetch(`${ex}/api/v2/tokens/${token}/holders`).then(r => r.json()).catch(() => ({})),
  ]);
  return {
    count: Number(info.holders_count || info.holders || 0),
    items: (list.items || []).map(h => ({ address: h.address.hash, value: BigInt(h.value) })),
  };
}
