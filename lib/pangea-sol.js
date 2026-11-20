// Pangea v4 self-launch on Solana: pangea_launcher_v4 `open_v4` (or `open_v4_fee` for a pool fee other than 1%) sent from the
// user's own Solana wallet, so that wallet is the coin's creator (and fee payee) from the start. USDC pair, no launch fee.
// Account layout, seeds and arg encoding follow Pangea's own launcher client (launcher-client.mjs / sol-launch-v4.mjs).
import {
  PublicKey, TransactionInstruction, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction,
  AddressLookupTableAccount, Connection,
} from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';
import { keccak256, hexToBytes, bytesToHex, toHex, zeroAddress } from 'viem';
import { pangeaPreimage } from './pangea';

export const SOL = {
  pcid: 1399811149, // 0x536f6c4d "SolM"
  launcher: 'EnLq33Zqv6j15km7zxBXgwn8w6TiUxKQSeRosBFK8qZP',
  bridge: '8K7DTNE4bqPwZiueTPn8wD3NULAt3PxCMPA9nkFc2LK3', // v4b set: the Solana bridge the EVM v4b bridges peer with (Eeb1… is v4a)
  cpAmm: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG', // Meteora DAMM v2
  alt: '9CVQoJmpLsQhoDQZQMdUqjZHaWjWX9rzP9dy9sDi4fdK',  // Pangea's shared v4b lookup table
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdcDecimals: 6,
};
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const BPF = 'BPFLoaderUpgradeab1e11111111111111111111111';
const OPEN_UNITS = 600_000;
const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SQRT_MIN = 4295048016n, SQRT_MAX = 0xfffec4b1845c1aa94e69579bn; // cp-amm's open range
const SUPPLY = 1_000_000_000n * 10n ** 9n;

/* ---------- bytes ---------- */
const pk = x => (x instanceof PublicKey ? x : new PublicKey(x));
const utf8 = s => new TextEncoder().encode(String(s));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const le = (v, n) => { const b = new Uint8Array(n); let x = BigInt(v); for (let i = 0; i < n; i++, x >>= 8n) b[i] = Number(x & 255n); return b; };
const be = (v, n) => { const b = new Uint8Array(n); let x = BigInt(v); for (let i = n - 1; i >= 0; i--, x >>= 8n) b[i] = Number(x & 255n); return b; };
const b32 = (h, what) => { const b = typeof h === 'string' ? hexToBytes(h) : Uint8Array.from(h); if (b.length !== 32) throw new Error(`${what}: 32 bytes`); return b; };
const kec = (...a) => hexToBytes(keccak256(cat(...a)));
const disc = name => sha256(utf8(`global:${name}`)).subarray(0, 8);
const borshStr = s => { const b = utf8(s); return cat(le(b.length, 4), b); };
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, pk(prog))[0];
const ro = k => ({ pubkey: pk(k), isSigner: false, isWritable: false });
const rw = k => ({ pubkey: pk(k), isSigner: false, isWritable: true });

/* ---------- preimage (Pre.encode) and coin id ---------- */
// pre from lib/pangea.js pangeaPreimage(): hex fields, bigint createdAt / chainTids
function preBytes(p) {
  return {
    nameHash: b32(p.nameHash, 'nameHash'), symbolHash: b32(p.symbolHash, 'symbolHash'), creatorEvm: b32(p.creatorEvm, 'creatorEvm'),
    creatorSvm: b32(p.creatorSvm, 'creatorSvm'), homePcid: Number(p.homePcid), createdAt: BigInt(p.createdAt), salt: b32(p.salt, 'salt'),
    chains: p.chains.map(Number), transportMask: Number(p.transportMask), rowsHash: b32(p.rowsHash, 'rowsHash'), chainTids: BigInt(p.chainTids ?? 0),
  };
}
const encodePre = p => cat(p.nameHash, p.symbolHash, p.creatorEvm, p.creatorSvm, le(p.homePcid, 4), le(p.createdAt, 8), p.salt,
  le(p.chains.length, 4), ...p.chains.map(c => le(c, 4)), le(p.transportMask, 2), p.rowsHash, le(p.chainTids, 16));
export const solCoinId = p => kec(utf8('PANGEA-COIN-V4'), [1], p.nameHash, p.symbolHash, p.creatorEvm, p.creatorSvm, be(p.homePcid, 4),
  be(p.createdAt, 8), p.salt, [p.chains.length], ...p.chains.map(c => be(c, 4)), be(p.transportMask, 2), p.rowsHash);

/* ---------- metadata URI: ipfs://<sha-256 CID> only (the program stores the digest and writes the URI back) ---------- */
function b58decode(s) {
  let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('not base58'); n = n * 58n + BigInt(i); }
  const out = []; for (; n > 0n; n >>= 8n) out.unshift(Number(n & 255n));
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}
function b32decode(s) {
  const A = 'abcdefghijklmnopqrstuvwxyz234567'; const out = []; let v = 0, bits = 0;
  for (const c of s) { const i = A.indexOf(c); if (i < 0) throw new Error('not base32'); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
}
export function solUriForm(uri) {
  const m = /^ipfs:\/\/([A-Za-z0-9]+)$/.exec(String(uri || ''));
  if (!m) throw new Error('The metadata URI must be ipfs://<CID> for a Solana launch');
  const cid = m[1];
  let form, mh;
  if (cid.startsWith('Qm') && cid.length === 46) { form = 0; mh = b58decode(cid); }
  else if (cid.startsWith('b')) { const b = b32decode(cid.slice(1)); if (b[0] !== 1) throw new Error('not a CIDv1'); form = b[1]; mh = b.subarray(2); }
  else throw new Error('Unsupported CID');
  if (![0, 0x55, 0x70].includes(form)) throw new Error('The metadata CID must be raw or dag-pb');
  if (mh.length !== 34 || mh[0] !== 0x12 || mh[1] !== 0x20) throw new Error('The metadata CID must be a sha-256 hash');
  return { form, digest: mh.subarray(2) };
}

/* ---------- opening price ---------- */
const isqrt = n => { if (n < 2n) return n; let x = n, y = (x + 1n) >> 1n; while (y < x) { x = y; y = (x + n / x) >> 1n; } return x; };
// start market cap (USD, 1B coins) → cp-amm sqrt price for the USDC pool (Pangea's priceE18 → initSqrtPrice)
export function solInitSqrtPrice(mcapUsd, quoteDecimals = SOL.usdcDecimals) {
  const priceE18 = BigInt(Math.round(Number(mcapUsd) * 100)) * 10n ** 16n / 1_000_000_000n; // USD per coin, 1e18
  if (priceE18 <= 0n) throw new Error('Start market cap too low');
  const s = isqrt((priceE18 * 10n ** BigInt(quoteDecimals) << 128n) / 10n ** 27n); // quote per token = price (USDC = $1)
  if (s <= SQRT_MIN || s >= SQRT_MAX) throw new Error('Opening price outside the Solana pool range');
  const liq = SUPPLY * s * SQRT_MAX / (SQRT_MAX - s); // all 1B coins single-sided must fit u128
  if (liq >= 1n << 128n || liq <= 0n) throw new Error('Start market cap too high for the Solana pool');
  return s;
}

/* ---------- the mint: PDA ["mint", coinId, salt] under the bridge, salt ground so it ends in 6ea ---------- */
const MOD = 58 ** 3;
const SUFFIX = [...'6ea'].reduce((v, c) => v * 58 + B58.indexOf(c), 0);
const mod58 = h => { let t = 0; for (let i = 0; i < 32; i += 2) t = (t * 65536 + ((h[i] << 8) | h[i + 1])) % MOD; return t; };
function inc(b) { for (let i = b.length - 1; i >= 0; i--) { if (++b[i] <= 255) return; b[i] = 0; } }
export async function grindMintSalt(coinId, { onProgress } = {}) {
  const bridge = pk(SOL.bridge).toBytes();
  const buf = cat(utf8('mint'), coinId, crypto.getRandomValues(new Uint8Array(32)), [255], bridge, utf8('ProgramDerivedAddress'));
  const salt = buf.subarray(36, 68);
  for (let i = 0; i < 0x1000000; i++) {
    if (i % 16384 === 0) { onProgress?.(i); await new Promise(r => setTimeout(r, 0)); }
    const h = sha256(buf);
    if (mod58(h) === SUFFIX && !PublicKey.isOnCurve(h) && salt.some(x => x)) {
      const mint = pda([utf8('mint'), coinId, salt], SOL.bridge);
      if (mint.toBase58().endsWith('6ea')) return { salt: Uint8Array.from(salt), mint };
    }
    inc(salt);
  }
  throw new Error('No 6ea mint found, try again');
}

/* ---------- open_v4 ---------- */
export function solAddresses({ coinId, salt, payer, quote = SOL.usdc }) {
  const L = SOL.launcher, BR = SOL.bridge, C = SOL.cpAmm;
  const mint = pda([utf8('mint'), coinId, salt], BR);
  const [hi, lo] = Buffer.compare(mint.toBuffer(), pk(quote).toBuffer()) > 0 ? [mint, pk(quote)] : [pk(quote), mint];
  const pool = pda([utf8('cpool'), hi.toBuffer(), lo.toBuffer()], C);
  const positionNftMint = pda([utf8('position'), mint.toBuffer()], L);
  return {
    mint, pool, positionNftMint,
    coin: pda([utf8('coin'), coinId], BR),
    positionNftAccount: pda([utf8('position_nft_account'), positionNftMint.toBuffer()], C),
    position: pda([utf8('position'), positionNftMint.toBuffer()], C),
    tokenAVault: pda([utf8('token_vault'), mint.toBuffer(), pool.toBuffer()], C),
    tokenBVault: pda([utf8('token_vault'), pk(quote).toBuffer(), pool.toBuffer()], C),
    record: pda([utf8('launch'), mint.toBuffer()], L),
    seedAccount: pda([pk(payer).toBuffer(), pk(TOKEN22).toBuffer(), mint.toBuffer()], ATA),
    escrow: pda([utf8('escrow'), mint.toBuffer()], L),
    launcherSigner: pda([utf8('pangea-oft-launch'), pk(BR).toBuffer()], L),
    gapConfig: pda([utf8('GapV4Config')], BR),
    bridgeConfig: pda([utf8('bridge')], BR),
    mintAuthority: pda([utf8('mint_authority')], BR),
    snapshot: pda([utf8('GapSnapV4'), pool.toBuffer()], BR),
    bridgeProgramData: pda([pk(BR).toBuffer()], BPF),
    chainRow: pcid => pda([utf8('chain'), le(pcid, 4)], BR),
    payerQuote: pda([pk(payer).toBuffer(), pk(TOKEN).toBuffer(), pk(quote).toBuffer()], ATA),
  };
}

// the open's args (OpenV4Args) and accounts; staged = open_v4_staged (args written before by stage_open_v4)
function openParts({ payer, pre, name, symbol, uri, initSqrtPrice, salt, feeBps = 100, quote = SOL.usdc }) {
  const p = preBytes(pre);
  if (p.homePcid !== SOL.pcid) throw new Error('the coin\'s home must be Solana');
  if (bytesToHex(kec(utf8(name))) !== bytesToHex(p.nameHash) || bytesToHex(kec(utf8(symbol))) !== bytesToHex(p.symbolHash)) throw new Error('name / symbol do not match the preimage');
  if (!Number.isInteger(feeBps) || feeBps < 30 || feeBps > 500) throw new Error('Solana pool fee: 0.3% to 5%');
  const coinId = solCoinId(p);
  const A = solAddresses({ coinId, salt, payer, quote });
  const { form, digest } = solUriForm(uri);
  const args = cat(encodePre(p), borshStr(name), borshStr(symbol), [form], digest, le(initSqrtPrice, 16), [0, 0, 0],
    le(0, 8), le(0, 8), le(0, 8), salt, [0]); // no route, no own buy, no buy list, salt, no tokenomics
  const staged = pda([utf8('open_args'), pk(payer).toBuffer(), coinId], SOL.launcher);
  const keys = stagedArgs => [
    { pubkey: pk(payer), isSigner: true, isWritable: true }, ro(pda([utf8('config')], SOL.launcher)),
    { pubkey: pk(payer), isSigner: true, isWritable: false }, ro(pda([utf8('fee_owner')], SOL.launcher)),
    rw(A.mint), rw(A.seedAccount), rw(A.positionNftMint), rw(A.positionNftAccount), rw(A.position), rw(A.pool),
    ro(pda([utf8('pool_authority')], SOL.cpAmm)), ro(quote), rw(A.tokenAVault), rw(A.tokenBVault), rw(A.payerQuote),
    ro(pda([utf8('__event_authority')], SOL.cpAmm)), rw(A.record), ro(TOKEN), ro(TOKEN22), ro(ATA), ro(SystemProgram.programId),
    ro(SOL.cpAmm), ro(SOL.bridge), ro(A.bridgeProgramData), stagedArgs ? rw(staged) : ro(SOL.launcher), ro(A.launcherSigner), ro(A.gapConfig),
    ro(A.bridgeConfig), rw(A.coin), ro(A.mintAuthority), rw(A.escrow), rw(A.snapshot),
    ro(SOL.bridge), ro(SOL.bridge), ro(SOL.bridge), ro(SOL.bridge), // no reader (no route), no open authorisation, no sponsor
    ...p.chains.map(c => ro(A.chainRow(c))),
  ];
  const custom = feeBps !== 100; // the launcher's own pool fee is 1%; anything else opens with the _fee variant
  const fee = custom ? le(feeBps, 2) : new Uint8Array(0);
  return { coinId, addresses: { ...A, staged }, args, keys, custom, fee, salt };
}
const ixOf = (keys, data) => new TransactionInstruction({ programId: pk(SOL.launcher), keys, data: Buffer.from(data) });

// one transaction: open_v4 / open_v4_fee with the args inline (only fits without a compute-budget instruction)
export function openV4Ix(o) {
  const P = openParts(o);
  return { ix: ixOf(P.keys(false), cat(disc(P.custom ? 'open_v4_fee' : 'open_v4'), P.args, P.fee)), coinId: P.coinId, addresses: P.addresses };
}
// two transactions: stage_open_v4 (writes the args) then open_v4_staged / open_v4_staged_fee (carries only the salt)
export function stagedOpenIxs(o) {
  const P = openParts(o);
  const stage = ixOf([{ pubkey: pk(o.payer), isSigner: true, isWritable: true }, rw(P.addresses.staged), ro(SystemProgram.programId)], cat(disc('stage_open_v4'), P.args));
  const open = ixOf(P.keys(true), cat(disc(P.custom ? 'open_v4_staged_fee' : 'open_v4_staged'), P.salt, P.fee));
  return { stage, open, coinId: P.coinId, addresses: P.addresses };
}

// the payer's USDC account (CreateIdempotent): the open takes a unit of the quote from it
const createAtaIx = (payer, owner, mint, program = TOKEN) => new TransactionInstruction({
  programId: pk(ATA), data: Buffer.from([1]),
  keys: [{ pubkey: pk(payer), isSigner: true, isWritable: true }, rw(pda([pk(owner).toBuffer(), pk(program).toBuffer(), pk(mint).toBuffer()], ATA)),
    ro(owner), ro(mint), ro(SystemProgram.programId), ro(program)],
});

/* ---------- RPC ---------- */
let conn = null;
export const solConnection = () => (conn ||= new Connection(RPCS[0], 'confirmed'));
async function lookupTable() {
  const r = await solConnection().getAddressLookupTable(pk(SOL.alt));
  if (!r.value) throw new Error('Pangea\'s Solana lookup table cannot be read');
  return r.value;
}

async function v0(payer, instructions, alt) {
  const { blockhash, lastValidBlockHeight } = await solConnection().getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: pk(payer), recentBlockhash: blockhash, instructions }).compileToV0Message([alt]));
  if (tx.serialize().length > 1232) throw new Error('The Solana transaction is too large');
  return { tx, blockhash, lastValidBlockHeight };
}
const budget = units => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];

// TX 1: the payer's USDC account + the staged args. TX 2: the open (simulated once TX 1 has landed, before it is signed).
export async function buildSolStagedTxs({ payer, pre, name, symbol, uri, mcapUsd, feeBps, salt }) {
  const ixs = stagedOpenIxs({ payer, pre, name, symbol, uri, initSqrtPrice: solInitSqrtPrice(mcapUsd), salt, feeBps });
  const alt = await lookupTable();
  return {
    ...ixs, alt,
    stageTx: () => v0(payer, [...budget(60_000), createAtaIx(payer, payer, SOL.usdc), ixs.stage], alt),
    openTx: () => v0(payer, [...budget(OPEN_UNITS), ixs.open], alt),
  };
}

// dry run (no signature): the RPC replays it on the current state
export async function simulateSolTx(tx) {
  const r = await solConnection().simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  const v = r.value;
  if (v.err) {
    const logs = (v.logs || []).filter(l => /Error|failed|insufficient|custom program error|AnchorError/i.test(l)).slice(-3).join(' · ');
    throw new Error(`Solana simulation failed: ${JSON.stringify(v.err)}${logs ? ` · ${logs}` : ''}`);
  }
  return v;
}

export async function solBalances(owner) {
  const c = solConnection();
  const ata = pda([pk(owner).toBuffer(), pk(TOKEN).toBuffer(), pk(SOL.usdc).toBuffer()], ATA);
  const [lamports, usdc] = await Promise.all([c.getBalance(pk(owner)), c.getTokenAccountBalance(ata).then(r => BigInt(r.value.amount)).catch(() => 0n)]);
  return { sol: lamports / 1e9, usdcRaw: usdc };
}

/* ---------- Solana wallets (Wallet Standard: MetaMask, Phantom, …) ---------- */
const registry = [];
let listening = false;
function standardWallets() {
  if (typeof window === 'undefined') return [];
  const api = { register: (...ws) => { for (const w of ws) if (!registry.includes(w)) registry.push(w); return () => {}; } };
  if (!listening) {
    listening = true;
    window.addEventListener('wallet-standard:register-wallet', e => { try { e.detail(api); } catch {} });
  }
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch {}
  return registry.filter(w => (w.chains || []).some(c => String(c).startsWith('solana:')) && w.features?.['standard:connect'] && (w.features['solana:signTransaction'] || w.features['solana:signAndSendTransaction']));
}

// → { name, address, signAndSend(tx) → signature }
export async function connectSolWallet() {
  await new Promise(r => setTimeout(r, 50)); // let wallets answer app-ready
  const ws = standardWallets();
  const w = ws.find(x => /metamask/i.test(x.name)) || ws.find(x => /phantom/i.test(x.name)) || ws[0];
  if (w) {
    const { accounts } = await w.features['standard:connect'].connect();
    const account = (accounts || w.accounts || []).find(a => (a.chains || []).some(c => String(c).startsWith('solana:'))) || accounts?.[0];
    if (!account) throw new Error(`${w.name} returned no Solana account`);
    return {
      name: w.name, address: account.address,
      async signAndSend(tx) {
        const f = w.features['solana:signTransaction'];
        if (f) {
          const [out] = await f.signTransaction({ account, transaction: tx.serialize(), chain: 'solana:mainnet' });
          return solConnection().sendRawTransaction(out.signedTransaction, { skipPreflight: true, maxRetries: 5 });
        }
        const [out] = await w.features['solana:signAndSendTransaction'].signAndSendTransaction({ account, transaction: tx.serialize(), chain: 'solana:mainnet' });
        const sig = out.signature; let n = 0n; for (const b of sig) n = (n << 8n) | BigInt(b);
        let s = ''; for (; n > 0n; n /= 58n) s = B58[Number(n % 58n)] + s; for (const b of sig) { if (b) break; s = '1' + s; }
        return s;
      },
    };
  }
  const ph = window.phantom?.solana || window.solana;
  if (ph?.connect) {
    const { publicKey } = await ph.connect();
    return {
      name: 'Phantom', address: publicKey.toBase58(),
      async signAndSend(tx) { const signed = await ph.signTransaction(tx); return solConnection().sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 }); },
    };
  }
  throw new Error('No Solana wallet found: enable Solana in MetaMask, or install Phantom');
}

export async function confirmSol(signature, blockhash, lastValidBlockHeight) {
  const r = await solConnection().confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (r.value.err) throw new Error(`The Solana open failed on chain: ${JSON.stringify(r.value.err)}`);
}

// a Solana address as the preimage's 32-byte creatorSvm
export const svmHex = addr => toHex(new PublicKey(addr).toBytes());

/* ---------- a dust of USDC (Jupiter) ---------- */
const SWAP_SOL = 0.0002;
const JUP = 'https://lite-api.jup.ag/swap/v1';
async function swapSolForUsdc(w) {
  const q = await fetch(`${JUP}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${SOL.usdc}&amount=${Math.round(SWAP_SOL * 1e9)}&slippageBps=300`).then(r => r.json());
  if (!q?.outAmount) throw new Error(`Jupiter has no SOL → USDC quote right now${q?.error ? `: ${q.error}` : ''}`);
  const sw = await fetch(`${JUP}/swap`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: w.address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  }).then(r => r.json());
  if (!sw?.swapTransaction) throw new Error(`Jupiter could not build the swap${sw?.error ? `: ${sw.error}` : ''}`);
  if (sw.simulationError) throw new Error(`The SOL → USDC swap would fail: ${JSON.stringify(sw.simulationError).slice(0, 160)}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64'));
  const sig = await w.signAndSend(tx);
  await confirmSol(sig, tx.message.recentBlockhash, sw.lastValidBlockHeight);
}

/* ---------- the whole self-launch ---------- */
const MIN_SOL = 0.05; // (+ the USDC dust swap when the wallet has none) // rent of the mint, pool, vaults, position, coin record, … plus fees
const shortSol = a => `${a.slice(0, 4)}…${a.slice(-4)}`;
// opts: { name, symbol, uri (ipfs://CID), mcapUsd, feeBps, creatorEvm (optional EVM wallet, kept in the coin id), onStep }
export async function launchPangeaSolana({ name, symbol, uri, mcapUsd, feeBps, creatorEvm, onStep = () => {} }) {
  solUriForm(uri); solInitSqrtPrice(mcapUsd); // fail before any wallet prompt
  onStep('Connecting your Solana wallet…');
  const w = await connectSolWallet();
  const bal = await solBalances(w.address);
  if (bal.sol < MIN_SOL) throw new Error(`Your Solana wallet ${shortSol(w.address)} (${w.name}) holds ${bal.sol.toFixed(4)} SOL: a Solana launch needs about ${MIN_SOL} SOL for rent and fees`);
  if (bal.usdcRaw < 1n) {
    // the USDC pool's open takes a unit of USDC from the payer: swap a dust of SOL for it (Jupiter), one more signature
    onStep(`Getting a little USDC: swap ${SWAP_SOL} SOL via Jupiter, confirm in ${w.name}…`);
    await swapSolForUsdc(w);
    if ((await solBalances(w.address)).usdcRaw < 1n) throw new Error('The SOL → USDC swap did not land, try again');
  }
  onStep('Finding the 6ea addresses (~15s)…');
  const { pre, coinId: evmCoinId, token: evmToken } = await pangeaPreimage({ homePcid: SOL.pcid, name, symbol, creator: creatorEvm || zeroAddress, creatorSvm: svmHex(w.address) });
  const coinId = solCoinId(preBytes(pre));
  if (bytesToHex(coinId) !== String(evmCoinId).toLowerCase()) throw new Error('coin id mismatch between Solana and EVM');
  const { salt } = await grindMintSalt(coinId);
  const L = await buildSolStagedTxs({ payer: w.address, pre, name, symbol, uri, mcapUsd, feeBps, salt });
  // TX 1: stage the args (a refundable account)
  const t1 = await L.stageTx();
  await simulateSolTx(t1.tx);
  onStep(`Step 1/2: confirm in ${w.name} (stores the launch's settings)…`);
  const s1 = await w.signAndSend(t1.tx);
  onStep('Step 1/2: waiting for Solana…');
  await confirmSol(s1, t1.blockhash, t1.lastValidBlockHeight);
  // TX 2: the open, dry-run on the real state first
  onStep('Checking the launch on Solana…');
  const t2 = await L.openTx();
  await simulateSolTx(t2.tx);
  onStep(`Step 2/2: confirm the launch in ${w.name}…`);
  const s2 = await w.signAndSend(t2.tx);
  onStep('Step 2/2: waiting for Solana…');
  await confirmSol(s2, t2.blockhash, t2.lastValidBlockHeight);
  const res = { mint: L.addresses.mint.toBase58(), pool: L.addresses.pool.toBase58(), coinId: bytesToHex(coinId), signature: s2, wallet: w.address, evmToken };
  fetch('/api/pangea-registered', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ coinId: res.coinId }) }).catch(() => {});
  return res;
}

