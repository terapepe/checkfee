'use client';
import { useState } from 'react';
import { WalletResult, fetchWallet, Nav } from './WalletResult';

export default function Home() {
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  async function check(e) {
    e.preventDefault();
    setLoading(true); setErr(''); setRes(null);
    try { setRes(await fetchWallet(wallet.trim())); } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  return (
    <main>
      <Nav active="one" />
      <h1>Pons Fee Checker</h1>
      <div className="muted">Pons v2 · Robinhood Chain (4663) · dữ liệu đọc trực tiếp on-chain</div>

      <form onSubmit={check}>
        <input placeholder="0x… địa chỉ ví creator" value={wallet} onChange={e => setWallet(e.target.value)} />
        <button disabled={loading || !wallet.trim()}>{loading ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {res && <WalletResult res={res} />}
    </main>
  );
}
