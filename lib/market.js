// Market data for tokens launched via CheckFee (on-chain + Blockscout, runs in the browser)
import { parseAbi, parseAbiItem, pad, toHex, getAddress, decodeEventLog, encodeFunctionData, zeroAddress } from 'viem';
import { client, ADDR } from './pons';
import { CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET } from './launch';
import { clankerLaunchesBy } from './clanker';

const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
export const START_BLOCK = 114_000_000n; // before CheckFee started launching
const SUPPLY = 10n ** 27n;               // 1B token, 18 decimals (launch config 0)
const TOPIC_LAUNCHED = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const CHUNK = 9_999_999n;

const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
]);
const tokenAbi = parseAbi([
  'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }',
  'function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
export const curveAbi = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function realQuoteReserve() view returns (uint256)',
  'function sellableTokens() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function currentSnipeTaxBps(address recipient) view returns (uint256)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)',
]);
const buyEv = parseAbiItem('event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)');
const sellEv = parseAbiItem('event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)');

export const ipfsUrl = uri => (uri || '').startsWith('ipfs://') ? `/api/ipfs/${uri.slice(7).split('/')[0]}` : uri || '';

export async function getLogsChunked(filter, fromBlock) {
  const latest = await client.getBlockNumber();
  const ranges = [];
  for (let f = fromBlock; f <= latest; f += CHUNK + 1n) ranges.push([f, f + CHUNK > latest ? latest : f + CHUNK]);
  const res = await Promise.all(ranges.map(([f, t]) => client.request({ method: 'eth_getLogs', params: [{ ...filter, fromBlock: toHex(f), toBlock: toHex(t) }] })));
  return res.flat();
}

/* ---------- tokens launched via CheckFee ---------- */
// = every launch by the CheckFee wallet since START_BLOCK + for each fee payment, that payer's next launch
export async function listCheckfeeTokens() {
  const payers = new Map(); // wallet → [fee payment blocks]
  let q = 'filter=to';
  for (let page = 0; page < 50; page++) {
    const j = await fetch(`${BLOCKSCOUT}/addresses/${CHECKFEE_WALLET}/transactions?${q}`).then(r => r.json());
    for (const t of j.items || []) {
      if (t.value === CHECKFEE_LAUNCH_FEE.toString() && t.status === 'ok') {
        const a = getAddress(t.from.hash);
        payers.set(a, [...(payers.get(a) || []), BigInt(t.block_number)]);
      }
    }
    if (!j.next_page_params) break;
    q = 'filter=to&' + new URLSearchParams(j.next_page_params).toString();
  }
  const wallets = new Set([getAddress(CHECKFEE_WALLET), ...payers.keys()]);
  const found = [];
  await Promise.all([...wallets].map(async w => {
    const [logs, clk] = await Promise.all([
      getLogsChunked({ address: ADDR.factory, topics: [TOPIC_LAUNCHED, null, null, pad(w).toLowerCase()] }, START_BLOCK),
      clankerLaunchesBy(w, START_BLOCK, getLogsChunked),
    ]);
    // a fee pays for the next launch on either platform
    const launches = [...logs.map(l => ({ platform: 'pons', token: getAddress('0x' + l.topics[1].slice(26)), curve: getAddress('0x' + l.topics[2].slice(26)), deployer: w, block: BigInt(l.blockNumber) })), ...clk]
      .sort((a, b) => (a.block < b.block ? -1 : 1));
    if (w === getAddress(CHECKFEE_WALLET)) { found.push(...launches); return; }
    // pair each fee payment with the next launch
    const fees = [...(payers.get(w) || [])].sort((a, b) => (a < b ? -1 : 1));
    let i = 0;
    for (const fb of fees) {
      while (i < launches.length && launches[i].block < fb) i++;
      if (i < launches.length) found.push(launches[i++]);
    }
  }));
  return found.sort((a, b) => (a.block > b.block ? -1 : 1));
}

/* ---------- single token info ---------- */
export async function tokenSummary(token, launchBlock) {
  const [L, info, name, symbol] = await Promise.all([
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] }),
    client.readContract({ address: token, abi: tokenAbi, functionName: 'getTokenInfo' }).catch(() => null),
    client.readContract({ address: token, abi: tokenAbi, functionName: 'name' }).catch(() => '?'),
    client.readContract({ address: token, abi: tokenAbi, functionName: 'symbol' }).catch(() => '?'),
  ]);
  if (!L.exists) throw new Error('Not a Pons v2 token');
  const s = {
    token, name, symbol, curve: L.curve, deployer: L.deployer, creatorFeeRecipient: L.creatorFeeRecipient,
    pairToken: L.pairToken, phase: Number(L.phase), threshold: L.graduationThreshold, creatorTaxBps: Number(L.creatorTaxBps),
    logo: info ? ipfsUrl(info[1]) : '', description: info?.[2] || '', socials: info?.[3] || {},
    priceEth: null, progress: Number(L.phase) > 0 ? 1 : 0, launchBlock: launchBlock ?? null,
  };
  if (s.phase === 0) {
    const [[qr, tr], real] = await Promise.all([
      client.readContract({ address: L.curve, abi: curveAbi, functionName: 'getReserves' }),
      client.readContract({ address: L.curve, abi: curveAbi, functionName: 'realQuoteReserve' }),
    ]);
    s.priceEth = Number(qr) / Number(tr);          // ETH per token (both 18 decimals)
    s.mcapEth = s.priceEth * Number(SUPPLY) / 1e18;
    s.realQuote = real;
    s.progress = Math.min(1, Number(real) / Number(L.graduationThreshold));
  }
  return s;
}

/* ---------- curve trades ---------- */
export async function tradesOf(curve, fromBlock, withTime = true) {
  const raw = await getLogsChunked({ address: curve }, fromBlock);
  const trades = [];
  for (const l of raw) {
    for (const ev of [buyEv, sellEv]) {
      try {
        const d = decodeEventLog({ abi: [ev], data: l.data, topics: l.topics });
        const buy = d.eventName === 'CurveBuy';
        const eth = buy ? d.args.quoteIn : d.args.quoteOut;
        const tok = buy ? d.args.tokensOut : d.args.tokensIn;
        trades.push({
          side: buy ? 'Buy' : 'Sell', trader: buy ? d.args.recipient : d.args.seller, eth, tokens: tok,
          price: tok > 0n ? Number(eth) / Number(tok) : 0, fee: d.args.fee, tax: d.args.tax,
          block: BigInt(l.blockNumber), tx: l.transactionHash, logIndex: Number(l.logIndex),
        });
      } catch {}
    }
  }
  trades.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  if (withTime && trades.length) {
    const blocks = [...new Set(trades.map(t => t.block))].slice(-300);
    const ts = new Map();
    await Promise.all(blocks.map(async b => ts.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))));
    for (const t of trades) t.time = ts.get(t.block) ?? null;
  }
  return trades;
}

export async function blockTime(block) {
  return Number((await client.getBlock({ blockNumber: BigInt(block) })).timestamp);
}

export async function holdersOf(token) {
  const [info, list] = await Promise.all([
    fetch(`${BLOCKSCOUT}/tokens/${token}`).then(r => r.json()).catch(() => ({})),
    fetch(`${BLOCKSCOUT}/tokens/${token}/holders`).then(r => r.json()).catch(() => ({})),
  ]);
  return {
    count: Number(info.holders_count || info.holders || 0),
    items: (list.items || []).map(h => ({ address: h.address.hash, value: BigInt(h.value) })),
  };
}

/* ---------- buy / sell on the curve (pre-graduation) ---------- */
const BPS = 10_000n;
const amountOut = (inAmt, rIn, rOut) => (inAmt * rOut) / (rIn + inAmt);

export async function quoteBuy(curve, quoteIn, recipient) {
  const [[qr, tr], sellable, fee, tax, snipeRaw] = await Promise.all([
    client.readContract({ address: curve, abi: curveAbi, functionName: 'getReserves' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'sellableTokens' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'feeBps' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'creatorTaxBps' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'currentSnipeTaxBps', args: [recipient || zeroAddress] }),
  ]);
  let snipe = snipeRaw;
  if (snipe > 0n) { const max = BPS - fee - tax - 100n; if (snipe > max) snipe = max; }
  const net = quoteIn - (quoteIn * fee) / BPS - (quoteIn * tax) / BPS - (quoteIn * snipe) / BPS;
  let out = amountOut(net, qr, tr);
  if (out > sellable) out = sellable; // final buy is clamped, the excess is refunded
  return { tokensOut: out, snipeBps: Number(snipe) };
}

export async function quoteSell(curve, tokensIn) {
  const [[qr, tr], fee, tax] = await Promise.all([
    client.readContract({ address: curve, abi: curveAbi, functionName: 'getReserves' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'feeBps' }),
    client.readContract({ address: curve, abi: curveAbi, functionName: 'creatorTaxBps' }),
  ]);
  const gross = amountOut(tokensIn, tr, qr);
  return gross - (gross * fee) / BPS - (gross * tax) / BPS;
}

export const tokenBalance = (token, owner) => client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [owner] });
export const tokenAllowance = (token, owner, spender) => client.readContract({ address: token, abi: tokenAbi, functionName: 'allowance', args: [owner, spender] });
export const ethBalance = owner => client.getBalance({ address: owner });
export const buyData = (quoteIn, minOut, to) => encodeFunctionData({ abi: curveAbi, functionName: 'buy', args: [quoteIn, minOut, to] });
export const sellData = (tokensIn, minOut, to) => encodeFunctionData({ abi: curveAbi, functionName: 'sell', args: [tokensIn, minOut, to] });
export const approveData = (spender, amt) => encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [spender, amt] });
export const waitTx = hash => client.waitForTransactionReceipt({ hash, timeout: 120_000 });
