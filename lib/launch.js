// Launch token Pons v2 với ví nhận phí = CheckfeeSplitter (90% creator / 10% checkfee)
import { parseAbi, encodeFunctionData, decodeEventLog, toHex, zeroAddress, getAddress, parseAbiItem } from 'viem';
import { client, ADDR } from './pons';
import { SPLITTER_FACTORY, SPLITTER_SALT } from './splitter';

export const ROUTER = '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948'; // PonsV2LaunchAndBuy
export const LAUNCH_CONFIG_ID = 0n;

const tokenParams = '(string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt)';
const factoryAbi = parseAbi([
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint256)',
  'function canLaunch(address) view returns (bool)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
  `function launchToken(${tokenParams} params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)`,
]);
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

// Dựng giao dịch launch. quoteIn > 0 → router launchAndBuy (mua đầu trong cùng tx, không bị front-run)
export async function buildLaunchTx({ account, form, logo, quoteIn }) {
  const payout = getAddress(form.payout);
  const [splitter, launchFee, expectedEconomics] = await Promise.all([
    predictSplitter(payout),
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'launchFee' }),
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'previewLaunchEconomics', args: [LAUNCH_CONFIG_ID, zeroAddress] }),
  ]);
  const params = {
    name: form.name.trim(), symbol: form.symbol.trim(), logo, description: form.description.trim(),
    socials: { twitter: form.twitter.trim(), telegram: form.telegram.trim(), discord: form.discord.trim(), website: form.website.trim(), farcaster: form.farcaster.trim() },
    creatorFeeRecipient: splitter,
    creatorTaxBps: Number(form.taxBps),
    buybackEnabled: !!form.buyback,
    expectedEconomics,
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  let tx;
  if (quoteIn > 0n) {
    const mk = minOut => ({
      to: ROUTER, value: launchFee + quoteIn,
      data: encodeFunctionData({ abi: routerAbi, functionName: 'launchAndBuy', args: [params, LAUNCH_CONFIG_ID, zeroAddress, quoteIn, minOut, account, []] }),
    });
    // giả lập để biết số token nhận được, đặt minTokensOut = 97% (slippage 3%)
    const sim = await simulate(account, mk(0n));
    tx = mk(sim.tokensOut * 97n / 100n);
    tx.expectedTokens = sim.tokensOut;
  } else {
    tx = { to: ADDR.factory, value: launchFee, data: encodeFunctionData({ abi: factoryAbi, functionName: 'launchToken', args: [params, LAUNCH_CONFIG_ID, zeroAddress] }) };
    await simulate(account, tx);
  }
  return { ...tx, splitter, launchFee, params };
}

// eth_simulateV1 từ chính ví người dùng: bắt lỗi trước khi ký + đọc số token mua được
async function simulate(account, tx) {
  const r = await client.request({
    method: 'eth_simulateV1',
    // số dư giả lập đủ để chạy; thiếu ETH thật thì MetaMask sẽ báo khi ký
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Giả lập launch thất bại: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
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

// Ví nhận 90% khác ví launch: deploy contract chia phí trước để mọi trang check nhận ra ngay (creator() đọc được on-chain)
export async function needsSplitterDeploy(account, payout) {
  if (getAddress(account) === getAddress(payout)) return null;
  const splitter = await predictSplitter(payout);
  const code = await client.getCode({ address: splitter });
  if (code && code !== '0x') return null;
  return { to: SPLITTER_FACTORY, data: encodeFunctionData({ abi: splitterFactoryAbi, functionName: 'deploy', args: [getAddress(payout), SPLITTER_SALT] }) };
}
