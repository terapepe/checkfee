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

  // Auto-check toggle (remembered in this browser)
  const [auto, setAuto] = useState(true);
  useEffect(() => { try { if (localStorage.getItem('checkfee_autocheck') === '0') setAuto(false); } catch {} }, []);
  const toggleAuto = () => setAuto(v => { try { localStorage.setItem('checkfee_autocheck', v ? '0' : '1'); } catch {} return !v; });

  // connect / switch wallet in MetaMask → fill in the address; check it only when auto-check is on
  useEffect(() => {
    if (!w.account) return;
    setWallet(w.account);
    if (auto) run(w.account);
  }, [w.account, auto]);

  return (
    <>
      <PageHeader icon={IconWallet} title="Check wallet" desc="Find every Pons v2 token a wallet created (or receives fees for) and its unclaimed creator fees." />
      <form className="search" onSubmit={check}>
        <IconSearch />
        <input placeholder="0x… creator wallet address" value={wallet} onChange={e => setWallet(e.target.value)} />
        <button className="btn-primary" disabled={loading || !wallet.trim()}>{loading ? 'Checking…' : 'Check'}</button>
      </form>
      <label className="toggle" title="Automatically check the wallet connected in MetaMask (and re-check when you switch wallets)">
        <input type="checkbox" checked={auto} onChange={toggleAuto} />
        <span className="track"><span className="knob" /></span>
        Auto-check connected wallet
      </label>
      {!w.account && !res && !loading && <p className="hint">Or click <b>Connect Wallet</b> in the sidebar to check your current wallet.</p>}
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={wallet.trim() ? () => run(wallet) : null} disabled={loading} />}
      {res && <WalletResult res={res} />}
    </>
  );
}
