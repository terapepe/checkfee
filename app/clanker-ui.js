'use client';
// Clanker parts of the Check pages + the Pons/Clanker platform toggle
import { useEffect, useState } from 'react';
import { Stats, ErrorLine, EXPLORER, short, fmt, fmtUsd, toEth, useWallet } from './ui';
import { IconWallet, IconExternal } from './icons';
import { CLANKER, clankerClaimData } from '../lib/clanker';
import { waitTx } from '../lib/market';

const KEY = 'checkfee_platforms';

// which platforms to check; at least one stays on; remembered in this browser
export function usePlatforms() {
  const [p, setP] = useState({ pons: true, clanker: true });
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && (v.pons || v.clanker)) setP(v); } catch {} }, []);
  const toggle = k => setP(v => {
    const n = { ...v, [k]: !v[k] };
    if (!n.pons && !n.clanker) return v;
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {}
    return n;
  });
  return [p, toggle];
}

export function PlatformToggle({ value, onToggle, disabled }) {
  return (
    <div className="pf-toggle">
      <span className="muted small">Check on</span>
      {[['pons', 'Pons'], ['clanker', 'Clanker']].map(([k, l]) => (
        <button key={k} type="button" className={`chip${value[k] ? ' on' : ''}`} aria-pressed={value[k]} disabled={disabled} onClick={() => onToggle(k)}>{l}</button>
      ))}
    </div>
  );
}

export function ClankerClaim({ wallet, owed, onDone }) {
  const w = useWallet();
  const [st, setSt] = useState({ busy: '', err: '', hash: '' });
  if (!owed) return null;
  if (!w.account || w.account.toLowerCase() !== wallet.toLowerCase()) return <small className="muted">Connect {short(wallet)} to claim</small>;
  async function claim() {
    const eth = window.ethereum;
    setSt({ busy: 'Confirm in MetaMask…', err: '', hash: '' });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: CLANKER.escrow, data: clankerClaimData(wallet), value: '0x0' }] });
      setSt({ busy: 'Confirming…', err: '', hash });
      const rc = await waitTx(hash);
      if (rc.status !== 'success') throw new Error('Claim failed');
      setSt({ busy: '', err: '', hash }); onDone?.();
    } catch (e) { setSt({ busy: '', err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message), hash: '' }); }
  }
  return (
    <>
      <button type="button" className="btn-primary sm" disabled={!!st.busy} onClick={claim}>{st.busy || 'Claim all'}</button>
      {st.hash && !st.busy && <a className="ok small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">Claimed <IconExternal /></a>}
      {st.err && <ErrorLine msg={st.err} />}
    </>
  );
}

function ClankerTokenRow({ t, ethUsd, wallet }) {
  return (
    <a className="card ctk" href={`/launches/${t.token}`}>
      <span><b>{t.name}</b> <span className="muted">{t.symbol}</span> <em className="tag">Clanker</em>
        {wallet && t.recipient !== wallet && <em className="tag warn">fees go to {short(t.recipient)}</em>}</span>
      <span className="mono small muted">{short(t.token)}</span>
      <span className="ctk-amt"><small className="muted">Fees earned</small> <b>{fmt(t.earned)} ETH</b>{ethUsd ? <small className="muted"> {fmtUsd(toEth(t.earned) * ethUsd)}</small> : null}</span>
    </a>
  );
}

export function ClankerWalletResult({ res, ethUsd, onReload }) {
  const owedEth = toEth(res.owed);
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet /><em className="tag">Clanker</em>
        <a className="mono" href={`${EXPLORER}/address/${res.wallet}`} target="_blank" rel="noreferrer">{res.wallet}</a>
      </div>
      <Stats items={[
        { label: 'Token', value: res.tokens.length },
        { label: 'In escrow', value: `${fmt(res.owed)} ETH` },
        { label: 'Total claimable', value: ethUsd ? fmtUsd(owedEth * ethUsd) : `${fmt(res.owed)} ETH`, accent: true,
          action: <ClankerClaim wallet={res.wallet} owed={res.owed} onDone={onReload} /> },
      ]} />
      <p className="muted small">Clanker credits creator fees to the escrow on every trade, so there is nothing to sweep: one claim pays all of this wallet's Clanker fees in ETH.</p>
      {res.tokens.length === 0 ? <p className="empty">No Clanker tokens created by, or with fees assigned to, this wallet.</p>
        : <div className="ctk-list">{res.tokens.map(t => <ClankerTokenRow key={t.token} t={t} ethUsd={ethUsd} wallet={res.wallet} />)}</div>}
    </section>
  );
}

export function ClankerCAResult({ res, ethUsd, onReload }) {
  return (
    <>
      <div className="ctk-list">
        {res.tokens.map(t => t.error
          ? <div key={t.token} className="card"><span className="mono">{t.token}</span> <ErrorLine msg={t.error} /></div>
          : <ClankerTokenRow key={t.token} t={t} ethUsd={ethUsd} />)}
      </div>
      {res.recipients.map(r => (
        <section key={r.wallet} className="result">
          <div className="result-head">
            <IconWallet /><span className="muted">Fee recipient</span><em className="tag">Clanker</em>
            <a className="mono" href={`${EXPLORER}/address/${r.wallet}`} target="_blank" rel="noreferrer">{r.wallet}</a>
            <b>{fmt(r.owed)} ETH</b>{ethUsd ? <span className="muted">{fmtUsd(toEth(r.owed) * ethUsd)}</span> : null}
            <ClankerClaim wallet={r.wallet} owed={r.owed} onDone={onReload} />
          </div>
          <p className="muted small">Claimable covers all of this wallet's Clanker tokens.</p>
        </section>
      ))}
    </>
  );
}
