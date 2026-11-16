// Shared "Following" list (Supabase table checkfee_following): one list for everyone.
// GET                       → all followed tokens, newest first
// GET ?chain=…&token=…      → { following: bool }
// POST { action: 'follow'|'unfollow', wallet, chainId, platform, token, poolId?, curve?, deployer?, block? }
export const dynamic = 'force-dynamic';

const SB_URL = process.env.SUPABASE_URL || 'https://qwlpnyjlovdujxpewrip.supabase.co';
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const SB_READ = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mKIcOZZJCVrJh4nBgicYiQ_Ev2C_kph';
const TABLE = `${SB_URL}/rest/v1/checkfee_following`;
const sbHeaders = () => { const k = SB_KEY || SB_READ; return { apikey: k, ...(SB_KEY ? { Authorization: `Bearer ${k}` } : {}), 'content-type': 'application/json' }; };

const PLATFORMS = { 4663: ['pons', 'clanker', 'o1'], 8453: ['clanker', 'o1'] };
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const token = q.get('token'), chain = Number(q.get('chain'));
  if (token) {
    if (!isAddr(token) || !PLATFORMS[chain]) return Response.json({ error: 'Invalid token' }, { status: 400 });
    const r = await fetch(`${TABLE}?select=token&chain_id=eq.${chain}&token=eq.${token.toLowerCase()}`, { headers: { apikey: SB_READ }, cache: 'no-store' });
    if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
    return Response.json({ following: (await r.json()).length > 0 });
  }
  const r = await fetch(`${TABLE}?select=chain_id,token,platform,pool_id,curve,deployer,block,followed_by,created_at&order=created_at.desc&limit=2000`, { headers: { apikey: SB_READ }, cache: 'no-store' });
  if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
  return Response.json(await r.json());
}

export async function POST(req) {
  const b = await req.json().catch(() => null);
  const chainId = Number(b?.chainId);
  if (!b || !['follow', 'unfollow'].includes(b.action) || !isAddr(b.wallet) || !isAddr(b.token) || !PLATFORMS[chainId]?.includes(b.platform))
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  const token = b.token.toLowerCase();
  if (b.action === 'unfollow') {
    const r = await fetch(`${TABLE}?chain_id=eq.${chainId}&token=eq.${token}`, { method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' } });
    if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
    return Response.json({ ok: true, following: false });
  }
  const row = {
    chain_id: chainId, token, platform: b.platform, followed_by: b.wallet.toLowerCase(),
    pool_id: /^0x[0-9a-fA-F]{64}$/.test(b.poolId || '') ? b.poolId : null, curve: isAddr(b.curve) ? b.curve.toLowerCase() : null,
    deployer: isAddr(b.deployer) ? b.deployer.toLowerCase() : null, block: /^\d{1,12}$/.test(String(b.block ?? '')) ? String(b.block) : null,
  };
  const r = await fetch(`${TABLE}?on_conflict=chain_id,token`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row),
  });
  if (!r.ok) return Response.json({ error: `Supabase HTTP ${r.status}` }, { status: 502 });
  return Response.json({ ok: true, following: true });
}
