'use client';
import { useState, useEffect } from 'react';
import { WalletResult, fetchWallet, Nav, useWallet } from './WalletResult';

export default function Home() {
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const w = useWallet();

  async function run(addr) {
    setLoading(true); setErr(''); setRes(null);
    try { setRes(await fetchWallet(addr.trim())); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  const check = e => { e.preventDefault(); run(wallet); };

  // kết nối / đổi ví trong MetaMask → tự điền và check ví đó
  useEffect(() => {
    if (w.account) { setWallet(w.account); run(w.account); }
  }, [w.account]);

  return (
    <main>
      <Nav active="one" wallet={w} />
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
