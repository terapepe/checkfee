// Tell Pangea a coin was opened on Solana from CheckFee (its Launch API reads the coin record itself). Best effort.
export const dynamic = 'force-dynamic';
export async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!/^0x[0-9a-fA-F]{64}$/.test(b?.coinId || '')) return Response.json({ error: 'Invalid coinId' }, { status: 400 });
  try {
    const r = await fetch('https://www.pangea.trade/api/v1/launch/v4/registered', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'solana', coinId: b.coinId }),
      signal: AbortSignal.timeout(20_000),
    });
    return Response.json({ status: r.status, answer: await r.json().catch(() => null) });
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
