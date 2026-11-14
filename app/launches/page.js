'use client';
import { useEffect, useMemo, useState } from 'react';
import { listCheckfeeTokens, tokenSummary, tradesOf, blockTime } from '../../lib/market';
import { getEthUsd, short, Spinner, ErrorLine } from '../ui';
import { Sparkline, usdC, ago, Logo } from '../charts';
import { IconBolt } from '../icons';

const TABS = [
  { id: 'mcap', label: 'Market cap' },
  { id: 'new', label: 'Mới' },
  { id: 'near', label: 'Sắp graduate' },
  { id: 'grad', label: 'Đã graduate' },
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
            const [s, trades, time] = await Promise.all([tokenSummary(l.token, l.block), tradesOf(l.curve, l.block, false), blockTime(l.block)]);
            return { ...s, time, spark: trades.slice(-40).map(t => t.price), trades: trades.length };
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
    if (tab === 'near') return ok.filter(r => r.phase === 0).sort((a, b) => b.progress - a.progress);
    if (tab === 'grad') return ok.filter(r => r.phase > 0);
    return [...ok].sort((a, b) => mc(b) - mc(a));
  }, [rows, tab]);
  const top = useMemo(() => [...(rows || [])].filter(r => !r.error).sort((a, b) => (b.mcapEth || 0) - (a.mcapEth || 0)).slice(0, 6), [rows]);

  return (
    <>
      <div className="lp-head">
        <h1 className="lp-title">Launches</h1>
        <a className="btn-primary" href="/launch"><IconBolt />Launch token</a>
      </div>
      <p className="muted">Token được tạo trên Ponsfamily thông qua checkfee.</p>

      {!rows && <Spinner text="Đang tổng hợp token từ on-chain…" />}
      {err && <ErrorLine msg={err} />}

      {rows && top.length > 0 && (
        <>
          <h3>Nổi bật</h3>
          <div className="trend">
            {top.map((t, i) => (
              <a key={t.token} href={`/launches/${t.token}`} className="trend-card">
                <div className="trend-img"><Logo t={t} size={160} /></div>
                <div className="trend-meta"><span className="muted">{i + 1}</span> <b>{t.name}</b></div>
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
            <div className="lp-row lp-th"><span>Token</span><span>Cặp</span><span>Bonding</span><span>Biểu đồ</span><span>Market cap</span></div>
            {list.length === 0 && <p className="empty">Chưa có token nào ở mục này.</p>}
            {list.map(t => (
              <a key={t.token} className="lp-row" href={`/launches/${t.token}`}>
                <span className="lp-tok">
                  <Logo t={t} />
                  <span>
                    <b>{t.name}</b> <span className="muted">{t.symbol}</span>
                    <small className="muted"><span className="mono">{short(t.deployer)}</span> · {ago(t.time)} · {t.trades} giao dịch</small>
                  </span>
                </span>
                <span className="muted">ETH</span>
                <span className="lp-prog"><i style={{ width: `${Math.round(t.progress * 100)}%` }} /><small>{t.phase > 0 ? 'Graduated' : `${(t.progress * 100).toFixed(1)}%`}</small></span>
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
