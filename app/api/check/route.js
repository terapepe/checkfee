import { isAddress } from 'viem';
import { checkWallet } from '../../../lib/pons';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ETH/USD spot from Coinbase; null if unavailable
async function getEthUsd() {
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { next: { revalidate: 60 } });
    const v = Number((await r.json())?.data?.amount);
    return v > 0 ? v : null;
  } catch { return null; }
}

export async function GET(req) {
  const wallet = new URL(req.url).searchParams.get('wallet')?.trim();
  if (!wallet || !isAddress(wallet, { strict: false })) {
    return Response.json({ error: 'Địa chỉ ví không hợp lệ' }, { status: 400 });
  }
  try {
    const [data, ethUsd] = await Promise.all([checkWallet(wallet), getEthUsd()]);
    return Response.json({ ...data, ethUsd });
  } catch (e) {
    return Response.json({ error: e?.shortMessage || e?.message || String(e), details: e?.details }, { status: 502 });
  }
}
