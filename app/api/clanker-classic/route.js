// Clanker v0–v4 tokens a wallet deployed on Base (it is their admin), from clanker.world's public search.
// The browser can't call clanker.world (no CORS), so this route fetches every page and returns a compact list.
import { isAddress } from 'viem';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TYPES = new Set(['proxy', 'clanker', 'clanker_v2', 'clanker_v3', 'clanker_v3_1', 'clanker_v4']);
const PAGE = 50; // clanker.world caps limit at 50

const page = offset => q => fetch(`https://www.clanker.world/api/search-creator?q=${q}&limit=${PAGE}&offset=${offset}`, {
  headers: { accept: 'application/json', 'user-agent': 'CheckFee (+https://checkfee.vercel.app)' },
  signal: AbortSignal.timeout(20_000), next: { revalidate: 120 },
}).then(async r => {
  if (!r.ok) throw new Error(`clanker.world answered ${r.status}`);
  return r.json();
});

async function withRetry(fn, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i + 1 >= tries) throw e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
}

export async function GET(req) {
  const wallet = new URL(req.url).searchParams.get('wallet')?.trim();
  if (!wallet || !isAddress(wallet, { strict: false })) return Response.json({ error: 'Invalid wallet address' }, { status: 400 });
  try {
    const first = await withRetry(() => page(0)(wallet));
    const total = Number(first.total) || 0;
    const rest = [];
    // remaining pages, 4 at a time
    const offsets = [];
    for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
    for (let i = 0; i < offsets.length; i += 4) {
      const part = await Promise.all(offsets.slice(i, i + 4).map(o => withRetry(() => page(o)(wallet))));
      rest.push(...part);
    }
    const seen = new Set();
    const tokens = [first, ...rest].flatMap(p => p.tokens || [])
      .filter(t => t.chain_id === 8453 && TYPES.has(t.type))
      .filter(t => { const k = t.contract_address.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map(t => ({
        token: t.contract_address, name: t.name, symbol: t.symbol, type: t.type, admin: t.admin,
        locker: t.locker_address || null, positionId: t.position_id && t.position_id !== '0' ? String(t.position_id) : null,
        pool: t.pool_address || null, pair: t.pool_config?.pairedToken || null, deployedAt: t.deployed_at,
      }));
    return Response.json({ wallet, total, tokens });
  } catch (e) {
    return Response.json({ error: `Could not read clanker.world: ${e.message}` }, { status: 502 });
  }
}
