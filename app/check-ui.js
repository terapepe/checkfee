'use client';
import { useState } from 'react';
// Unified results for the Check pages: one summary (claimable per source + claim), one token table for all platforms/networks
import { zeroAddress } from 'viem';
import { ClaimAll, claimPlan, ClaimSteps, TokenCard, walletEthTotals, fmt, fmtUsd, toEth, short, EXPLORER, useWallet } from './ui';
import { TaxClaim } from './tax-ui';
import { TAX } from '../lib/tax';
import { CHAINS } from '../lib/chains';
import { ChainBadge, TokenAvatar, IconExternal } from './icons';

const usd = (wei, px) => (px ? fmtUsd(toEth(wei) * px) : '—');
const tokenHref = (t, id) => `/launches/${t.token}${id && id !== 4663 ? `?chain=${id}` : ''}`;
const label = (pf, id) => `${pf === 'pons' ? 'Pons' : TAX[pf].label} · ${CHAINS[id].name}`;

// sources = one per platform + network: { key, pf, chainId, amount, tokens, claim }
export function sourcesOf({ pons, tax = [] }) {
  const out = [];
  if (pons) {
    const { pending, escrow } = walletEthTotals(pons);
    const { calls } = claimPlan(pons.tokens, pons.escrow);
    out.push({ key: 'pons', pf: 'pons', chainId: 4663, wallet: pons.wallet, amount: pending + escrow, tokens: pons.tokens.length, calls });
  }
  for (const t of tax) out.push({ key: t.platform + t.chainId, pf: t.platform, chainId: t.chainId, wallet: t.wallet, amount: t.owed, tokens: t.tokens.length });
  return out;
}

export function rowsOf({ pons, tax = [] }, wallet) {
  const rows = [];
  for (const t of pons?.tokens || []) {
    if (t.error) { rows.push({ key: t.token, error: t.error, token: t.token }); continue; }
    rows.push({
      key: 'p' + t.token, pf: 'pons', chainId: 4663, token: t.token, name: t.name, symbol: t.symbol,
      recipient: t.splitter ? t.splitter.creator : t.creatorFeeRecipient, creator: t.deployer,
      amount: t.quote === zeroAddress ? BigInt(t.estimatedCreator) : null, kind: 'to sweep', status: t.phaseName,
    });
  }
  for (const r of tax) for (const t of r.tokens) {
    if (t.error) { rows.push({ key: t.token, error: t.error, token: t.token }); continue; }
    rows.push({ key: r.platform + r.chainId + t.token, pf: r.platform, chainId: r.chainId, token: t.token, name: t.name, symbol: t.symbol, recipient: t.recipient, creator: t.creator, amount: t.earned, kind: 'earned' });
  }
  const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  return rows.map(x => ({ ...x, mine: wallet && same(x.recipient, wallet), created: wallet && same(x.creator, wallet) }));
}

export function TokenTable({ rows, ethUsd, wallet }) {
  if (!rows.length) return null;
  return (
    <div className="card table-wrap ck-table">
      <table className="table">
        <thead><tr><th>Token</th><th>Platform</th><th>Creator</th><th>Fee recipient</th><th className="r">Fees</th><th /></tr></thead>
        <tbody>
          {rows.map(r => r.error ? (
            <tr key={r.key}><td colSpan={6}><span className="mono">{short(r.token)}</span> <span className="err small">{r.error}</span></td></tr>
          ) : (
            <tr key={r.key}>
              <td><a className="ck-tok" href={tokenHref(r, r.chainId)}><TokenAvatar address={r.token} symbol={r.symbol} /><span><b>{r.name}</b><small className="muted">{r.symbol} · <span className="mono">{short(r.token)}</span></small></span></a></td>
              <td><em className="tag">{r.pf === 'pons' ? 'Pons' : TAX[r.pf].label}</em><ChainBadge id={r.chainId} label={false} />{r.status && <small className="muted ck-status">{r.status}</small>}</td>
              <td>{wallet && r.created ? <em className="tag">this wallet</em> : r.creator ? <a className="mono small" href={`${CHAINS[r.chainId].explorer}/address/${r.creator}`} target="_blank" rel="noreferrer">{short(r.creator)}</a> : '—'}</td>
              <td>{wallet && r.mine ? <em className="tag ok">this wallet</em> : <a className="mono small" href={`${CHAINS[r.chainId].explorer}/address/${r.recipient}`} target="_blank" rel="noreferrer">{short(r.recipient)}</a>}</td>
              <td className="r">{r.amount == null ? <span className="muted">—</span> : <><b>{fmt(r.amount)} ETH</b><small className="muted">{r.kind} · {usd(r.amount, ethUsd)}</small></>}</td>
              <td className="r"><a className="icon-btn" href={tokenHref(r, r.chainId)} title="Token page"><IconExternal /></a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// claimable per source with its claim button; empty sources collapse into one line
export function SourceList({ sources, ethUsd, onReload, showWallet }) {
  const w = useWallet();
  const isMe = a => w.account && a && w.account.toLowerCase() === a.toLowerCase();
  const live = sources.filter(s => s.amount > 0n || s.tokens > 0);
  const empty = sources.filter(s => !(s.amount > 0n || s.tokens > 0));
  return (
    <div className="ck-sources">
      {live.map(s => (
        <div key={s.key + (s.wallet || '')} className="ck-src">
          <span className="ck-src-name"><em className="tag">{s.pf === 'pons' ? 'Pons' : TAX[s.pf].label}</em><ChainBadge id={s.chainId} />
            {showWallet && <a className="mono small muted" href={`${CHAINS[s.chainId].explorer}/address/${s.wallet}`} target="_blank" rel="noreferrer">{short(s.wallet)}</a>}
            <small className="muted">{s.tokens} token{s.tokens === 1 ? '' : 's'}</small></span>
          <span className="ck-src-amt"><b>{fmt(s.amount)} ETH</b><small className="muted">{usd(s.amount, ethUsd)}</small></span>
          <span className="ck-src-act">
            {s.amount === 0n ? <small className="muted">Nothing to claim</small>
              : s.pf === 'pons' ? (!s.calls.length ? <small className="muted">Nothing to claim</small>
                : isMe(s.wallet) ? <ClaimAll wallet={s.wallet} calls={s.calls} /> : <small className="muted">Connect {short(s.wallet)} to claim</small>)
              : <TaxClaim pf={s.pf} chainId={s.chainId} wallet={s.wallet} owed={s.amount} onDone={onReload} />}
          </span>
        </div>
      ))}
      {empty.length > 0 && <p className="muted small ck-empty">No tokens on {empty.map(s => label(s.pf, s.chainId)).join(', ')}.</p>}
    </div>
  );
}

// one wallet: summary + sources + token table (+ Pons details folded)
export function CheckResult({ res, onReload }) {
  const { pons, ethUsd } = res;
  const wallet = pons?.wallet || res.tax?.[0]?.wallet;
  const sources = sourcesOf(res);
  const total = sources.reduce((a, s) => a + s.amount, 0n);
  const rows = rowsOf(res, wallet);
  // the networks this check covered (Pons = Robinhood), for the explorer links
  const nets = [...new Set([...(pons ? [4663] : []), ...(res.tax || []).map(x => x.chainId).filter(id => CHAINS[id])])];
  return (
    <section className="ck">
      <div className="card ck-summary">
        <div className="ck-head">
          <div>
            <span className="muted small">Wallet</span>
            <a className="mono ck-wallet" href={`${(CHAINS[nets[0]] || CHAINS[4663]).explorer}/address/${wallet}`} target="_blank" rel="noreferrer">{wallet}</a>
            {nets.length > 1 && <span className="small">{nets.map(id => <a key={id} className="muted" style={{ marginRight: 8 }} href={`${CHAINS[id].explorer}/address/${wallet}`} target="_blank" rel="noreferrer">{CHAINS[id].name}</a>)}</span>}
          </div>
          <div className="ck-total">
            <span className="muted small">Total claimable</span>
            <b>{usd(total, ethUsd)}</b>
            <small className="muted">{fmt(total)} ETH · {rows.filter(r => !r.error).length} tokens</small>
          </div>
        </div>
        <SourceList sources={sources} ethUsd={ethUsd} onReload={onReload} />
      </div>
      {rows.length > 0 ? <FilteredTable rows={rows} ethUsd={ethUsd} wallet={wallet} /> : <p className="empty">No tokens created by, or with fees assigned to, this wallet on the selected platforms.</p>}
      {pons && pons.tokens.length > 0 && (
        <details className="info-fold">
          <summary>Pons details <span className="muted">· sweep status, escrow, manual claim steps</span></summary>
          <div className="tokens compact">{pons.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={ethUsd} />)}</div>
          <ClaimSteps wallet={pons.wallet} tokens={pons.tokens} escrow={pons.escrow} />
        </details>
      )}
    </section>
  );
}

// All / Created by this wallet / Fees only (another wallet created it, this wallet receives the fees) / Fees go elsewhere
function FilteredTable({ rows, ethUsd, wallet }) {
  const [f, setF] = useState('all');
  const ok = rows.filter(r => !r.error);
  const groups = [
    ['all', 'All', rows],
    ['created', 'Created', ok.filter(r => r.created)],
    ['received', 'Fees received from others', ok.filter(r => r.mine && !r.created)],
    ['elsewhere', 'Fees go to another wallet', ok.filter(r => !r.mine)],
  ].filter(([k, , list]) => k === 'all' || list.length);
  const cur = groups.find(g => g[0] === f) || groups[0];
  return (
    <>
      {groups.length > 1 && (
        <div className="seg ck-filter">
          {groups.map(([k, l, list]) => <button key={k} type="button" className={cur[0] === k ? 'on' : ''} onClick={() => setF(k)}>{l} <span className="muted">{list.length}</span></button>)}
        </div>
      )}
      <TokenTable rows={cur[2]} ethUsd={ethUsd} wallet={wallet} />
    </>
  );
}
