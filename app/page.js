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

  // connect / switch wallet in MetaMask → fill in and check that wallet
  useEffect(() => {
    if (w.account) { setWallet(w.account); run(w.account); }
  }, [w.account]);

  return (
    <>
      <PageHeader icon={IconWallet} title="Check wallet" desc="Find every Pons v2 token a wallet created (or receives fees for) and its unclaimed creator fees." />
      <form className="search" onSubmit={check}>
        <IconSearch />
        <input placeholder="0x… creator wallet address" value={wallet} onChange={e => setWallet(e.target.value)} />
        <button className="btn-primary" disabled={loading || !wallet.trim()}>{loading ? 'Checking…' : 'Check'}</button>
      </form>
      {!w.account && !res && !loading && <p className="hint">Or click <b>Connect Wallet</b> in the sidebar to check your current wallet.</p>}
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={wallet.trim() ? () => run(wallet) : null} disabled={loading} />}
      {res && <WalletResult res={res} />}
    </>
  );
}
