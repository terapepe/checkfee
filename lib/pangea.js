// Pangea v4 self-launch on Robinhood Chain: LaunchCoreV4.open() straight from the user's wallet (no Pangea server, no launch fee).
// coinId / token address are computed locally; the salt is ground until the token ends in 6ea (the core refuses anything else).
import { parseAbi, parseAbiItem, encodeFunctionData, encodePacked, encodeAbiParameters, decodeEventLog, keccak256, concat, toHex, pad, getAddress, zeroAddress, zeroHash } from 'viem';
import { clientOf } from './chains';

export const PANGEA = {
  chainId: 4663,
  core: '0xaA61764BD44df5468CaaE856232Ce9B711512449',         // LaunchCoreV4 (set v4b, /api/v4/contracts)
  coinDeployer: '0x43049AbeEcCc6f321774439B636e88f669024d9f',
  codeRegistry: '0x68415e3599F5551f59B9dD3855Bea39732ae8A00',
  bridgeRows: '0x5F49094337cB8b2D90e4BB231A0aa43c3d7f7bbf',
  feeHook: '0x8e1Bf182a2a1FEdF9850379127D4535F18EA68cc',
};
export const PANGEA_START_MCAP_USD = 3000; // Pangea's default start market cap per chain
export const PANGEA_MIN_FEE = 0.3; export const PANGEA_MAX_FEE = 5;

// same lists as Pangea's own launches: every v4 chain listed, LZ|HL transports
const CHAINS = [1, 56, 4663, 8453, 99901, 1399811149];
const MASK = 6;
const TICK_SPACING = 60;
const SUPPLY = 1_000_000_000n * 10n ** 9n; // 1B tokens, 9 decimals

const PRE = '(bytes32 nameHash, bytes32 symbolHash, bytes32 creatorEvm, bytes32 creatorSvm, uint32 homePcid, uint64 createdAt, bytes32 salt, uint32[] chains, uint16 transportMask, bytes32 rowsHash, uint128 chainTids)';
const ARGS = '(address quote, int24 tickSpacing, int24 startTick, uint256 quotePerTokenE18, uint16 toleranceBps, uint16 feeBps, (address payer, address recipient, uint256 quoteAmount, uint256 minOut, uint64 deadline, uint256 nonce, bytes sig)[] buys, address tokenomics, string metadataURI)';
const CORE_ABI = parseAbi([
  `function open(${PRE} pre, string name, string symbol, ${ARGS} a) payable returns (bytes32 coinId, address token)`,
  'function chainTidMask(uint32) view returns (uint16)',
  'function owedDust(uint256 supply, int24 startTick, int24 tickSpacing) pure returns (uint256)',
  'function opensPaused() view returns (bool)',
]);
const REG_ABI = parseAbi(['function versionAt(uint64) view returns (uint256)', 'function creationCode(uint256) view returns (bytes)']);
const ROWS_ABI = parseAbi(['function rowsHash(uint32[] chains, uint16 mask, uint128 chainTids) view returns (bytes32)']);
const OPENED = parseAbiItem('event Opened(bytes32 indexed coinId, address indexed token, address indexed by, bytes32 poolId, address splitter, int24 startTick, bool first)');

const rd = (address, abi, functionName, args) => clientOf(PANGEA.chainId).readContract({ address, abi, functionName, args });

export async function readPangeaInfo() {
  const paused = await rd(PANGEA.core, CORE_ABI, 'opensPaused');
  return { launchFee: 0n, canLaunch: !paused };
}

/* ---------- opening price ---------- */
const Q96 = 2n ** 96n;
// Uniswap TickMath.getSqrtPriceAtTick
function sqrtAtTick(tick) {
  const abs = BigInt(tick < 0 ? -tick : tick);
  let r = abs & 1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const M = [0xfff97272373d413259a46990580e213an, 0xfff2e50f5f656932ef12357cf3c7fdccn, 0xffe5caca7e10e4e61c3624eaa0941cd0n, 0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n, 0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n, 0xfcbe86c7900a88aedcffc83b479aa3a4n, 0xf987a7253ac413176f2b074cf7815e54n, 0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n, 0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n, 0x70d869a156d2a1b890bb3df62baf32f7n, 0x31be135f97d08fd981231505542fcfa6n, 0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n, 0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n];
  for (let i = 0; i < M.length; i++) if (abs & (1n << BigInt(i + 1))) r = (r * M[i]) >> 128n;
  if (tick > 0) r = ((1n << 256n) - 1n) / r;
  return (r >> 32n) + (r % (1n << 32n) === 0n ? 0n : 1n);
}
// start market cap (ETH) → startTick (multiple of 60, rounded so the open mcap is ≥ the target) + the matching quotePerTokenE18.
// ETH (address 0) is always currency0, the token currency1; the pool opens 1 sqrt-unit under the tick (LiquidityLocker).
export function pangeaPrice(mcapEth) {
  const raw = 1e9 / ((mcapEth / 1e9) * 1e18); // token raw units per wei
  const startTick = Math.floor(Math.log(raw) / Math.log(1.0001) / TICK_SPACING) * TICK_SPACING;
  const s = sqrtAtTick(startTick) - 1n;
  const implied = (s * s) / Q96;
  return { startTick, quotePerTokenE18: (10n ** 9n * Q96) / implied }; // _targetPriceX96 ≥ implied → passes checkOpeningPrice
}

/* ---------- coin id / token address (Pre.encode + CodeRegistry.tokenAddress) ---------- */
const coinIdOf = p => keccak256(concat([
  encodePacked(['string', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint32', 'uint64', 'bytes32'],
    ['PANGEA-COIN-V4', 1, p.nameHash, p.symbolHash, p.creatorEvm, p.creatorSvm, p.homePcid, p.createdAt, p.salt]),
  encodePacked(['uint8', ...p.chains.map(() => 'uint32'), 'uint16', 'bytes32'], [p.chains.length, ...p.chains, p.transportMask, p.rowsHash]),
]));

async function mine(pre, name, symbol, creator, code) {
  for (let i = 0; i < 500_000; i++) {
    if (i % 256 === 0) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    pre.salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const coinId = coinIdOf(pre);
    const h = keccak256(concat([code, encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'bytes32' }, { type: 'address' }], [name, symbol, coinId, creator])]));
    const a = keccak256(concat(['0xff', PANGEA.coinDeployer, coinId, h]));
    if (a.endsWith('6ea')) return { coinId, token: getAddress('0x' + a.slice(-40)) };
  }
  throw new Error('No 6ea token address found, try again');
}

// opts: { account, name, symbol, creator (fee wallet), metadataURI, feeBps (30..500), mcapEth }
export async function buildPangeaTx({ account, name, symbol, creator, metadataURI, feeBps, mcapEth }) {
  creator = getAddress(creator);
  const createdAt = BigInt(Math.floor(Date.now() / 1000));
  const masks = await Promise.all(CHAINS.map(c => rd(PANGEA.core, CORE_ABI, 'chainTidMask', [c])));
  const chainTids = masks.reduce((t, m, i) => t | ((BigInt(m) & BigInt(MASK)) << BigInt(16 * i)), 0n); // LaunchCoreV4._defaults
  const [rowsHash, version] = await Promise.all([
    rd(PANGEA.bridgeRows, ROWS_ABI, 'rowsHash', [CHAINS, MASK, chainTids]),
    rd(PANGEA.codeRegistry, REG_ABI, 'versionAt', [createdAt]),
  ]);
  const code = await rd(PANGEA.codeRegistry, REG_ABI, 'creationCode', [version]);
  const pre = {
    nameHash: keccak256(toHex(name)), symbolHash: keccak256(toHex(symbol)),
    creatorEvm: pad(creator, { size: 32 }), creatorSvm: zeroHash,
    homePcid: PANGEA.chainId, createdAt, salt: zeroHash, chains: CHAINS, transportMask: MASK, rowsHash, chainTids,
  };
  const { coinId, token } = await mine(pre, name, symbol, creator, code);
  const { startTick, quotePerTokenE18 } = pangeaPrice(mcapEth);
  const a = { quote: zeroAddress, tickSpacing: TICK_SPACING, startTick, quotePerTokenE18, toleranceBps: 100, feeBps, buys: [], tokenomics: zeroAddress, metadataURI };
  const value = await rd(PANGEA.core, CORE_ABI, 'owedDust', [SUPPLY, startTick, TICK_SPACING]); // a few wei, refunded if unused
  const tx = { to: PANGEA.core, value, data: encodeFunctionData({ abi: CORE_ABI, functionName: 'open', args: [pre, name, symbol, a] }), coinId, token };
  await simulate(account, tx);
  return tx;
}

// eth_simulateV1 from the user's wallet, same as the Pons / tax launches
async function simulate(account, tx) {
  const r = await clientOf(PANGEA.chainId).request({
    method: 'eth_simulateV1',
    params: [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(tx.value + 10n ** 18n) } }, calls: [{ from: account, to: tx.to, data: tx.data, value: toHex(tx.value) }] }], validation: false }, 'latest'],
  });
  const c = r[0].calls[0];
  if (c.status !== '0x1') throw new Error(`Launch simulation failed: ${c.error?.message || 'reverted'} ${c.error?.data || ''}`.trim());
}

export function parsePangeaLaunch(logs) {
  for (const l of logs || []) {
    if (l.address.toLowerCase() !== PANGEA.core.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: [OPENED], data: l.data, topics: l.topics });
      return { token: ev.args.token, poolId: ev.args.poolId, splitter: ev.args.splitter, coinId: ev.args.coinId };
    } catch {}
  }
  return null;
}
