'use client';
import { useEffect, useMemo, useState } from 'react';
import { listCheckfeeTokens, tokenSummary, tradesOf, blockTime, getLogsChunked, ipfsUrl } from '../../lib/market';
import { TAX, taxSummary, taxTrades } from '../../lib/tax';
import { getEthUsd, short, Spinner, ErrorLine } from '../ui';
import { Sparkline, usdC, ago, Logo } from '../charts';
import { IconBolt } from '../icons';

const TABS = [
  { id: 'mcap', label: 'Market cap' },
  { id: 'new', label: 'New' },
  { id: 'near', label: 'Near graduation' },
  { id: 'grad', label: 'Graduated' },
  { id: 'clanker', label: 'Clanker' },
  { id: 'o1', label: 'o1' },
];

export default function Launches() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('mcap');
  const [ethUsd, setEthUsd] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [list, px] = await Promise.all([listCheckfeeTokens(), getEthUsd()]);
        setEthUsd(px);
        const out = await Promise.all(list.map(async l => {
          try {
            if (TAX[l.platform]) {
              const [s, trades, time] = await Promise.all([taxSummary(l.platform, l.token), taxTrades(l.poolId, false, l.block, getLogsChunked, false), blockTime(l.block)]);
              // native ETH is always currency0 in v4, so the token side is known without the summary
              return { ...s, logo: ipfsUrl(s.image), phase: 0, progress: null, time, spark: trades.slice(-40).map(t => t.price), trades: trades.length };
            }
            const [s, trades, time] = await Promise.all([tokenSummary(l.token, l.block), tradesOf(l.curve, l.block, false), blockTime(l.block)]);
            return { ...s, platform: 'pons', time, spark: trades.slice(-40).map(t => t.price), trades: trades.length };
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
    return [...ok].sort((a, b) => mc(b) - mc(a));
  }, [rows, tab]);
  const top = useMemo(() => [...(rows || [])].filter(r => !r.error).sort((a, b) => (b.mcapEth || 0) - (a.mcapEth || 0)).slice(0, 6), [rows]);

  return (
    <>
      <div className="lp-head">
        <h1 className="lp-title">Launches</h1>
        <a className="btn-primary" href="/launch"><IconBolt />Launch token</a>
      </div>
      <p className="muted">Tokens created on Ponsfamily, Clanker and o1 through CheckFee.</p>

      {!rows && <Spinner text="Collecting tokens from on-chain…" />}
      {err && <ErrorLine msg={err} />}

      {rows && top.length > 0 && (
        <>
          <h3>Trending</h3>
          <div className="trend">
            {top.map(t => (
              <a key={t.token} href={`/launches/${t.token}`} className="trend-card">
                <div className="trend-img"><Logo t={t} size={160} /></div>
                <div className="trend-meta"><b>{t.name}</b> <em className="tag">{TAX[t.platform]?.label || 'Pons'}</em></div>
                <div className="trend-mc">{usdC(ethUsd && t.mcapEth ? t.mcapEth * ethUsd : null)}</div>
              </a>
            ))}
          </div>
        </>
      )}

      {rows && (
        <>
          <div className="lp-tabs">
            {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          <div className="lp-table">
            <div className="lp-row lp-th"><span>Token</span><span>Pair</span><span>Bonding</span><span>Graph</span><span>Market cap</span></div>
            {list.length === 0 && <p className="empty">No tokens here yet.</p>}
            {list.map(t => (
              <a key={t.token} className="lp-row" href={`/launches/${t.token}`}>
                <span className="lp-tok">
                  <Logo t={t} />
                  <span>
                    <b>{t.name}</b> <span className="muted">{t.symbol}</span> <em className="tag">{TAX[t.platform]?.label || 'Pons'}</em>
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
        </>
      )}
    </>
  );
}
