// Launch a Clanker v5 (Tax factory) token on Robinhood Chain, using the official clanker-sdk.
// Fee recipient = the creator fee wallet (single reward slot, 100%); CheckFee only charges the flat launch fee.
import { Clanker, TAX_ADDRESSES, TaxRWAERC20LaunchpadFactory_abi } from 'clanker-sdk/v5';
import { encodeFunctionData, decodeEventLog, formatEther, getAddress, toHex } from 'viem';
import { client } from './pons';

export const CLANKER = TAX_ADDRESSES[4663]; // factory 0xcA111dcd…bcA16
export const CLANKER_FEE_PCT = 1; // buy & sell tax (%, includes Clanker's cut) — SDK default
export const clankerUrl = token => `https://www.clanker.world/clanker/${token}`;

const sdk = () => new Clanker({ publicClient: client, chainId: 4663 });
const read = functionName => client.readContract({ address: CLANKER.factory, abi: TaxRWAERC20LaunchpadFactory_abi, functionName });

export async function readClankerInfo() {
  const [launchFee, enabled] = await Promise.all([read('nativeLaunchFee'), read('launchCreationEnabled')]);
  return { launchFee, canLaunch: enabled };
}

const SOCIALS = [['twitter', 'x'], ['telegram', 'telegram'], ['website', 'website'], ['discord', 'discord'], ['farcaster', 'farcaster']];

export async function buildClankerTx({ account, form, image, quoteIn }) {
  account = getAddress(account);
  const payout = getAddress(form.payout);
  const token = {
    name: form.name.trim(),
    symbol: form.symbol.trim(),
    image,
    metadata: {
      description: form.description.trim(),
      socialMediaUrls: SOCIALS.filter(([k]) => form[k]?.trim()).map(([k, platform]) => ({ platform, url: form[k].trim() })),
    },
    context: { interface: 'CheckFee' },
    buyFee: CLANKER_FEE_PCT,
    sellFee: CLANKER_FEE_PCT,
    // one reward slot: 100% to the fee wallet, admin = launching wallet (can change the recipient later)
    rewards: { recipients: [{ recipient: payout, admin: account, bps: 10_000 }] },
    ...(quoteIn > 0n ? { devBuy: { ethAmount: formatEther(quoteIn) } } : {}),
  };
  // reads config, mines the …cccc salt, builds the route + minOut for the first buy
  const t = await sdk().getDeployTransaction(token, { account });
  const tx = { to: t.address, value: t.value, data: encodeFunctionData({ abi: t.abi, functionName: t.functionName, args: t.args }), expected: t.expectedAddress };
  await simulate(account, tx);
  return tx;
}

async function simulate(account, tx) {
  const r = await client.request({
    method: 'eth_simulateV1',
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Launch simulation failed: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
  return parseClankerLaunch(c.logs);
}

export function parseClankerLaunch(logs) {
  for (const l of logs || []) {
    if (l.address.toLowerCase() !== CLANKER.factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: TaxRWAERC20LaunchpadFactory_abi, data: l.data, topics: l.topics });
      if (ev.eventName === 'Launched') return { token: ev.args.token };
    } catch {}
  }
  return null;
}
