// CheckFee launch credits: each 0.00003 ETH fee payment = 1 launch.
// Unused credit = a paid fee (read from Blockscout) not yet consumed by a later launch (the wallet's TokenLaunched).
import { getAddress, pad, toHex } from 'viem';
import { client, ADDR } from './pons';
import { CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET } from './launch';

const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
const TOPIC_LAUNCHED = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
import { TAX_KEYS, TOPIC_TAX_LAUNCHED, cfgOf } from './tax';
import { chainOf, getLogsOn } from './chains';
// credits are per chain: a fee paid on Base pays for a launch on Base
const CHUNK = 9_999_999n;
const LS = (a, id = 4663) => `checkfee_fee_paid_${a.toLowerCase()}${Number(id) === 4663 ? '' : `_${id}`}`;

// Blocks where the wallet paid the CheckFee fee (successful tx, exact amount)
async function feeBlocks(account, id) {
  const api = `${chainOf(id).explorer}/api/v2`;
  const out = [];
  let q = 'filter=to';
  for (let page = 0; page < 20; page++) {
    const j = await fetch(`${api}/addresses/${CHECKFEE_WALLET}/transactions?${q}`).then(r => r.json());
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

async function launchBlocks(account, fromBlock, id) {
  const scan = (address, topic) => getLogsOn(id, { address, topics: [topic, null, null, pad(account).toLowerCase()] }, fromBlock);
  // a launch on any platform of this chain (Pons on Robinhood, Clanker, o1) uses one credit
  const logs = await Promise.all([
    ...(Number(id) === 4663 ? [scan(ADDR.factory, TOPIC_LAUNCHED)] : []),
    ...TAX_KEYS.map(k => scan(cfgOf(k, id).factory, TOPIC_TAX_LAUNCHED)),
  ]);
  return logs.flat().map(l => BigInt(l.blockNumber));
}

export const isCheckfeeWallet = account => getAddress(account) === getAddress(CHECKFEE_WALLET);

export async function launchCredits(account, id = 4663) {
  account = getAddress(account);
  if (isCheckfeeWallet(account)) return Infinity;
  let credits = 0;
  const fees = await feeBlocks(account, id);
  if (fees.length) {
    const launches = await launchBlocks(account, fees.reduce((a, b) => (a < b ? a : b)), id);
    // fee first, launch after (same block: fee counts first)
    const ev = [...fees.map(b => [b, 0]), ...launches.map(b => [b, 1])].sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] < y[0] ? -1 : 1));
    for (const [, kind] of ev) {
      if (kind === 0) credits++;
      else if (credits > 0) credits--;
    }
  }
  // Blockscout may index late: a fee just paid in this session (not launched yet) still counts as 1 credit
  try { if (credits === 0 && localStorage.getItem(LS(account, id))) credits = 1; } catch {}
  return credits;
}

export function markFeePaid(account, id) { try { localStorage.setItem(LS(account, id), String(Date.now())); } catch {} }
export function clearFeePaid(account, id) { try { localStorage.removeItem(LS(account, id)); } catch {} }
