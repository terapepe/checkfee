// Server-side list of tokens launched through this site (Supabase table checkfee_launches, server-only access)
// GET  → all launches, newest first
// POST { chainId, platform, token, poolId?, curve?, deployer, block, txHash } → record a launch (checked against the tx receipt when the chain RPC is reachable)
export const dynamic = 'force-dynamic';

const SB_URL = process.env.SUPABASE_URL || 'https://qwlpnyjlovdujxpewrip.supabase.co';
// writes (server only): accept the usual names for the Supabase secret / service-role key
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
// reads: public publishable key (the table has a read-only policy)
const SB_READ = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mKIcOZZJCVrJh4nBgicYiQ_Ev2C_kph';
const TABLE = `${SB_URL}/rest/v1/checkfee_launches`;
// write with the secret key when configured, else the publishable key (table policy only accepts well-formed rows)
const sbHeaders = () => { const k = SB_KEY || SB_READ; return { apikey: k, ...(SB_KEY ? { Authorization: `Bearer ${k}` } : {}), 'content-type': 'application/json' }; };

const RPC = { 4663: 'https://rpc.mainnet.chain.robinhood.com', 8453: 'https://mainnet.base.org', 1: 'https://ethereum-rpc.publicnode.com', 56: 'https://bsc-rpc.publicnode.com' };
// factories whose launch events count
const FACTORIES = {
  4663: { pons: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', clanker: '0xca111dcdd2ce924c3378d6514fdcbc46217bca16', o1: '0x29cad997f3cf1aa9ca51e12be29c09e3e00f119a', pangea: '0xaa61764bd44df5468caae856232ce9b711512449' },
  8453: { clanker: '0x572e88d3cd7f23e4241eb6cedd96667271bf09a0', o1: '0x53c59d8d335681d58f564cf62073fa3c57cf81ee', pangea: '0xaa61764bd44df5468caae856232ce9b711512449' },
  // Pangea v4 LaunchCoreV4: same address on every EVM chain
  1: { pangea: '0xaa61764bd44df5468caae856232ce9b711512449' },
  56: { pangea: '0xaa61764bd44df5468caae856232ce9b711512449' },
};
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const isHash = h => /^0x[0-9a-fA-F]{64}$/.test(h || '');

export async function GET(req) {
  // /api/launches?status → is the write key configured on the server?
  // names only (never values) of the Supabase variables this deployment sees
  if (new URL(req.url).searchParams.has('status')) return Response.json({ canRecord: true, secretKey: !!SB_KEY, supabaseVars: Object.keys(process.env).filter(k => /SUPABASE/i.test(k)).sort(), env: process.env.VERCEL_ENV || null });
  const r = await fetch(`${TABLE}?select=chain_id,token,platform,pool_id,curve,deployer,block,tx_hash&order=block.desc&limit=5000`, { headers: { apikey: SB_READ }, cache: 'no-store' });
  if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
  return Response.json(await r.json(), { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } });
}

// true = launch confirmed, false = receipt says no, null = RPC not reachable from here
async function verify(b) {
  try {
    const r = await fetch(RPC[b.chainId], {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [b.txHash] }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const rc = (await r.json()).result;
    if (!rc) return null; // not indexed yet / unknown → don't block
    const fac = FACTORIES[b.chainId][b.platform];
    const tok = b.token.toLowerCase().slice(2);
    return rc.status === '0x1' && rc.logs.some(l => l.address.toLowerCase() === fac && l.topics.some(t => t.toLowerCase().endsWith(tok)));
  } catch { return null; }
}

export async function POST(req) {
  const b = await req.json().catch(() => null);
  const chainId = Number(b?.chainId);
  if (!b || !FACTORIES[chainId] || !FACTORIES[chainId][b.platform] || !isAddr(b.token) || !isHash(b.txHash) || (b.deployer && !isAddr(b.deployer)))
    return Response.json({ error: 'Invalid launch record' }, { status: 400 });
  const ok = await verify({ ...b, chainId });
  if (ok === false) return Response.json({ error: 'Transaction is not a launch of this token' }, { status: 400 });
  const row = {
    chain_id: chainId, token: b.token.toLowerCase(), platform: b.platform,
    pool_id: /^0x[0-9a-fA-F]{64}$/.test(b.poolId || '') ? b.poolId : null, curve: isAddr(b.curve) ? b.curve.toLowerCase() : null,
    deployer: b.deployer ? b.deployer.toLowerCase() : null, block: /^\d+$/.test(String(b.block || '')) ? String(b.block) : null, tx_hash: b.txHash,
  };
  const r = await fetch(`${TABLE}?on_conflict=chain_id,token`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row),
  });
  if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
  return Response.json({ ok: true, verified: ok === true });
}
