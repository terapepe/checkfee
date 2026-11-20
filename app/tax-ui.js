'use client';
// Clanker / o1 parts of the Check pages + the Pons / Clanker / o1 platform toggle
import { useEffect, useState } from 'react';
import { Stats, ErrorLine, EXPLORER, short, fmt, fmtUsd, toEth, useWallet } from './ui';
import { IconWallet, IconExternal, ChainIcon, ChainBadge } from './icons';
import { TAX, TAX_KEYS, taxClaimTx } from '../lib/tax';
import { CHAINS, CHAIN_IDS, switchChain, waitOn } from '../lib/chains';
import { classicOpenCalls, classicOwnerCall, batchTxs, BASE } from '../lib/clanker-classic';

const KEY = 'checkfee_platforms';
const PLATS = [['pons', 'Pons'], ['clanker', 'Clanker v5'], ['classic', 'Clanker v0–v4'], ['o1', 'o1']];
const NETS = CHAIN_IDS.map(id => [`n${id}`, CHAINS[id].name, id]);
const ALL = { pons: true, clanker: true, classic: true, o1: true, ...Object.fromEntries(NETS.map(([k]) => [k, true])) };

// which platforms + networks to check; each group keeps at least one on; remembered in this browser
export function usePlatforms() {
  const [p, setP] = useState(ALL);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) setP(fix({ ...ALL, ...v })); } catch {} }, []);
  const toggle = k => setP(v => {
    const n = { ...v, [k]: !v[k] };
    const group = NETS.some(([x]) => x === k) ? NETS : PLATS;
    if (!group.some(([x]) => n[x])) return v;
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {}
    return n;
  });
  return [p, toggle];
}
const fix = v => (PLATS.some(([k]) => v[k]) && NETS.some(([k]) => v[k]) ? v : ALL);

// Pons only exists on Robinhood
export const ponsOn = p => p.pons && p.n4663;
// Clanker v0–v4 only exists on Base
export const classicOn = p => p.classic && p.n8453;
// selected [platform, chainId] pairs for Clanker / o1
export const taxJobs = p => TAX_KEYS.filter(k => p[k]).flatMap(k => CHAIN_IDS.filter(id => p[`n${id}`]).map(id => [k, id]));

export function PlatformToggle({ value, onToggle, disabled }) {
  return (
    <div className="pf-toggles">
      <div className="pf-toggle">
        <span className="muted small">Platform</span>
        {PLATS.map(([k, l]) => (
          <button key={k} type="button" className={`chip${value[k] ? ' on' : ''}`} aria-pressed={value[k]} disabled={disabled} onClick={() => onToggle(k)}>{l}</button>
        ))}
      </div>
      <div className="pf-toggle">
        <span className="muted small">Network</span>
        {NETS.map(([k, l, id]) => (
          <button key={k} type="button" className={`chip net${value[k] ? ' on' : ''}`} aria-pressed={value[k]} disabled={disabled} onClick={() => onToggle(k)}><ChainIcon id={id} size={15} />{l}</button>
        ))}
      </div>
      {value.pons && !value.n4663 && <small className="muted">Pons is on Robinhood only, so it is skipped.</small>}
      {value.classic && !value.n8453 && <small className="muted">Clanker v0–v4 is on Base only, so it is skipped.</small>}
    </div>
  );
}

export function TaxClaim({ pf, chainId = 4663, wallet, owed, onDone }) {
  const w = useWallet();
  const [st, setSt] = useState({ busy: '', err: '', hash: '' });
  if (!owed) return null;
  if (!w.account || w.account.toLowerCase() !== wallet.toLowerCase()) return <small className="muted">Connect {short(wallet)} to claim</small>;
  async function claim() {
    const eth = window.ethereum;
    setSt({ busy: 'Confirm in MetaMask…', err: '', hash: '' });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, chainId);
      const tx = taxClaimTx(pf, chainId, wallet);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
      setSt({ busy: 'Confirming…', err: '', hash });
      const rc = await waitOn(chainId, hash);
      if (rc.status !== 'success') throw new Error('Claim failed');
      setSt({ busy: '', err: '', hash }); onDone?.();
    } catch (e) { setSt({ busy: '', err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message), hash: '' }); }
  }
  return (
    <>
      <button type="button" className="btn-primary sm" disabled={!!st.busy} onClick={claim}>{st.busy || 'Claim all'}</button>
      {st.hash && !st.busy && <a className="ok small" href={`${CHAINS[chainId].explorer}/tx/${st.hash}`} target="_blank" rel="noreferrer">Claimed <IconExternal /></a>}
      {st.err && <ErrorLine msg={st.err} />}
    </>
  );
}

function TaxTokenRow({ t, ethUsd, wallet }) {
  return (
    <a className="card ctk" href={`/launches/${t.token}${t.chainId && t.chainId !== 4663 ? `?chain=${t.chainId}` : ''}`}>
      <span><b>{t.name}</b> <span className="muted">{t.symbol}</span> <em className="tag">{TAX[t.platform].label}</em><ChainBadge id={t.chainId} label={false} />
        {wallet && t.recipient !== wallet && <em className="tag warn">fees go to {short(t.recipient)}</em>}</span>
      <span className="mono small muted">{short(t.token)}</span>
      <span className="ctk-amt"><small className="muted">Fees earned</small> <b>{fmt(t.earned)} ETH</b>{ethUsd ? <small className="muted"> {fmtUsd(toEth(t.earned) * ethUsd)}</small> : null}</span>
    </a>
  );
}

export function TaxWalletResult({ res, ethUsd, onReload }) {
  const L = TAX[res.platform].label;
  const owedEth = toEth(res.owed);
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet /><em className="tag">{L}</em><ChainBadge id={res.chainId} />
        <a className="mono" href={`${CHAINS[res.chainId].explorer}/address/${res.wallet}`} target="_blank" rel="noreferrer">{res.wallet}</a>
      </div>
      <Stats items={[
        { label: 'Token', value: res.tokens.length },
        { label: 'In escrow', value: `${fmt(res.owed)} ETH` },
        { label: 'Total claimable', value: ethUsd ? fmtUsd(owedEth * ethUsd) : `${fmt(res.owed)} ETH`, accent: true,
          action: <TaxClaim pf={res.platform} chainId={res.chainId} wallet={res.wallet} owed={res.owed} onDone={onReload} /> },
      ]} />
      <p className="muted small">{L} credits creator fees to the escrow on every trade, so there is nothing to sweep: one claim pays all of this wallet's {L} fees in ETH.</p>
      {res.tokens.length === 0 ? <p className="empty">No {L} tokens created by, or with fees assigned to, this wallet.</p>
        : <div className="ctk-list">{res.tokens.map(t => <TaxTokenRow key={t.token} t={t} ethUsd={ethUsd} wallet={res.wallet} />)}</div>}
    </section>
  );
}

export function TaxCAResult({ res, ethUsd, onReload }) {
  const L = TAX[res.platform].label;
  return (
    <>
      <div className="ctk-list">
        {res.tokens.map(t => t.error
          ? <div key={t.token} className="card"><span className="mono">{t.token}</span> <ErrorLine msg={t.error} /></div>
          : <TaxTokenRow key={t.token} t={t} ethUsd={ethUsd} />)}
      </div>
      {res.recipients.map(r => (
        <section key={r.wallet} className="result">
          <div className="result-head">
            <IconWallet /><span className="muted">Fee recipient</span><em className="tag">{L}</em><ChainBadge id={res.chainId} />
            <a className="mono" href={`${CHAINS[res.chainId].explorer}/address/${r.wallet}`} target="_blank" rel="noreferrer">{r.wallet}</a>
            <b>{fmt(r.owed)} ETH</b>{ethUsd ? <span className="muted">{fmtUsd(toEth(r.owed) * ethUsd)}</span> : null}
            <TaxClaim pf={res.platform} chainId={res.chainId} wallet={r.wallet} owed={r.owed} onDone={onReload} />
          </div>
          <p className="muted small">Claimable covers all of this wallet's {L} tokens.</p>
        </section>
      ))}
    </>
  );
}

// send txs one by one on Base through MetaMask
async function sendAll(txs, setSt) {
  const eth = window.ethereum;
  const [from] = await eth.request({ method: 'eth_requestAccounts' });
  await switchChain(eth, BASE);
  let last = '';
  for (let i = 0; i < txs.length; i++) {
    setSt(s => ({ ...s, busy: `Confirm ${i + 1}/${txs.length} in MetaMask…` }));
    last = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: txs[i].to, data: txs[i].data, value: '0x0' }] });
    setSt(s => ({ ...s, busy: `Confirming ${i + 1}/${txs.length}…`, hash: last }));
    const rc = await waitOn(BASE, last);
    if (rc.status !== 'success') throw new Error(`Transaction ${i + 1} failed`);
  }
  return last;
}
const errText = e => (e.code === 4001 ? 'Cancelled in MetaMask' : (e.shortMessage || e.message));

// Clanker v0–v4 claim for one or many wallets. v2 / v3 / v3.1 / v4 claims can be sent by any wallet (fees still
// go to each token's recipient), batched through Multicall3; v0 / v1 need the connected wallet to own the position.
export function ClassicClaim({ results, onDone, label }) {
  const w = useWallet();
  const [st, setSt] = useState({ busy: '', err: '', hash: '' });
  const open = classicOpenCalls(results);
  const ownerToks = results.flatMap(r => r.tokens.filter(t => !t.error && t.hasFees && (t.type === 'proxy' || t.type === 'clanker')));
  const mineOwner = ownerToks.filter(t => w.account && t.recipient && t.recipient.toLowerCase() === w.account.toLowerCase());
  if (!open.length && !ownerToks.length) return <small className="muted">Nothing to claim</small>;
  async function claim() {
    setSt({ busy: 'Preparing…', err: '', hash: '' });
    try {
      const owner = [];
      for (const t of mineOwner) owner.push(await classicOwnerCall(t, w.account).catch(() => null));
      const txs = [...batchTxs(open), ...owner.filter(Boolean)];
      if (!txs.length) throw new Error('Nothing this wallet can send');
      const hash = await sendAll(txs, setSt);
      setSt({ busy: '', err: '', hash }); onDone?.();
    } catch (e) { setSt(s => ({ ...s, busy: '', err: errText(e) })); }
  }
  const n = batchTxs(open).length + mineOwner.length;
  return (
    <>
      {w.account
        ? <button type="button" className="btn-primary sm" disabled={!!st.busy || !n} onClick={claim}>{st.busy || `${label || 'Claim'}${n > 1 ? ` (${n} tx)` : ''}`}</button>
        : <small className="muted">Connect any wallet to claim</small>}
      {ownerToks.length > mineOwner.length && <small className="muted">{ownerToks.length - mineOwner.length} v0/v1 token(s) need their own wallet connected</small>}
      {st.hash && !st.busy && !st.err && <a className="ok small" href={`${CHAINS[BASE].explorer}/tx/${st.hash}`} target="_blank" rel="noreferrer">Claimed <IconExternal /></a>}
      {st.err && <ErrorLine msg={st.err} />}
    </>
  );
}
