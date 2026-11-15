// Check Clanker v5 creator fees on Robinhood: tokens of a wallet / by CA, fees earned, claimable (escrow.owed)
import { getAddress, pad, parseAbi, decodeAbiParameters, zeroAddress } from 'viem';
import { TaxLaunchHook_abi, TaxRWAERC20LaunchpadFactory_abi } from 'clanker-sdk/v5';
import { client } from './pons';
import { CLANKER, TOPIC_CLANKER_LAUNCHED, clankerOwed } from './clanker';
import { getLogsChunked } from './market';

const START = 106_650_000n; // Clanker hook/factory deployed on Robinhood Chain
const T = {
  registered: '0xfafdbdd88ac30f0aa936e576be61816ea751908540523fa81b80c4a406ad7bec',       // hook PoolRegistered(poolId, originalCreator, creatorFeeRecipient)
  credited: '0x05a13effdcee25886a79b711b2d8d68cd0e07dbe24a5510dcf650ceed2428ec1',         // hook CreatorTaxCredited(poolId, recipient, currency, amount)
  recipientUpdated: '0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980', // factory CreatorFeeRecipientUpdated(token, prev, new)
};
const tokAbi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']);

// sum of ETH fees credited per poolId
function earnedByPool(logs) {
  const m = new Map();
  for (const l of logs) {
    const [currency, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], l.data);
    if (currency !== zeroAddress) continue;
    m.set(l.topics[1], (m.get(l.topics[1]) || 0n) + amount);
  }
  return m;
}

async function poolInfo(poolId) {
  const cfg = await client.readContract({ address: CLANKER.hook, abi: TaxLaunchHook_abi, functionName: 'poolConfig', args: [poolId] });
  const token = cfg[2];
  const [name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: tokAbi, functionName: 'name' }).catch(() => '?'),
    client.readContract({ address: token, abi: tokAbi, functionName: 'symbol' }).catch(() => '?'),
  ]);
  return { platform: 'clanker', token, poolId, name, symbol, creator: cfg[4], recipient: cfg[5] };
}

const poolIdOf = async token => (await client.readContract({ address: CLANKER.factory, abi: TaxRWAERC20LaunchpadFactory_abi, functionName: 'creatorRights', args: [token] })).poolId;

export async function checkClankerWallet(wallet) {
  wallet = getAddress(wallet);
  const w = pad(wallet).toLowerCase();
  const [reg, launched, upd, credited, owed] = await Promise.all([
    getLogsChunked({ address: CLANKER.hook, topics: [T.registered, null, null, w] }, START),
    getLogsChunked({ address: CLANKER.factory, topics: [TOPIC_CLANKER_LAUNCHED, null, null, w] }, START),
    getLogsChunked({ address: CLANKER.factory, topics: [T.recipientUpdated, null, null, w] }, START),
    getLogsChunked({ address: CLANKER.hook, topics: [T.credited, null, w] }, START),
    clankerOwed(wallet),
  ]);
  const earned = earnedByPool(credited);
  const pools = new Set([...reg.map(l => l.topics[1]), ...launched.map(l => l.topics[2]), ...earned.keys()]);
  for (const id of await Promise.all(upd.map(l => poolIdOf(getAddress('0x' + l.topics[1].slice(26)))))) pools.add(id);
  const tokens = await Promise.all([...pools].map(async id => ({ ...(await poolInfo(id)), earned: earned.get(id) || 0n })));
  // current recipient first, then most earned
  tokens.sort((a, b) => (b.recipient === wallet) - (a.recipient === wallet) || (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : 0));
  return { platform: 'clanker', wallet, owed, tokens };
}

export async function checkClankerTokens(cas) {
  const tokens = await Promise.all(cas.map(async ca => {
    try {
      const info = await poolInfo(await poolIdOf(getAddress(ca)));
      const logs = await getLogsChunked({ address: CLANKER.hook, topics: [T.credited, info.poolId, pad(info.recipient).toLowerCase()] }, START);
      return { ...info, earned: earnedByPool(logs).get(info.poolId) || 0n };
    } catch (e) { return { platform: 'clanker', token: ca, error: e.shortMessage || e.message }; }
  }));
  const recips = [...new Set(tokens.filter(t => !t.error).map(t => t.recipient))];
  const recipients = await Promise.all(recips.map(async r => ({ wallet: r, owed: await clankerOwed(r) })));
  return { platform: 'clanker', tokens, recipients };
}
