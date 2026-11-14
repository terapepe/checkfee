import {
  createPublicClient, http, fallback, defineChain, parseAbi, parseAbiItem, toEventSelector,
  encodeFunctionData, encodeAbiParameters, keccak256, getAddress, pad, toHex, zeroAddress,
  BaseError, ContractFunctionRevertedError,
} from 'viem';

// Pons v2 – Robinhood Chain (docs.ponsfamily.com/v2, "Deployed addresses")
export const ADDR = {
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  escrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
};
// RPC_URL (env) first if set, then public endpoints as fallback
const RPCS = [process.env.RPC_URL, 'https://rpc.mainnet.chain.robinhood.com', 'https://rpc.nodeflare.app/robinhood/public'].filter(Boolean);

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
});
const client = createPublicClient({
  chain,
  transport: fallback(RPCS.map(u => http(u, { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 300 }))),
});

const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'struct FeePolicy { address protocolFeeRecipient; uint16 protocolFeeShareBps; uint16 buybackBurnBps; uint16 hookFeeBps; uint16 maxInternalPriceImpactBps; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
  'function getLaunchFeePolicy(address token) view returns (FeePolicy)',
]);
const curveAbi = parseAbi([
  'function quoteFeeBalance() view returns (uint256)',
  'function creatorTaxBalance() view returns (uint256)',
  'function sweepFees(uint256 minBuybackTokensOut)',
]);
const hookAbi = parseAbi([
  'function pendingFees(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)',
  'function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)',
]);
const escrowAbi = parseAbi([
  'function balanceOf(address recipient) view returns (uint256)',
  'function balanceOfToken(address recipient, address token) view returns (uint256)',
  'function claim()',
  'function claimToken(address token)',
]);
const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

const TOPIC_LAUNCHED = toEventSelector(parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)'));
const TOPIC_RECIPIENT = toEventSelector(parseAbiItem(
  'event CreatorFeeRecipientUpdated(address indexed token, address indexed previousRecipient, address indexed newRecipient)'));

const PHASE = ['Bonding curve', 'Swept', 'Uniswap v4', 'Rescued'];

// RPC eth_getLogs: factory events where topic3 == wallet.
// Public RPC caps a query at 10M blocks, so scan from the factory deploy block in chunks.
const FACTORY_DEPLOY_BLOCK = 26841846n;
const CHUNK = 9_999_999n;
async function factoryLogs(topic0, wallet) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let from = FACTORY_DEPLOY_BLOCK; from <= latest; from += CHUNK + 1n) {
    const to = from + CHUNK > latest ? latest : from + CHUNK;
    ranges.push([from, to]);
  }
  const results = await Promise.all(ranges.map(([from, to]) => client.request({
    method: 'eth_getLogs',
    params: [{
      address: ADDR.factory, fromBlock: toHex(from), toBlock: toHex(to),
      topics: [topic0, null, null, pad(wallet).toLowerCase()],
    }],
  })));
  return results.flat().map(l => getAddress('0x' + l.topics[1].slice(26)));
}

// eth_call from the wallet: does the sweep go through if the wallet sends it?
async function simulate(wallet, to, data) {
  try {
    await client.call({ account: wallet, to, data });
    return { ok: true };
  } catch (e) {
    let reason = 'reverted';
    if (e instanceof BaseError) {
      const rev = e.walk(x => x instanceof ContractFunctionRevertedError);
      const raw = e.walk(x => typeof x?.data === 'string')?.data;
      reason = rev?.data?.errorName || (typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : e.shortMessage);
    }
    return { ok: false, reason };
  }
}

const str = v => (v == null ? null : v.toString());

export async function checkWallet(walletInput) {
  const wallet = getAddress(walletInput);

  const [launched, received] = await Promise.all([
    factoryLogs(TOPIC_LAUNCHED, wallet),
    factoryLogs(TOPIC_RECIPIENT, wallet),
  ]);
  const tokens = [...new Set([...launched, ...received])];

  const rows = await Promise.all(tokens.map(token => readToken(token, wallet).catch(e => ({
    token, error: e?.shortMessage || e?.message || String(e),
  }))));
  const ok = rows.filter(r => !r.error);

  // escrow: one native (ETH) ledger + one per ERC-20 quote asset
  const assets = [...new Set(ok.map(r => r.quote).filter(q => q !== zeroAddress))];
  const ethBal = await client.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: 'balanceOf', args: [wallet] });
  const escrow = [{
    asset: zeroAddress, symbol: 'ETH', decimals: 18, balance: str(ethBal),
    claim: { to: ADDR.escrow, data: encodeFunctionData({ abi: escrowAbi, functionName: 'claim' }), fn: 'claim()' },
  }];
  for (const a of assets) {
    const r = ok.find(x => x.quote === a);
    const bal = await client.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: 'balanceOfToken', args: [wallet, a] });
    escrow.push({
      asset: a, symbol: r.quoteSymbol, decimals: r.quoteDecimals, balance: str(bal),
      claim: { to: ADDR.escrow, data: encodeFunctionData({ abi: escrowAbi, functionName: 'claimToken', args: [a] }), fn: `claimToken(${a})` },
    });
  }

  return { wallet, chainId: 4663, tokens: rows, escrow };
}

async function readToken(token, wallet) {
  {
    const [L, policy, name, symbol] = await Promise.all([
      client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] }),
      client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'getLaunchFeePolicy', args: [token] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => '?'),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
    ]);

    const isRecipient = L.creatorFeeRecipient.toLowerCase() === wallet.toLowerCase();
    const quote = L.pairToken; // zeroAddress = native ETH
    let quoteSymbol = 'ETH', quoteDecimals = 18;
    if (quote !== zeroAddress) {
      [quoteSymbol, quoteDecimals] = await Promise.all([
        client.readContract({ address: quote, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
        client.readContract({ address: quote, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
      ]);
    }

    // creator share of the base fee: protocol first, then buyback slice (if enabled)
    const creatorShare = base => {
      let v = base * BigInt(10000 - Number(policy.protocolFeeShareBps)) / 10000n;
      if (L.buybackEnabled) v = v * BigInt(10000 - Number(policy.buybackBurnBps)) / 10000n;
      return v;
    };

    const phase = Number(L.phase);
    const row = {
      token, name, symbol, phase, phaseName: PHASE[phase] ?? String(phase),
      curve: L.curve, deployer: L.deployer, creatorFeeRecipient: L.creatorFeeRecipient, isRecipient,
      quote, quoteSymbol, quoteDecimals: Number(quoteDecimals),
      creatorTaxBps: Number(L.creatorTaxBps), buybackEnabled: L.buybackEnabled,
      protocolFeeShareBps: Number(policy.protocolFeeShareBps),
      pendingBaseFee: '0', pendingCreatorTax: '0', pendingTokenSideFee: '0', estimatedCreator: '0',
      sweep: null,
    };

    if (phase === 0) {
      const [qf, ct] = await Promise.all([
        client.readContract({ address: L.curve, abi: curveAbi, functionName: 'quoteFeeBalance' }),
        client.readContract({ address: L.curve, abi: curveAbi, functionName: 'creatorTaxBalance' }),
      ]);
      row.pendingBaseFee = str(qf);
      row.pendingCreatorTax = str(ct);
      row.estimatedCreator = str(creatorShare(qf) + ct);
      if (qf + ct > 0n) {
        const data = encodeFunctionData({ abi: curveAbi, functionName: 'sweepFees', args: [0n] });
        row.sweep = { to: L.curve, data, fn: 'sweepFees(0)', ...(isRecipient ? await simulate(wallet, L.curve, data) : { ok: false, reason: 'NotCreatorFeeRecipient' }) };
      }
    } else if (phase === 2) {
      const [c0, c1] = quote.toLowerCase() < token.toLowerCase() ? [quote, token] : [token, quote];
      const poolId = keccak256(encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
        [c0, c1, L.poolFee, L.tickSpacing, ADDR.hook]));
      const [pf, pt, pfTok] = await Promise.all([
        client.readContract({ address: ADDR.hook, abi: hookAbi, functionName: 'pendingFees', args: [poolId, quote] }),
        client.readContract({ address: ADDR.hook, abi: hookAbi, functionName: 'pendingCreatorTax', args: [poolId, quote] }),
        client.readContract({ address: ADDR.hook, abi: hookAbi, functionName: 'pendingFees', args: [poolId, token] }),
      ]);
      row.poolId = poolId;
      row.pendingBaseFee = str(pf);
      row.pendingCreatorTax = str(pt);
      row.pendingTokenSideFee = str(pfTok);
      row.estimatedCreator = str(creatorShare(pf) + pt);
      if (pf + pt + pfTok > 0n) {
        const data = encodeFunctionData({ abi: hookAbi, functionName: 'sweepPoolFees', args: [poolId, 0n, 0n] });
        row.sweep = { to: ADDR.hook, data, fn: 'sweepPoolFees(poolId, 0, 0)', ...(isRecipient ? await simulate(wallet, ADDR.hook, data) : { ok: false, reason: 'NotCreatorFeeRecipient' }) };
      }
    }
    return row;
  }
}
