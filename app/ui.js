'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { formatUnits, zeroAddress, isAddress } from 'viem';
import { checkWallet, checkTokens } from '../lib/pons';
import {
  Logo, IconWallet, IconWallets, IconCoin, IconExternal, IconCopy, IconCheck,
  IconAlert, IconRefresh, IconBolt, IconPower, TokenAvatar,
} from './icons';

export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const PONS = 'https://ponsfamily.com/launchpad';
export const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const fmt = (v, d = 18) => {
  const s = formatUnits(BigInt(v || 0), d);
  const [i, f = ''] = s.split('.');
  return f ? `${i}.${f.slice(0, 8).replace(/0+$/, '') || '0'}` : i;
};
export const toEth = wei => Number(formatUnits(BigInt(wei || 0), 18));
export const fmtUsd = v => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;

/* ---------------- Connected wallet (shared across the site) ---------------- */
const WalletCtx = createContext({ account: '', connect() {}, disconnect() {} });
export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState('');
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onChange = a => setAccount(a?.[0] || '');
    eth.request({ method: 'eth_accounts' }).then(onChange).catch(() => {});
    eth.on?.('accountsChanged', onChange);
    return () => eth.removeListener?.('accountsChanged', onChange);
  }, []);
  async function connect() {
    if (!window.ethereum) return alert('MetaMask not found in this browser');
    const a = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(() => []);
    setAccount(a?.[0] || '');
  }
  async function disconnect() {
    await window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
    setAccount('');
  }
  return <WalletCtx.Provider value={{ account, connect, disconnect }}>{children}</WalletCtx.Provider>;
}

/* ---------------- Page shell: left sidebar ---------------- */
const NAV = [
  { section: 'Create a token', items: [
    { href: '/launches', label: 'Launches', icon: IconWallets },
    { href: '/launch', label: 'Launch token', icon: IconBolt },
  ] },
  { section: 'Tools', items: [
    { href: '/', label: 'Check wallet', icon: IconWallet },
    { href: '/multi', label: 'Check multiple wallets', icon: IconWallets },
    { href: '/ca', label: 'Check by CA', icon: IconCoin },
  ] },
];

export function Shell({ children }) {
  const path = usePathname();
  const w = useWallet();
  return (
    <div className="shell">
      <aside className="side">
        <a href="/" className="brand">
          <Logo />
          <div><b>CheckFee</b><span>v1</span></div>
        </a>
        <nav className="menu">
          {NAV.map(({ section, items }) => (
            <div key={section} className="menu-group">
              <div className="menu-label">{section}</div>
              {items.map(({ href, label, icon: Icon }) => (
                <a key={href} href={href} className={path === href || (href === '/launches' && path?.startsWith('/launches/')) ? 'on' : ''}><Icon />{label}</a>
              ))}
            </div>
          ))}
          <div className="menu-label">Links</div>
          <a href="https://ponsfamily.com" target="_blank" rel="noreferrer"><IconExternal width={18} height={18} />Pons Family</a>
          <a href={EXPLORER} target="_blank" rel="noreferrer"><IconExternal width={18} height={18} />Blockscout</a>
        </nav>
        <div className="side-foot">
          {w.account ? (
            <button type="button" className="wallet-btn on" onClick={w.disconnect} title="Disconnect">
              <span className="dot" /><span className="mono">{short(w.account)}</span><IconPower />
            </button>
          ) : (
            <button type="button" className="wallet-btn" onClick={w.connect}><IconWallet />Connect Wallet</button>
          )}
          <div className="chain"><span className="dot live" />Robinhood Chain · 4663</div>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

export function PageHeader({ icon: Icon, title, desc }) {
  return (
    <header className="page-head">
      <div className="ph-icon"><Icon width={22} height={22} /></div>
      <div><h1>{title}</h1><p>{desc}</p></div>
    </header>
  );
}

/* ---------------- Buttons & transactions ---------------- */
function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="icon-btn" type="button" title="Copy"
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

const CHAIN_HEX = '0x1237'; // 4663
async function ensureChain(eth) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CHAIN_HEX, chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER],
      }],
    });
  }
}

function SendButton({ wallet, to, data }) {
  const [state, setState] = useState({ busy: false, hash: '', err: '' });
  async function send() {
    const eth = window.ethereum;
    if (!eth) return setState({ busy: false, hash: '', err: 'MetaMask not found in this browser' });
    setState({ busy: true, hash: '', err: '' });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      if (from.toLowerCase() !== wallet.toLowerCase()) throw new Error(`MetaMask is on ${short(from)}, please switch to ${short(wallet)}`);
      await ensureChain(eth);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to, data, value: '0x0' }] });
      setState({ busy: false, hash, err: '' });
    } catch (e) {
      setState({ busy: false, hash: '', err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.message || String(e)) });
    }
  }
  return (
    <div className="send">
      <button type="button" className="btn-primary sm" onClick={send} disabled={state.busy}>
        <IconBolt />{state.busy ? 'Waiting for MetaMask…' : 'Send with MetaMask'}
      </button>
      {state.hash && <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="ok">Sent {short(state.hash)} <IconExternal /></a>}
      {state.err && <span className="err">{state.err}</span>}
    </div>
  );
}

function Tx({ step, title, to, data, fn, wallet }) {
  return (
    <div className="tx">
      <div className="tx-head">
        <span className="step">{step}</span>
        <div><b>{title}</b><span className="muted mono"> {fn}</span></div>
        <SendButton wallet={wallet} to={to} data={data} />
      </div>
      <div className="tx-grid">
        <span>To</span><code>{to}</code><Copy text={to} />
        <span>Amount</span><code>0</code><span />
        <span>Hex data</span><code>{data}</code><Copy text={data} />
      </div>
    </div>
  );
}

/* ---------------- Display cards ---------------- */
const REASON = {
  InternalSwapRequiresOperator: 'Needs an internal swap (buyback / token-fee conversion), so only the Pons operator can sweep. Wait for Pons to sweep, then claim from escrow.',
  NotCreatorFeeRecipient: 'This wallet is not the current fee recipient of the token.',
};

export function Stats({ items }) {
  return (
    <div className="stats">
      {items.map(s => (
        <div className="stat" key={s.label}>
          <span>{s.label}</span><b className={s.accent ? 'accent' : ''}>{s.value}</b>{s.sub && <small>{s.sub}</small>}
        </div>
      ))}
    </div>
  );
}

export function TokenCard({ t, ethUsd, mode = 'wallet' }) {
  if (t.error) {
    return (
      <div className="card token err-card">
        <div className="tk-head"><IconAlert /><code>{t.token}</code></div>
        <p className="err">{t.error}</p>
      </div>
    );
  }
  const isEth = t.quote === zeroAddress;
  const usd = isEth && ethUsd ? fmtUsd(toEth(t.estimatedCreator) * ethUsd) : null;
  return (
    <div className="card token">
      <div className="tk-head">
        <TokenAvatar address={t.token} symbol={t.symbol} />
        <div className="tk-name">
          <a href={`${PONS}/${t.token}`} target="_blank" rel="noreferrer"><b>{t.name}</b> <span className="muted">${t.symbol}</span></a>
          <div className="tk-links">
            <span className="mono">{short(t.token)}</span><Copy text={t.token} />
            <a href={`${PONS}/${t.token}`} target="_blank" rel="noreferrer" className="pill">Pons <IconExternal /></a>
            <a href={`${EXPLORER}/token/${t.token}`} target="_blank" rel="noreferrer" className="pill">Blockscout <IconExternal /></a>
          </div>
        </div>
        <div className="tk-amount">
          <span className="badge">{t.phaseName}</span>
          <b>≈ {fmt(t.estimatedCreator, t.quoteDecimals)} {t.quoteSymbol}</b>
          {t.splitter && <small>creator share 90%</small>}
          {usd && <small>{usd}</small>}
        </div>
      </div>
      <div className="kv">
        <span>Fee recipient</span>
        <span className={mode === 'ca' || t.isRecipient || t.splitter ? '' : 'warn'}>
          <a className="mono" href={`${EXPLORER}/address/${t.creatorFeeRecipient}`} target="_blank" rel="noreferrer">{t.creatorFeeRecipient}</a>
          {t.splitter ? <em className="tag ok">fee splitter</em> : mode === 'wallet' && (t.isRecipient ? <em className="tag ok">this wallet</em> : <em className="tag warn">other wallet</em>)}
        </span>
        {t.splitter && (
          <><span>90/10 split</span><span>
            <a className="mono" href={`${EXPLORER}/address/${t.splitter.address}`} target="_blank" rel="noreferrer">{short(t.splitter.address)}</a>
            <i>creator {short(t.splitter.creator)} · {t.splitter.deployed ? 'deployed' : 'deploys on first claim'}{BigInt(t.splitter.inEscrow) > 0n ? ` · ${fmt(t.splitter.inEscrow)} ETH already in escrow` : ''}</i>
          </span></>
        )}
        <span>Creator tax to sweep</span><span>{fmt(t.pendingCreatorTax, t.quoteDecimals)} {t.quoteSymbol} <i>100% to creator</i></span>
        <span>Base fee to sweep</span><span>{fmt(t.pendingBaseFee, t.quoteDecimals)} {t.quoteSymbol} <i>total, protocol takes {t.protocolFeeShareBps / 100}%</i></span>
        {t.phase === 2 && BigInt(t.pendingTokenSideFee) > 0n && (
          <><span>Token-side fee</span><span>{fmt(t.pendingTokenSideFee)} {t.symbol} <i>needs operator conversion</i></span></>
        )}
        <span>Settings</span><span>Creator tax {t.creatorTaxBps / 100}% · buyback {t.buybackEnabled ? 'on' : 'off'}</span>
        <span>Sweep</span>
        <span>
          {!t.sweep ? <i>Nothing to sweep</i>
            : t.sweep.ok ? <span className="ok">{t.splitter ? '1 tx: sweep + claim + 90/10 split, anyone can send it' : mode === 'ca' ? 'Fee recipient can sweep' : 'This wallet can sweep'} (simulated)</span>
            : <span className="err">{REASON[t.sweep.reason] || `Simulation failed: ${t.sweep.reason}`}</span>}
        </span>
      </div>
    </div>
  );
}

function EscrowRow({ a, ethUsd }) {
  const usd = a.asset === zeroAddress && ethUsd ? fmtUsd(toEth(a.balance) * ethUsd) : null;
  return (
    <div className="escrow-row">
      <span>{a.symbol} {a.asset !== zeroAddress && <span className="mono muted">{short(a.asset)}</span>}</span>
      <b>{fmt(a.balance, a.decimals)} {a.symbol}{usd && <small> · {usd}</small>}</b>
    </div>
  );
}

// One click for every step: atomic batch (EIP-5792 wallet_sendCalls) when MetaMask supports it
// on this chain → a single confirmation; otherwise sends the steps one after another automatically.
const rpcWait = async hash => {
  for (let i = 0; i < 90; i++) {
    const r = await fetch('https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }) }).then(x => x.json()).catch(() => ({}));
    if (r.result) { if (r.result.status !== '0x1') throw new Error('Transaction failed'); return r.result; }
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('Timed out waiting for confirmation');
};

function ClaimAll({ wallet, calls }) {
  const [st, setSt] = useState({ busy: '', done: '', err: '' });
  async function run() {
    const eth = window.ethereum;
    if (!eth) return setSt({ err: 'MetaMask not found in this browser' });
    try {
      setSt({ busy: 'Preparing…' });
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      if (from.toLowerCase() !== wallet.toLowerCase()) throw new Error(`MetaMask is on ${short(from)}, please switch to ${short(wallet)}`);
      await ensureChain(eth);
      const caps = await eth.request({ method: 'wallet_getCapabilities', params: [from, [CHAIN_HEX]] }).catch(() => null);
      const atomic = caps?.[CHAIN_HEX]?.atomic?.status;
      if (atomic === 'supported' || atomic === 'ready') {
        setSt({ busy: 'Confirm the batch in MetaMask…' });
        const { id } = await eth.request({ method: 'wallet_sendCalls', params: [{ version: '2.0.0', from, chainId: CHAIN_HEX, atomicRequired: true, calls: calls.map(c => ({ ...c, value: '0x0' })) }] });
        setSt({ busy: 'Waiting for confirmation…' });
        for (let i = 0; i < 90; i++) {
          const r = await eth.request({ method: 'wallet_getCallsStatus', params: [id] }).catch(() => null);
          if (r?.status >= 200 && r.status < 300) return setSt({ done: r.receipts?.[0]?.transactionHash || 'ok' });
          if (r?.status >= 400) throw new Error('Batch failed');
          await new Promise(res => setTimeout(res, 2000));
        }
        throw new Error('Timed out waiting for the batch');
      }
      let last = '';
      for (let i = 0; i < calls.length; i++) {
        setSt({ busy: `Step ${i + 1}/${calls.length}: confirm in MetaMask…` });
        last = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: calls[i].to, data: calls[i].data, value: '0x0' }] });
        setSt({ busy: `Step ${i + 1}/${calls.length}: waiting for confirmation…` });
        await rpcWait(last);
      }
      setSt({ done: last });
    } catch (e) {
      setSt({ err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message || String(e)) });
    }
  }
  return (
    <div className="claim-all">
      <button type="button" className="btn-primary" onClick={run} disabled={!!st.busy}><IconBolt />{st.busy || `Claim all (${calls.length} steps in one click)`}</button>
      {st.done && <span className="ok small">Done{st.done.startsWith('0x') && <> · <a href={`${EXPLORER}/tx/${st.done}`} target="_blank" rel="noreferrer">tx <IconExternal /></a></>}</span>}
      {st.err && <span className="err small">{st.err}</span>}
      <small className="muted">Uses a single MetaMask confirmation when your wallet supports batched calls on this chain; otherwise sends each step automatically.</small>
    </div>
  );
}

// Claim steps for one fee recipient
export function ClaimSteps({ wallet, tokens, escrow }) {
  const sweeps = tokens.filter(t => !t.error && t.sweep?.ok);
  const claimAssets = escrow.filter(a => BigInt(a.balance) > 0n || sweeps.some(t => !t.splitter && t.quote === a.asset));
  if (!sweeps.length && !claimAssets.length) return <p className="empty">Nothing to claim right now.</p>;
  return (
    <div className="card claim">
      <p className="muted">Connect MetaMask with wallet <span className="mono">{short(wallet)}</span> and run the steps in order, waiting for each to confirm. The page switches to Robinhood Chain automatically. You can also copy To / Hex data and send manually (MetaMask → Settings → Advanced → Show hex data).</p>
      {sweeps.length + claimAssets.length > 1 && (
        <ClaimAll wallet={wallet} calls={[...sweeps.map(t => ({ to: t.sweep.to, data: t.sweep.data })), ...claimAssets.map(a => ({ to: a.claim.to, data: a.claim.data }))]} />
      )}
      {sweeps.map((t, i) => (
        <Tx key={t.token} step={i + 1} title={t.splitter ? `Claim ${t.symbol} fees (sweep + 90/10 split)` : `Sweep ${t.symbol} fees into escrow`} to={t.sweep.to} data={t.sweep.data} fn={t.sweep.fn} wallet={wallet} />
      ))}
      {claimAssets.map((a, i) => (
        <Tx key={a.asset} step={sweeps.length + i + 1} title={`Claim ${a.symbol} from escrow to wallet`} to={a.claim.to} data={a.claim.data} fn={a.claim.fn} wallet={wallet} />
      ))}
      <a className="muted small" href={`${EXPLORER}/address/${wallet}?tab=internal_txns`} target="_blank" rel="noreferrer">Check the result on Blockscout <IconExternal /></a>
    </div>
  );
}

// total ETH (estimated unswept + escrow) for one wallet result
export function walletEthTotals(res) {
  const pending = res.tokens.filter(t => !t.error && t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);
  const escrow = BigInt(res.escrow.find(a => a.asset === zeroAddress)?.balance || 0);
  return { pending, escrow };
}

export function WalletResult({ res, compact }) {
  const { pending, escrow } = walletEthTotals(res);
  const total = toEth(pending + escrow);
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet />
        <a className="mono" href={`${EXPLORER}/address/${res.wallet}`} target="_blank" rel="noreferrer">{res.wallet}</a>
      </div>
      <Stats items={[
        { label: 'Token', value: res.tokens.length },
        { label: 'To sweep (est.)', value: `${fmt(pending)} ETH` },
        { label: 'Trong escrow', value: `${fmt(escrow)} ETH` },
        { label: 'Total claimable', value: res.ethUsd ? fmtUsd(total * res.ethUsd) : `${fmt(pending + escrow)} ETH`, accent: true, sub: res.ethUsd ? `ETH ≈ $${res.ethUsd.toLocaleString('en-US')}` : null },
      ]} />

      <h3>Token</h3>
      {res.tokens.length === 0 && <p className="empty">No Pons v2 tokens created by, or with fees assigned to, this wallet.</p>}
      <div className={compact ? 'tokens compact' : 'tokens'}>
        {res.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={res.ethUsd} />)}
      </div>

      <h3>Escrow balance <span className="muted">· claimable now</span></h3>
      <div className="card">{res.escrow.map(a => <EscrowRow key={a.asset} a={a} ethUsd={res.ethUsd} />)}</div>

      <h3>Claim with MetaMask</h3>
      <ClaimSteps wallet={res.wallet} tokens={res.tokens} escrow={res.escrow} />
    </section>
  );
}

export function RecipientBlock({ r, tokens, ethUsd }) {
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet /><span className="muted">Fee recipient</span>
        <a className="mono" href={`${EXPLORER}/address/${r.wallet}`} target="_blank" rel="noreferrer">{r.wallet}</a>
        <Copy text={r.wallet} />
      </div>
      <div className="card">{r.escrow.map(a => <EscrowRow key={a.asset} a={a} ethUsd={ethUsd} />)}</div>
      <p className="muted small">Escrow pools fees from all of this wallet's tokens (including tokens not in the CA list).</p>
      <ClaimSteps wallet={r.wallet} tokens={tokens} escrow={r.escrow} />
    </section>
  );
}

export function ErrorLine({ msg, onRetry, disabled }) {
  return (
    <div className="alert">
      <IconAlert /><span>{msg}</span>
      {onRetry && <button type="button" className="btn-ghost sm" onClick={onRetry} disabled={disabled}><IconRefresh />Retry</button>}
    </div>
  );
}

export const Spinner = ({ text = 'Reading on-chain data…' }) => <div className="loading"><span className="spin" />{text}</div>;

/* ---------------- Data fetching (runs in the browser) ---------------- */
// Read on-chain from the user's IP so the public RPC doesn't block the server IP; retry on rate limits.
let ethUsdCache = null;
export async function getEthUsd() {
  if (ethUsdCache) return ethUsdCache;
  try {
    const j = await fetch('/api/price', { cache: 'no-store' }).then(r => r.json());
    return (ethUsdCache = j.ethUsd || null);
  } catch { return null; }
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const [data, ethUsd] = await Promise.all([fn(), getEthUsd()]);
      return { ...data, ethUsd };
    } catch (e) { last = new Error(e?.shortMessage || e?.message || String(e)); }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
}

export function fetchWallet(wallet) {
  if (!isAddress(wallet, { strict: false })) return Promise.reject(new Error('Invalid wallet address'));
  return withRetry(() => checkWallet(wallet));
}

export function fetchTokens(cas) {
  return withRetry(() => checkTokens(cas));
}

export function parseAddresses(text) {
  const list = [...new Set(text.split(/[\s,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean))];
  return { list, bad: list.filter(w => !/^0x[0-9a-f]{40}$/.test(w)) };
}
