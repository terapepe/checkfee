'use client';
import { useEffect, useState } from 'react';
import { useWallet } from './ui';

// Follow / Unfollow a token on the shared Following list (any connected wallet)
export function FollowButton({ chainId, platform, s }) {
  const w = useWallet();
  const [on, setOn] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/following?chain=${chainId}&token=${s.token}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => setOn(!!d.following)).catch(() => setOn(false));
  }, [chainId, s.token]);

  async function toggle() {
    if (!w.account) return w.connect();
    setBusy(true);
    try {
      const r = await fetch('/api/following', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: on ? 'unfollow' : 'follow', wallet: w.account, chainId, platform, token: s.token,
          poolId: s.poolId, curve: s.curve, deployer: s.deployer, block: s.block != null ? String(s.block) : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setOn(d.following);
    } catch (e) { alert(`Follow failed: ${e.message}`); }
    setBusy(false);
  }

  return (
    <button type="button" className={`pill pill-btn${on ? ' on' : ''}`} onClick={toggle} disabled={busy || on == null}
      title={w.account ? '' : 'Connect a wallet to follow'}>
      {on == null ? '…' : busy ? (on ? 'Unfollowing…' : 'Following…') : on ? '★ Following' : '☆ Follow'}
    </button>
  );
}
