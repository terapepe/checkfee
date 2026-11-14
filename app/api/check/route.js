import { isAddress } from 'viem';
import { checkWallet } from '../../../lib/pons';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  const wallet = new URL(req.url).searchParams.get('wallet')?.trim();
  if (!wallet || !isAddress(wallet, { strict: false })) {
    return Response.json({ error: 'Địa chỉ ví không hợp lệ' }, { status: 400 });
  }
  try {
    return Response.json(await checkWallet(wallet));
  } catch (e) {
    return Response.json({ error: e?.shortMessage || e?.message || String(e) }, { status: 502 });
  }
}
