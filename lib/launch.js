// Launch a Pons v2 token: fee recipient = creator wallet (Pons splits the base fee 30/70); CheckFee charges a flat fee at launch
import { parseAbi, encodeFunctionData, decodeEventLog, toHex, zeroAddress, getAddress, parseAbiItem } from 'viem';
import { client, ADDR } from './pons';
import { SPLITTER_FACTORY, SPLITTER_SALT, SPLITTER_TREASURY } from './splitter';

// CheckFee service fee per launch (sent separately to the CheckFee wallet before the launch tx)
// CheckFee service fee per launch — switched off for now; set CHECKFEE_FEE_ON = true to charge it again
export const CHECKFEE_FEE_ON = false;
export const CHECKFEE_LAUNCH_FEE = 30_000_000_000_000n; // 0.00003 ETH

export const CHECKFEE_WALLET = SPLITTER_TREASURY;

export const ROUTER = '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948'; // PonsV2LaunchAndBuy
export const LAUNCH_CONFIG_ID = 0n;

const tokenParams = '(string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt)';
const factoryAbi = parseAbi([
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint256)',
  'function canLaunch(address) view returns (bool)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
  `function launchToken(${tokenParams} params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)`,
  // overload: + wallets exempted from the snipe tax at launch (max 32; the caller and the fee wallet are exempt anyway)
  `function launchToken(${tokenParams} params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)`,
  'function transferCreatorFeeRecipient(address token, address newRecipient)',
]);
// "Holders" fee destination (same as ponsfamily.com): a per-token distributor pays creator fees to holders
export const DISTRIBUTOR_FACTORY = '0x70e95CC5f03DB2906081E7a8D16e4C4209291507';
const distAbi = parseAbi(['function distributorOf(address token) view returns (address)', 'function createFor(address token) returns (address)']);
export const distributorOf = token => client.readContract({ address: DISTRIBUTOR_FACTORY, abi: distAbi, functionName: 'distributorOf', args: [token] });
export const createDistributorTx = token => ({ to: DISTRIBUTOR_FACTORY, data: encodeFunctionData({ abi: distAbi, functionName: 'createFor', args: [token] }) });
export const routeToTx = (token, recipient) => ({ to: ADDR.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: 'transferCreatorFeeRecipient', args: [token, recipient] }) });
const routerAbi = parseAbi([
  `function launchAndBuy(${tokenParams} params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable`,
]);
const splitterFactoryAbi = parseAbi(['function predict(address creator, bytes32 salt) view returns (address)', 'function deploy(address creator, bytes32 salt) returns (address)']);
const launchedEvent = parseAbiItem('event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)');
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export const predictSplitter = creator => client.readContract({
  address: SPLITTER_FACTORY, abi: splitterFactoryAbi, functionName: 'predict', args: [getAddress(creator), SPLITTER_SALT],
});

export async function readLaunchInfo(account) {
  const [launchFee, maxTax, can] = await Promise.all([
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'launchFee' }),
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'maxCreatorTaxBps' }),
    account ? client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'canLaunch', args: [account] }) : true,
  ]);
  return { launchFee, maxTaxBps: Number(maxTax), canLaunch: can };
}

// Build the launch tx. quoteIn > 0 → launchAndBuy router (first buy in the same tx, can't be front-run)
export const MAX_EXEMPT = 32; // MAX_SNIPE_TAX_EXEMPTIONS in the Pons factory
export async function buildLaunchTx({ account, form, logo, quoteIn, exempt = [] }) {
  if (exempt.length > MAX_EXEMPT) throw new Error(`Up to ${MAX_EXEMPT} whitelisted wallets`);
  // holders: the launcher receives fees first, then hands them to the distributor (2 txs after the launch)
  const payout = form.dest === 'holders' ? getAddress(account) : getAddress(form.payout);
  const [launchFee, expectedEconomics] = await Promise.all([
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'launchFee' }),
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'previewLaunchEconomics', args: [LAUNCH_CONFIG_ID, zeroAddress] }),
  ]);
  const params = {
    name: form.name.trim(), symbol: form.symbol.trim(), logo, description: form.description.trim(),
    socials: { twitter: form.twitter.trim(), telegram: form.telegram.trim(), discord: form.discord.trim(), website: form.website.trim(), farcaster: form.farcaster.trim() },
    creatorFeeRecipient: payout,
    creatorTaxBps: Math.round(Number(form.fee) * 100),
    buybackEnabled: form.dest === 'buyback',
    expectedEconomics,
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  let tx;
  if (quoteIn > 0n) {
    const mk = minOut => ({
      to: ROUTER, value: launchFee + quoteIn,
      data: encodeFunctionData({ abi: routerAbi, functionName: 'launchAndBuy', args: [params, LAUNCH_CONFIG_ID, zeroAddress, quoteIn, minOut, account, exempt] }),
    });
    // simulate to get the tokens received, set minTokensOut = 97% (3% slippage)
    const sim = await simulate(account, mk(0n));
    tx = mk(sim.tokensOut * 97n / 100n);
    tx.expectedTokens = sim.tokensOut;
  } else {
    tx = { to: ADDR.factory, value: launchFee, data: encodeFunctionData({ abi: factoryAbi, functionName: 'launchToken', args: exempt.length ? [params, LAUNCH_CONFIG_ID, zeroAddress, exempt] : [params, LAUNCH_CONFIG_ID, zeroAddress] }) };
    await simulate(account, tx);
  }
  return { ...tx, launchFee, params };
}

// eth_simulateV1 from the user's wallet: catch errors before signing + read tokens bought
async function simulate(account, tx) {
  const r = await client.request({
    method: 'eth_simulateV1',
    // simulated balance is enough to run; MetaMask will flag a real shortfall when signing
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Launch simulation failed: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
  const launched = parseLaunch(c.logs);
  let tokensOut = 0n;
  if (launched) {
    for (const l of c.logs) {
      if (l.address.toLowerCase() !== launched.token.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: [transferEvent], data: l.data, topics: l.topics });
        if (ev.args.to.toLowerCase() === account.toLowerCase()) tokensOut += ev.args.value;
      } catch {}
    }
  }
  return { tokensOut, launched };
}

export function parseLaunch(logs) {
  for (const l of logs || []) {
    if (l.address.toLowerCase() !== ADDR.factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: [launchedEvent], data: l.data, topics: l.topics });
      return { token: ev.args.token, curve: ev.args.curve };
    } catch {}
  }
  return null;
}

export const waitReceipt = hash => client.waitForTransactionReceipt({ hash, timeout: 120_000 });

// 90% wallet differs from the launcher: deploy the splitter first so every check page can detect it (creator() readable on-chain)
export async function needsSplitterDeploy(account, payout) {
  if (getAddress(account) === getAddress(payout)) return null;
  const splitter = await predictSplitter(payout);
  const code = await client.getCode({ address: splitter });
  if (code && code !== '0x') return null;
  return { to: SPLITTER_FACTORY, data: encodeFunctionData({ abi: splitterFactoryAbi, functionName: 'deploy', args: [getAddress(payout), SPLITTER_SALT] }) };
}
