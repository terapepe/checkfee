'use client';
// Token page for a Pangea v4 coin (Robinhood): price from the v4 pool, creator fees from the fee hook + FeeSplitterV4
import { useEffect, useState, useCallback } from 'react';
import { formatUnits } from 'viem';
import { ipfsUrl } from '../../../lib/market';
import { CHAINS, holdersOn, switchChain, waitOn } from '../../../lib/chains';
import { pangeaSummary, pangeaFees, pangeaPaid, pangeaClaimTx, pangeaClaimUnclaimedTx, pangeaMetaAuthority, pangeaSetMetaTx } from '../../../lib/pangea';
import { contractMeta, pinContractMeta } from '../../../lib/tax';
import { getEthUsd, short, Spinner, ErrorLine, useWallet, fmt, fmtUsd, toEth, SwitchToWallet } from '../../ui';
import { usdC, priceUsd, compact, Logo } from '../../charts';
import { IconExternal, ChainBadge, IconRefresh } from '../../icons';

const CHAIN = 4663;
const EXPLORER = CHAINS[CHAIN].explorer;

export default function PangeaTokenPage({ token }) {
  const w = useWallet();
  const [s, setS] = useState(null);
  const [holders, setHolders] = useState(null);
  const [ethUsd, setEthUsd] = useState(null);
  const [err, setErr] = useState('');
  const [rk, setRk] = useState(0);
  const load = useCallback(async () => {
    try {
      holdersOn(CHAIN, token).then(setHolders).catch(() => {});
      const [sum, px] = await Promise.all([pangeaSummary(token), getEthUsd()]);
      setS({ ...sum, logo: ipfsUrl(sum.image) }); setEthUsd(px); setRk(k => k + 1);
    } catch (e) { setErr(e.shortMessage || e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (s?.name) document.title = `${s.name} ($${s.symbol}) · CheckFee v1`; }, [s?.name, s?.symbol]);

  if (err) return <ErrorLine msg={err} onRetry={() => { setErr(''); load(); }} />;
  if (!s) return <Spinner text="Loading token data…" />;
  const px = ethUsd || 0;
  const soc = s.socials;
  const links = [['X', soc.twitter], ['Telegram', soc.telegram], ['Website', soc.website], ['Discord', soc.discord], ['Farcaster', soc.farcaster]].filter(([, u]) => u);
  const supplyN = Number(formatUnits(s.supply, 9));
  return (
    <div className="tp">
      <a className="muted small" href="/launches">‹ Launches</a>
      <div className="tp-head">
        <Logo t={s} size={64} />
        <div className="tp-name">
          <h1>{s.name} <span className="muted">{s.symbol}</span> <em className="tag">Pangea</em><ChainBadge id={CHAIN} /></h1>
          <div className="muted small tp-sub">
            <span>by <a className="mono" href={`${EXPLORER}/address/${s.launcher}`} target="_blank" rel="noreferrer">{short(s.launcher)}</a></span>
            <span>· ETH pair</span><span className="mono">· {short(s.token)}</span>
            <button type="button" className="pill pill-btn" onClick={load}><IconRefresh />Refresh</button>
            <a className="pill" href={`https://www.pangea.trade/app/t/${s.token}`} target="_blank" rel="noreferrer">Pangea <IconExternal /></a>
            {links.map(([k, u]) => <a key={k} className="pill" href={u} target="_blank" rel="noreferrer">{k} <IconExternal /></a>)}
          </div>
        </div>
        <div className="tp-mc">
          <span className="muted small">Market cap</span>
          <b>{usdC(s.mcapEth != null ? s.mcapEth * px : null)}</b>
          <span className="muted small">{priceUsd(s.priceEth != null ? s.priceEth * px : null)} price</span>
        </div>
      </div>
      <div className="tp-grid">
        <div>
          <div className="tp-stats">
            <div><span>Holders</span><b>{holders ? holders.count.toLocaleString('en-US') : '…'}</b></div>
            <div><span>Supply</span><b>{compact(supplyN)}</b></div>
            <div><span>Fee</span><b>{s.feeBps / 100}% buy &amp; sell</b></div>
            <div><span>Pool</span><b>Uniswap v4</b></div>
          </div>
          {!s.linksOk && <MetaFix s={s} account={w.account} onDone={load} />}
          {s.description && (<><h3>About</h3><p className="tp-about">{s.description}</p></>)}
        </div>
        <div className="tp-side">
          <PangeaFeeBox key={rk} s={s} account={w.account} connect={w.connect} ethUsd={ethUsd} />
        </div>
      </div>
    </div>
  );
}

// Fees wait in the hook → splitter; the claim tx (anyone can send it) pays the creator 80%, Pangea 20%
function PangeaFeeBox({ s, account, connect, ethUsd }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [st, setSt] = useState({ busy: '', hash: '' });
  const [paid, setPaid] = useState(null);
  const load = useCallback(() => {
    setErr(''); pangeaFees(s.token, s.splitter, s.creator).then(setF).catch(e => setErr(e.shortMessage || e.message));
    pangeaPaid(s.splitter).then(setPaid).catch(() => {});
  }, [s]);
  useEffect(() => { load(); }, [load]);

  async function claim() {
    const eth = window.ethereum;
    setSt({ busy: 'Confirm the claim in MetaMask…', hash: '' }); setErr('');
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, CHAIN);
      let hash;
      if (f.pending > 0n) {
        const tx = pangeaClaimTx(s.token, s.splitter);
        hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
        setSt({ busy: 'Waiting for confirmation…', hash });
        if ((await waitOn(CHAIN, hash)).status !== 'success') throw new Error('Claim failed');
      }
      if (f.unclaimed > 0n && from.toLowerCase() === s.creator.toLowerCase()) { // only the payee itself can pull a held payout
        setSt({ busy: 'Confirm the held payout in MetaMask…', hash });
        const tx = pangeaClaimUnclaimedTx(s.splitter, from);
        hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
        if ((await waitOn(CHAIN, hash)).status !== 'success') throw new Error('Claim failed');
      }
      setSt({ busy: '', hash }); load();
    } catch (e) {
      setSt({ busy: '', hash: '' }); setErr(e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message));
    }
  }

  if (f == null && !err) return <div className="card feebox"><Spinner text="Reading creator fees…" /></div>;
  const isOwner = account && [s.creator, s.launcher].some(a => a.toLowerCase() === account.toLowerCase());
  const amt = f?.claimable || 0n;
  return (
    <div className="card feebox">
      <span className="muted small">Claimable creator fees</span>
      <b className="fb-amt">{fmt(amt)} ETH</b>
      <span className="muted small">{ethUsd ? fmtUsd(toEth(amt) * ethUsd) : '—'}</span>
      <small className="muted">Pangea keeps 20% of the trading fee; the claim sends the rest straight to the {s.toVault ? 'holder-rewards vault' : 'creator wallet'}.</small>
      <div className="fb-row">
        <span className="muted small">Already paid out</span>
        <b className="small">{paid == null ? '…' : `${fmt(paid)} ETH`}{paid && ethUsd ? ` · ${fmtUsd(toEth(paid) * ethUsd)}` : ''}</b>
      </div>
      <div className="fb-row">
        <span className="muted small">{s.toVault ? 'Fees go to' : 'Creator wallet'}</span>
        <a className="mono small" href={`${EXPLORER}/address/${s.creator}`} target="_blank" rel="noreferrer">{short(s.creator)}</a>
        {s.toVault && <em className="tag">holder rewards vault</em>}
        {isOwner && <em className="tag ok">you</em>}
      </div>
      {!amt ? <small className="muted">Nothing to claim right now.</small>
        : isOwner || s.toVault || (f.unclaimed === 0n && account) ? <button type="button" className="btn-primary big-btn" disabled={!!st.busy} onClick={claim}>{st.busy || (s.toVault ? 'Send fees to the vault' : isOwner ? 'Claim fees' : 'Claim to creator wallet')}</button>
        : account ? <SwitchToWallet target={s.creator} />
        : <button type="button" className="btn-ghost" onClick={connect}>Connect wallet to claim</button>}
      {st.hash && <a className="ok small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">Transaction {short(st.hash)} <IconExternal /></a>}
      {err && <ErrorLine msg={err} onRetry={load} />}
    </div>
  );
}

// Links saved under "links" only (older CheckFee launches): Pangea doesn't show them. The metadata authority re-publishes them.
function MetaFix({ s, account, onDone }) {
  const [auth, setAuth] = useState(null);
  const [st, setSt] = useState({ busy: '', err: '' });
  useEffect(() => { pangeaMetaAuthority(s.token).then(setAuth).catch(() => {}); }, [s.token]);
  if (!auth || !account || auth.toLowerCase() !== account.toLowerCase()) return null;
  async function run() {
    const eth = window.ethereum;
    setSt({ busy: 'Uploading metadata…', err: '' });
    try {
      const uri = await pinContractMeta(contractMeta({ name: s.name, symbol: s.symbol, description: s.description, ...s.socials }, s.image));
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, CHAIN);
      setSt({ busy: 'Confirm in MetaMask…', err: '' });
      const tx = pangeaSetMetaTx(s.token, uri);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
      setSt({ busy: 'Confirming…', err: '' });
      if ((await waitOn(CHAIN, hash)).status !== 'success') throw new Error('Transaction failed');
      setSt({ busy: '', err: '' }); onDone?.();
    } catch (e) { setSt({ busy: '', err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message) }); }
  }
  return (
    <div className="card">
      <p className="small">Pangea doesn't show this token's X / website / Telegram links yet (they are saved in a format it doesn't read). As the metadata owner you can re-publish them (one transaction).</p>
      <button type="button" className="btn-primary sm" disabled={!!st.busy} onClick={run}>{st.busy || 'Publish links for Pangea'}</button>
      {st.err && <ErrorLine msg={st.err} />}
    </div>
  );
}
