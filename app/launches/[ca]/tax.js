'use client';
// Token page for a Clanker / o1 token (Uniswap v4 pool, fees credited to the platform escrow)
import { useEffect, useState, useCallback } from 'react';
import { formatEther, formatUnits } from 'viem';
import { ipfsUrl } from '../../../lib/market';
import { CHAINS, holdersOn, blockTimeOn, switchChain, waitOn } from '../../../lib/chains';
import { TAX, taxUrl, taxSummary, taxTrades, taxLaunchBlock, taxOwed, taxClaimTx, contractMeta, pinContractMeta, setContractUriTx } from '../../../lib/tax';
import { getEthUsd, short, Spinner, ErrorLine, useWallet, fmt, fmtUsd, toEth } from '../../ui';
import { PriceChart, usdC, priceUsd, ago, compact, Logo } from '../../charts';
import { IconExternal, IconCopy, IconCheck, ChainBadge } from '../../icons';

const RANGES = [{ id: '1h', s: 3600 }, { id: '6h', s: 21600 }, { id: '1D', s: 86400 }, { id: '7D', s: 604800 }, { id: 'All', s: 0 }];

function CopyAddr({ a }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="icon-btn" onClick={() => { navigator.clipboard.writeText(a); setOk(true); setTimeout(() => setOk(false), 1000); }}>{ok ? <IconCheck /> : <IconCopy />}</button>;
}

export default function TaxTokenPage({ pf, chainId, token }) {
  const P = TAX[pf];
  const EXPLORER = CHAINS[chainId].explorer;
  const url = t => taxUrl(pf, t, chainId);
  const w = useWallet();
  const [s, setS] = useState(null);
  const [trades, setTrades] = useState([]);
  const [holders, setHolders] = useState(null);
  const [ethUsd, setEthUsd] = useState(null);
  const [err, setErr] = useState('');
  const [range, setRange] = useState('All');
  const [tab, setTab] = useState('trades');

  const load = useCallback(async () => {
    try {
      const [sum, lb, px, h] = await Promise.all([taxSummary(pf, chainId, token), taxLaunchBlock(pf, chainId, token), getEthUsd(), holdersOn(chainId, token)]);
      const [trs, t0] = lb ? await Promise.all([taxTrades(pf, chainId, sum.poolId, sum.tokenIs0, lb), blockTimeOn(chainId, lb)]) : [[], null];
      setS({ ...sum, logo: ipfsUrl(sum.image), time: t0 }); setTrades(trs); setEthUsd(px); setHolders(h);
    } catch (e) { setErr(e.shortMessage || e.message); }
  }, [pf, chainId, token]);
  useEffect(() => { load(); }, [load]);

  if (err) return <ErrorLine msg={err} onRetry={() => { setErr(''); load(); }} />;
  if (!s) return <Spinner text="Loading token data…" />;

  const px = ethUsd || 0;
  const priceU = s.priceEth != null ? s.priceEth * px : null;
  const mcapU = s.mcapEth != null ? s.mcapEth * px : null;
  const supplyN = Number(formatUnits(s.supply, 18));
  const now = Date.now() / 1000;
  const rs = RANGES.find(r => r.id === range).s;
  const chartTrades = trades.filter(t => t.time && (!rs || t.time >= now - rs)).map(t => ({ time: t.time, price: t.price * px, usdVol: Number(formatEther(t.eth)) * px, side: t.side }));
  const first = chartTrades[0]?.price, change = first && priceU ? ((priceU - first) / first) * 100 : null;
  const volEth = trades.reduce((a, t) => a + t.eth, 0n);
  const soc = s.socials || {};
  const links = [['X', soc.twitter], ['Telegram', soc.telegram], ['Website', soc.website], ['Discord', soc.discord], ['Farcaster', soc.farcaster]].filter(([, u]) => u);

  return (
    <div className="tp">
      <a className="muted small" href="/launches">‹ Launches</a>
      <div className="tp-head">
        <Logo t={s} size={64} />
        <div className="tp-name">
          <h1>{s.name} <span className="muted">{s.symbol}</span> <em className="tag">{P.label}</em><ChainBadge id={chainId} /></h1>
          <div className="muted small tp-sub">
            by <a className="mono" href={`${EXPLORER}/address/${s.deployer}`} target="_blank" rel="noreferrer">{short(s.deployer)}</a>
            <span>· {ago(s.time)} ago</span><span>· ETH pair</span>
            <span className="mono">· {short(s.token)}</span><CopyAddr a={s.token} />
            <a className="pill" href={url(s.token)} target="_blank" rel="noreferrer">{P.label} <IconExternal /></a>
            {links.map(([k, u]) => <a key={k} className="pill" href={u} target="_blank" rel="noreferrer">{k} <IconExternal /></a>)}
          </div>
        </div>
        <div className="tp-mc">
          <span className="muted small">Market cap</span>
          <b>{usdC(mcapU)}</b>
          <span className="muted small">{priceUsd(priceU)} price</span>
        </div>
      </div>

      <div className="tp-grid">
        <div>
          <div className="tp-pricebar">
            <div><b className="tp-price">{priceUsd(priceU)}</b>{change != null && <span className={change >= 0 ? 'ok' : 'err'}> {change >= 0 ? '+' : ''}{change.toFixed(2)}% {range}</span>}</div>
            <div className="seg">{RANGES.map(r => <button key={r.id} type="button" className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.id}</button>)}</div>
          </div>
          <div className="card chart-card"><PriceChart trades={chartTrades} /></div>

          <div className="tp-stats">
            <div><span>Market cap</span><b>{usdC(mcapU)}</b></div>
            <div><span>Holders</span><b>{holders ? holders.count.toLocaleString('en-US') : '…'}</b></div>
            <div><span>Trades</span><b>{trades.length.toLocaleString('en-US')}</b></div>
            <div><span>Supply</span><b>{compact(supplyN)}</b></div>
            <div><span>Volume</span><b>{usdC(Number(formatEther(volEth)) * px)}</b></div>
          </div>
          <div className="tp-stats sm">
            <div><span>Token</span><a className="mono" href={`${EXPLORER}/token/${s.token}`} target="_blank" rel="noreferrer">{short(s.token)}</a></div>
            <div><span>Pool</span><b>Uniswap v4</b></div>
            <div><span>Launch</span><b>{s.time ? new Date(s.time * 1000).toLocaleString('en-US') : '—'}</b></div>
            <div><span>Fee</span><b>{s.buyTax}% buy / {s.sellTax}% sell</b></div>
          </div>

          {!s.contractURI && s.metadataEditable && w.account?.toLowerCase() === s.creator.toLowerCase() && <MetaFix pf={pf} chainId={chainId} s={s} onDone={load} />}
          {s.description && (<><h3>About</h3><p className="tp-about">{s.description}</p></>)}

          <div className="lp-tabs">
            <button type="button" className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trades</button>
            <button type="button" className={tab === 'holders' ? 'on' : ''} onClick={() => setTab('holders')}>Holders</button>
          </div>
          {tab === 'trades' ? (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Side</th><th>Trader</th><th>ETH</th><th>USD</th><th>{s.symbol}</th><th>Price</th><th>Age</th></tr></thead>
                <tbody>
                  {[...trades].reverse().slice(0, 100).map(t => (
                    <tr key={t.tx + t.logIndex}>
                      <td className={t.side === 'Buy' ? 'ok' : 'err'}>{t.side}</td>
                      <td>{t.trader ? <a className="mono" href={`${EXPLORER}/address/${t.trader}`} target="_blank" rel="noreferrer">{short(t.trader)}</a> : '—'}</td>
                      <td>{Number(formatEther(t.eth)).toPrecision(3)}</td>
                      <td>{px ? usdC(Number(formatEther(t.eth)) * px) : '—'}</td>
                      <td>{compact(Number(formatUnits(t.tokens, 18)))}</td>
                      <td>{priceUsd(t.price * px)}</td>
                      <td><a className="muted" href={`${EXPLORER}/tx/${t.tx}`} target="_blank" rel="noreferrer">{ago(t.time)}</a></td>
                    </tr>
                  ))}
                  {!trades.length && <tr><td colSpan={7} className="muted">No trades yet</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>Holder</th><th>Amount</th><th>%</th><th>USD</th></tr></thead>
                <tbody>
                  {(holders?.items || []).map((h, i) => (
                    <tr key={h.address}>
                      <td className="muted">{i + 1}</td>
                      <td><a className="mono" href={`${EXPLORER}/address/${h.address}`} target="_blank" rel="noreferrer">{short(h.address)}</a>
                        {h.address.toLowerCase() === s.deployer.toLowerCase() && <em className="tag warn">creator</em>}</td>
                      <td>{compact(Number(formatUnits(h.value, 18)))}</td>
                      <td>{((Number(formatUnits(h.value, 18)) / supplyN) * 100).toFixed(2)}%</td>
                      <td>{s.priceEth != null && px ? usdC(Number(formatUnits(h.value, 18)) * s.priceEth * px) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tp-side">
          <div className="card tradebox">
            <p className="muted">Trades on a Uniswap v4 pool ({s.buyTax}% buy / {s.sellTax}% sell fee).</p>
            <a className="btn-primary big-btn" href={url(s.token)} target="_blank" rel="noreferrer">Trade on {P.label} <IconExternal /></a>
          </div>
          <TaxFeeBox pf={pf} chainId={chainId} recipient={s.creatorFeeRecipient} account={w.account} connect={w.connect} ethUsd={ethUsd} />
        </div>
      </div>
    </div>
  );
}

// Creator fees sit in the platform escrow (per recipient, all their Clanker tokens); claimFor pays the recipient
function TaxFeeBox({ pf, chainId, recipient, account, connect, ethUsd }) {
  const L = TAX[pf].label;
  const EXPLORER = CHAINS[chainId].explorer;
  const [owed, setOwed] = useState(null);
  const [err, setErr] = useState('');
  const [st, setSt] = useState({ busy: '', hash: '' });
  const load = useCallback(() => { setErr(''); taxOwed(pf, chainId, recipient).then(setOwed).catch(e => setErr(e.shortMessage || e.message)); }, [pf, chainId, recipient]);
  useEffect(() => { load(); }, [load]);

  async function claim() {
    const eth = window.ethereum;
    setSt({ busy: 'Confirm the claim in MetaMask…', hash: '' }); setErr('');
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, chainId);
      const tx = taxClaimTx(pf, chainId, recipient);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
      setSt({ busy: 'Waiting for confirmation…', hash });
      const rc = await waitOn(chainId, hash);
      if (rc.status !== 'success') throw new Error('Claim failed');
      setSt({ busy: '', hash }); load();
    } catch (e) {
      setSt({ busy: '', hash: '' }); setErr(e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message));
    }
  }

  if (owed == null && !err) return <div className="card feebox"><Spinner text="Reading creator fees…" /></div>;
  const isOwner = account && account.toLowerCase() === recipient.toLowerCase();
  return (
    <div className="card feebox">
      <span className="muted small">Total claimable</span>
      <b className="fb-amt">{fmt(owed || 0n)} ETH</b>
      <span className="muted small">{ethUsd && owed != null ? fmtUsd(toEth(owed) * ethUsd) : '—'}</span>
      <small className="muted">{L} credits fees to the recipient on every trade; this total covers all of the recipient's {L} tokens.</small>
      <div className="fb-row">
        <span className="muted small">Fee recipient</span>
        <a className="mono small" href={`${EXPLORER}/address/${recipient}`} target="_blank" rel="noreferrer">{short(recipient)}</a>
        {isOwner && <em className="tag ok">you</em>}
      </div>
      {!owed ? <small className="muted">Nothing to claim right now.</small>
        : isOwner ? <button type="button" className="btn-primary big-btn" disabled={!!st.busy} onClick={claim}>{st.busy || 'Claim fees'}</button>
        : account ? <small className="muted">Connect the fee recipient wallet to claim.</small>
        : <button type="button" className="btn-ghost" onClick={connect}>Connect wallet to claim</button>}
      {st.hash && <a className="ok small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">Transaction {short(st.hash)} <IconExternal /></a>}
      {err && <ErrorLine msg={err} onRetry={load} />}
    </div>
  );
}

// Token launched without contractURI: the creator publishes it (image, description, links) so the launchpad site shows them
function MetaFix({ pf, chainId, s, onDone }) {
  const [st, setSt] = useState({ busy: '', err: '' });
  async function run() {
    const eth = window.ethereum;
    setSt({ busy: 'Uploading metadata…', err: '' });
    try {
      const soc = s.socials || {};
      const uri = await pinContractMeta(contractMeta({ name: s.name, symbol: s.symbol, description: s.description, ...soc }, s.image));
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, chainId);
      setSt({ busy: 'Confirm in MetaMask…', err: '' });
      const tx = setContractUriTx(pf, chainId, s.token, uri);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
      setSt({ busy: 'Confirming…', err: '' });
      const rc = await waitOn(chainId, hash);
      if (rc.status !== 'success') throw new Error('Transaction failed');
      setSt({ busy: '', err: '' }); onDone?.();
    } catch (e) { setSt({ busy: '', err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message) }); }
  }
  return (
    <div className="card">
      <p className="small">The image, description and links are not published for {TAX[pf].label} yet, so its site shows the token without them. As the creator you can publish them now (one transaction).</p>
      <button type="button" className="btn-primary sm" disabled={!!st.busy} onClick={run}>{st.busy || 'Publish token info'}</button>
      {st.err && <ErrorLine msg={st.err} />}
    </div>
  );
}
