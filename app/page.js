'use client';
import { useState, useEffect } from 'react';
import { WalletResult, fetchWallet, useWallet, PageHeader, ErrorLine, Spinner } from './ui';
import { IconWallet, IconSearch } from './icons';

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
    <>
      <PageHeader icon={IconWallet} title="Check 1 ví" desc="Tìm mọi token Pons v2 ví đã tạo (hoặc được chuyển quyền nhận phí) và số phí creator chưa nhận." />
      <form className="search" onSubmit={check}>
        <IconSearch />
        <input placeholder="0x… địa chỉ ví creator" value={wallet} onChange={e => setWallet(e.target.value)} />
        <button className="btn-primary" disabled={loading || !wallet.trim()}>{loading ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </form>
      {!w.account && !res && !loading && <p className="hint">Hoặc bấm <b>Connect Wallet</b> ở thanh bên trái để tự check ví đang dùng.</p>}
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={wallet.trim() ? () => run(wallet) : null} disabled={loading} />}
      {res && <WalletResult res={res} />}
    </>
  );
}
