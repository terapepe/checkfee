export const revalidate = 60;

// ETH/USD spot từ Coinbase
export async function GET() {
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { next: { revalidate: 60 } });
    const v = Number((await r.json())?.data?.amount);
    return Response.json({ ethUsd: v > 0 ? v : null });
  } catch {
    return Response.json({ ethUsd: null });
  }
}
