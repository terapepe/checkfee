// Lượt launch miễn phí checkfee: mỗi lần trả phí 0.00003 ETH = 1 lượt launch.
// Lượt chưa dùng = phí đã trả (đọc từ Blockscout) chưa được "tiêu" bởi một lần launch sau đó (TokenLaunched của ví).
import { getAddress, pad, toHex } from 'viem';
import { client, ADDR } from './pons';
import { CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET } from './launch';

const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
const TOPIC_LAUNCHED = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const CHUNK = 9_999_999n;
const LS = a => `checkfee_fee_paid_${a.toLowerCase()}`;

// Các block mà ví đã trả phí checkfee (giao dịch thành công, đúng số tiền)
async function feeBlocks(account) {
  const out = [];
  let q = 'filter=to';
  for (let page = 0; page < 20; page++) {
    const j = await fetch(`${BLOCKSCOUT}/addresses/${CHECKFEE_WALLET}/transactions?${q}`).then(r => r.json());
    for (const t of j.items || []) {
      if (t.from?.hash?.toLowerCase() === account.toLowerCase() && t.value === CHECKFEE_LAUNCH_FEE.toString() && t.status === 'ok') {
        out.push(BigInt(t.block_number));
      }
    }
    if (!j.next_page_params) break;
    q = 'filter=to&' + new URLSearchParams(j.next_page_params).toString();
  }
  return out;
}

async function launchBlocks(account, fromBlock) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let f = fromBlock; f <= latest; f += CHUNK + 1n) ranges.push([f, f + CHUNK > latest ? latest : f + CHUNK]);
  const logs = await Promise.all(ranges.map(([f, t]) => client.request({
    method: 'eth_getLogs',
    params: [{ address: ADDR.factory, fromBlock: toHex(f), toBlock: toHex(t), topics: [TOPIC_LAUNCHED, null, null, pad(account).toLowerCase()] }],
  })));
  return logs.flat().map(l => BigInt(l.blockNumber));
}

export const isCheckfeeWallet = account => getAddress(account) === getAddress(CHECKFEE_WALLET);

export async function launchCredits(account) {
  account = getAddress(account);
  if (isCheckfeeWallet(account)) return Infinity;
  let credits = 0;
  const fees = await feeBlocks(account);
  if (fees.length) {
    const launches = await launchBlocks(account, fees.reduce((a, b) => (a < b ? a : b)));
    // phí trước, launch sau (cùng block thì phí tính trước)
    const ev = [...fees.map(b => [b, 0]), ...launches.map(b => [b, 1])].sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] < y[0] ? -1 : 1));
    for (const [, kind] of ev) {
      if (kind === 0) credits++;
      else if (credits > 0) credits--;
    }
  }
  // Blockscout có thể index chậm: phí vừa trả trong phiên này (chưa launch) vẫn tính 1 lượt
  try { if (credits === 0 && localStorage.getItem(LS(account))) credits = 1; } catch {}
  return credits;
}

export function markFeePaid(account) { try { localStorage.setItem(LS(account), String(Date.now())); } catch {} }
export function clearFeePaid(account) { try { localStorage.removeItem(LS(account)); } catch {} }
