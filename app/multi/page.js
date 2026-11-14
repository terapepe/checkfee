'use client';
import { useState } from 'react';
import { formatUnits, zeroAddress } from 'viem';
import { WalletResult, fetchWallet, Nav } from '../WalletResult';

export default function Multi() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');

  async function check(e) {
    e.preventDefault();
    const wallets = [...new Set(input.split(/[\s,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean))];
    const bad = wallets.filter(w => !/^0x[0-9a-f]{40}$/.test(w));
    if (bad.length) return setErr(`Địa chỉ không hợp lệ: ${bad.join(', ')}`);
    setErr(''); setLoading(true);
    const list = wallets.map(w => ({ wallet: w, res: null, err: '', loading: true }));
    setResults([...list]);
    // tuần tự để tránh RPC công khai bị rate limit
    for (let i = 0; i < list.length; i++) {
      try {
        list[i] = { ...list[i], res: await fetchWallet(list[i].wallet), loading: false };
      } catch (e) { list[i] = { ...list[i], err: e.message, loading: false }; }
      setResults([...list]);
    }
    setLoading(false);
  }

  // tổng ETH ước tính chưa sweep + escrow ETH trên tất cả ví
  const done = results.filter(r => r.res);
  const ethUsd = done.find(r => r.res.ethUsd)?.res.ethUsd;
  const totalWei = done.reduce((s, r) => s
    + r.res.tokens.filter(t => !t.error && t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n)
    + BigInt(r.res.escrow.find(a => a.asset === zeroAddress)?.balance || 0), 0n);
  const totalEth = Number(formatUnits(totalWei, 18));

  return (
    <main>
      <Nav active="multi" />
      <h1>Pons Fee Checker · nhiều ví</h1>
      <div className="muted">Pons v2 · Robinhood Chain (4663) · dữ liệu đọc trực tiếp on-chain</div>

      <form onSubmit={check}>
        <textarea rows={4} placeholder="Mỗi dòng một ví 0x… (hoặc cách nhau bằng dấu phẩy / khoảng trắng)" value={input} onChange={e => setInput(e.target.value)} />
        <button disabled={loading || !input.trim()}>{loading ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </form>
      {err && <p className="err">{err}</p>}

      {done.length > 1 && (
        <div className="card row">
          <div>Tổng {done.length} ví (ETH: ước tính chưa sweep + escrow)</div>
          <div className="big">≈ {totalEth.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} ETH{ethUsd ? ` (~$${(totalEth * ethUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''}</div>
        </div>
      )}

      {results.map(r => r.res ? <WalletResult key={r.wallet} res={r.res} /> : (
        <section className="wallet" key={r.wallet}>
          <h2 className="wh">Ví <span className="mono">{r.wallet}</span></h2>
          {r.loading ? <p className="muted">Đang kiểm tra…</p> : <p className="err">{r.err}</p>}
        </section>
      ))}
    </main>
  );
}
