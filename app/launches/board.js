'use client';
import { useEffect, useMemo, useState } from 'react';
import { listCheckfeeTokens, tokenSummary, tradesOf, blockTime, getLogsChunked, ipfsUrl } from '../../lib/market';
import { TAX, taxSummary, taxTrades } from '../../lib/tax';
import { blockTimeOn } from '../../lib/chains';
import { pangeaSummary } from '../../lib/pangea';
import { ChainBadge } from '../icons';

const href = t => `/launches/${t.token}${t.chainId && t.chainId !== 4663 ? `?chain=${t.chainId}` : ''}`;
import { getEthUsd, short, Spinner, ErrorLine } from '../ui';
import { Sparkline, usdC, ago, Logo } from '../charts';
import { IconBolt } from '../icons';

const TABS = [
  { id: 'new', label: 'New' },
  { id: 'mcap', label: 'Market cap' },
  { id: 'near', label: 'Near graduation' },
  { id: 'grad', label: 'Graduated' },
  { id: 'clanker', label: 'Clanker' },
  { id: 'o1', label: 'o1' },
  { id: 'c4663', label: 'Robinhood' },
  { id: 'c8453', label: 'Base' },
];

export function TokenBoard({ source = listCheckfeeTokens, title = 'Launches', desc = 'Tokens created on Ponsfamily, Clanker and o1 through CheckFee.' }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('new');
  const [page, setPage] = useState(0);
  const PER = 20;
  const [ethUsd, setEthUsd] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [list, px] = await Promise.all([source(), getEthUsd()]);
        setEthUsd(px);
        const out = await Promise.all(list.map(async l => {
          try {
            if (l.platform === 'pangea') {
              const [s, time] = await Promise.all([pangeaSummary(l.token, l.chainId), blockTimeOn(l.chainId, l.block)]);
              return { ...s, logo: ipfsUrl(s.image), platform: 'pangea', chainId: Number(l.chainId), deployer: l.deployer || s.launcher, phase: 0, progress: null, time, spark: [], trades: 0 };
            }
            if (TAX[l.platform]) {
              const [s, trades, time] = await Promise.all([taxSummary(l.platform, l.chainId, l.token), taxTrades(l.platform, l.chainId, l.poolId, false, l.block, false), blockTimeOn(l.chainId, l.block)]);
              // native ETH is always currency0 in v4, so the token side is known without the summary
              return { ...s, logo: ipfsUrl(s.image), phase: 0, progress: null, time, spark: trades.slice(-40).map(t => t.price), trades: trades.length };
            }
            const [s, trades, time] = await Promise.all([tokenSummary(l.token, l.block), tradesOf(l.curve, l.block, false), blockTime(l.block)]);
            return { ...s, platform: 'pons', chainId: 4663, time, spark: trades.slice(-40).map(t => t.price), trades: trades.length };
          } catch (e) { return { token: l.token, symbol: '?', name: l.token, error: e.message, time: null }; }
        }));
        setRows(out);
      } catch (e) { setErr(e.message); setRows([]); }
    })();
  }, []);

  const list = useMemo(() => {
    const ok = (rows || []).filter(r => !r.error);
    const mc = r => (r.mcapEth || 0);
    if (tab === 'new') return [...ok].sort((a, b) => (b.time || 0) - (a.time || 0));
    if (tab === 'near') return ok.filter(r => r.phase === 0 && r.progress != null).sort((a, b) => b.progress - a.progress);
    if (tab === 'grad') return ok.filter(r => r.phase > 0);
    if (TAX[tab]) return ok.filter(r => r.platform === tab).sort((a, b) => mc(b) - mc(a));
    if (tab.startsWith('c')) return ok.filter(r => r.chainId === Number(tab.slice(1))).sort((a, b) => mc(b) - mc(a));
    return [...ok].sort((a, b) => mc(b) - mc(a));
  }, [rows, tab]);
  const top = useMemo(() => [...(rows || [])].filter(r => !r.error).sort((a, b) => (b.mcapEth || 0) - (a.mcapEth || 0)).slice(0, 6), [rows]);

  return (
    <>
      <div className="lp-head">
        <h1 className="lp-title">{title}</h1>
        <a className="btn-primary" href="/launch"><IconBolt />Launch token</a>
      </div>
      <p className="muted">{desc}</p>

      {!rows && <Spinner text="Collecting tokens from on-chain…" />}
      {err && <ErrorLine msg={err} />}

      {rows && (
        <>
          <div className="lp-tabs">
            {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setPage(0); }}>{t.label}</button>)}
          </div>
          <div className="lp-table">
            <div className="lp-row lp-th"><span>Token</span><span>Pair</span><span>Bonding</span><span>Graph</span><span>Market cap</span></div>
            {list.length === 0 && <p className="empty">No tokens here yet.</p>}
            {list.slice(page * PER, page * PER + PER).map(t => (
              <a key={t.chainId + t.token} className="lp-row" href={href(t)}>
                <span className="lp-tok">
                  <Logo t={t} />
                  <span>
                    <b>{t.name}</b> <span className="muted">{t.symbol}</span> <em className="tag">{TAX[t.platform]?.label || (t.platform === 'pangea' ? 'Pangea' : 'Pons')}</em><ChainBadge id={t.chainId} />
                    <small className="muted"><span className="mono">{short(t.deployer)}</span> · {ago(t.time)} · {t.trades} trades</small>
                  </span>
                </span>
                <span className="muted">ETH</span>
                {t.progress == null ? <span className="muted small">Uniswap v4</span>
                  : <span className="lp-prog"><i style={{ width: `${Math.round(t.progress * 100)}%` }} /><small>{t.phase > 0 ? 'Graduated' : `${(t.progress * 100).toFixed(1)}%`}</small></span>}
                <span><Sparkline points={t.spark} /></span>
                <b className="lp-mc">{t.phase > 0 ? '—' : usdC(ethUsd ? t.mcapEth * ethUsd : null)}</b>
              </a>
            ))}
          </div>
          {list.length > PER && (
            <div className="lp-pager">
              <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className="muted small">Page {page + 1} / {Math.ceil(list.length / PER)} · {list.length} tokens</span>
              <button type="button" disabled={(page + 1) * PER >= list.length} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
