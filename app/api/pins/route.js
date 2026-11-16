// TEMPORARY (backfill): CIDs pinned by this site's Pinata account since a date. Remove after use.
export const dynamic = 'force-dynamic';
const JWT = process.env.PINATA_JWT;

export async function GET(req) {
  if (!JWT) return Response.json({ error: 'Server is missing PINATA_JWT' }, { status: 500 });
  const since = new URL(req.url).searchParams.get('since') || '2026-11-15T17:00:00Z';
  const out = [];
  for (let off = 0; off < 10000; off += 1000) {
    const q = new URLSearchParams({ status: 'pinned', pageLimit: '1000', pageOffset: String(off), pinStart: since });
    const r = await fetch(`https://api.pinata.cloud/data/pinList?${q}`, { headers: { Authorization: `Bearer ${JWT}` }, cache: 'no-store' });
    if (!r.ok) return Response.json({ error: `Pinata HTTP ${r.status}` }, { status: 502 });
    const rows = (await r.json()).rows || [];
    out.push(...rows.map(x => [x.ipfs_pin_hash, x.date_pinned, x.metadata?.name || '']));
    if (rows.length < 1000) break;
  }
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
}
