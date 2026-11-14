'use client';
import { useState } from 'react';
import { TokenAvatar } from './icons';
// Biểu đồ SVG nhẹ: sparkline cho danh sách, line + volume cho trang token

export const compact = v => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return '0';
  return v.toPrecision(3);
};
export const usdC = v => (v == null || !isFinite(v) ? '—' : '$' + compact(v));
export const priceUsd = v => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1) return '$' + v.toFixed(4);
  const s = v.toExponential(2);
  const exp = -parseInt(s.split('e')[1], 10);
  return exp > 5 ? `$0.0{${exp - 1}}${(v * 10 ** (exp + 2)).toFixed(0)}` : '$' + v.toFixed(exp + 3);
};
export const ago = sec => {
  if (!sec) return '—';
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  return `${Math.floor(d / 86400 / 30)}mo`;
};

export function Sparkline({ points, width = 112, height = 32 }) {
  if (!points || points.length < 2) return <svg width={width} height={height}><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--line-2)" strokeDasharray="3 3" /></svg>;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * width},${height - 2 - ((p - min) / span) * (height - 4)}`).join('');
  const up = points[points.length - 1] >= points[0];
  return <svg width={width} height={height}><path d={d} fill="none" stroke={up ? 'var(--ok)' : '#ff7a45'} strokeWidth="1.5" /></svg>;
}

// trades: [{time, price(USD), usdVol, side}]
export function PriceChart({ trades, height = 300 }) {
  const W = 760, H = height, PAD = { l: 8, r: 64, t: 10, b: 60 };
  if (!trades.length) return <div className="chart-empty">Chưa có giao dịch</div>;
  const t0 = trades[0].time, t1 = trades[trades.length - 1].time || t0 + 1;
  const ps = trades.map(t => t.price);
  const min = Math.min(...ps), max = Math.max(...ps), span = max - min || max || 1;
  const x = t => PAD.l + ((t - t0) / ((t1 - t0) || 1)) * (W - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const y = p => PAD.t + plotH - ((p - min) / span) * plotH;
  const line = trades.map((t, i) => `${i ? 'L' : 'M'}${x(t.time).toFixed(1)},${y(t.price).toFixed(1)}`).join('');
  const area = `${line}L${x(t1)},${PAD.t + plotH}L${x(t0)},${PAD.t + plotH}Z`;
  const vmax = Math.max(...trades.map(t => t.usdVol || 0)) || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => min + span * f);
  const last = trades[trades.length - 1];
  const up = last.price >= trades[0].price;
  const col = up ? 'var(--ok)' : '#ff7a45';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="price-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={up ? '#5fe0a0' : '#ff7a45'} stopOpacity=".25" />
          <stop offset="1" stopColor={up ? '#5fe0a0' : '#ff7a45'} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((p, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--line)" strokeWidth="1" />
          <text x={W - PAD.r + 6} y={y(p) + 4} fill="var(--muted)" fontSize="11">{priceUsd(p)}</text>
        </g>
      ))}
      <path d={area} fill="url(#pcg)" />
      <path d={line} fill="none" stroke={col} strokeWidth="2" />
      {trades.map((t, i) => {
        const h = ((t.usdVol || 0) / vmax) * (PAD.b - 22);
        return <rect key={i} x={x(t.time) - 1.5} y={H - 18 - h} width="3" height={h} fill={t.side === 'Buy' ? 'rgba(95,224,160,.45)' : 'rgba(255,122,69,.45)'} />;
      })}
      <circle cx={x(last.time)} cy={y(last.price)} r="3.5" fill={col} />
      <text x={PAD.l} y={H - 4} fill="var(--muted)" fontSize="11">{new Date(t0 * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</text>
      <text x={W - PAD.r} y={H - 4} fill="var(--muted)" fontSize="11" textAnchor="end">{new Date(t1 * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</text>
    </svg>
  );
}

export function Logo({ t, size = 40 }) {
  const [bad, setBad] = useState(false);
  return t.logo && !bad
    ? <img src={t.logo} alt="" width={size} height={size} className="tk-logo" style={{ width: size, height: size }} onError={() => setBad(true)} />
    : <TokenAvatar address={t.token} symbol={t.symbol} size={size} />;
}

