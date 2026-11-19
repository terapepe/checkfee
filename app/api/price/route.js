export const revalidate = 60;

// ETH/USD and BNB/USD spot from Coinbase
const spot = async pair => {
  try {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`, { next: { revalidate: 60 } });
    const v = Number((await r.json())?.data?.amount);
    return v > 0 ? v : null;
  } catch { return null; }
};
export async function GET() {
  const [ethUsd, bnbUsd] = await Promise.all([spot('ETH-USD'), spot('BNB-USD')]);
  return Response.json({ ethUsd, bnbUsd });
}
