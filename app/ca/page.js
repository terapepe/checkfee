'use client';
import { useState } from 'react';
import {
  TokenCard, RecipientBlock, fetchTokens, fetchClankerTokens, PageHeader, ErrorLine, Spinner, Stats, parseAddresses,
  fmt, fmtUsd, toEth,
} from '../ui';
import { IconCoin } from '../icons';
import { zeroAddress, getAddress } from 'viem';
import { usePlatforms, PlatformToggle, ClankerCAResult } from '../clanker-ui';
import { isClankerToken } from '../../lib/clanker';

export default function ByCA() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [pf, togglePf] = usePlatforms();
  const [clk, setClk] = useState(null);

  async function run() {
    const { list, bad } = parseAddresses(input);
    if (bad.length) return setErr(`Invalid CA: ${bad.join(', ')}`);
    setErr(''); setLoading(true); setRes(null); setClk(null);
    try {
      // sort CAs by platform (Clanker factory knows its tokens), skip a platform that is switched off
      const isC = pf.clanker ? await Promise.all(list.map(a => isClankerToken(getAddress(a)).catch(() => false))) : list.map(() => false);
      const cl = list.filter((_, i) => isC[i]), po = list.filter((_, i) => !isC[i]);
      const [p, c] = await Promise.all([pf.pons && po.length ? fetchTokens(po) : null, cl.length ? fetchClankerTokens(cl) : null]);
      if (!p && !c) throw new Error(pf.pons ? 'No token found' : 'No Clanker token in this list');
      setRes(p); setClk(c);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  const check = e => { e.preventDefault(); run(); };

  const ok = res ? res.tokens.filter(t => !t.error) : [];
  const pending = ok.filter(t => t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);

  return (
    <>
      <PageHeader icon={IconCoin} title="Check by CA" desc="Enter one or more Pons v2 / Clanker token contract addresses to see unclaimed fees and each token's fee recipient." />
      <PlatformToggle value={pf} onToggle={togglePf} disabled={loading} />
      <form className="search area" onSubmit={check}>
        <textarea rows={3} placeholder={'Token CA, one per line\n0x…'} value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn-primary" disabled={loading || !input.trim()}>{loading ? 'Checking…' : 'Check'}</button>
      </form>
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={input.trim() ? run : null} disabled={loading} />}

      {res && (
        <>
          <Stats items={[
            { label: 'Token', value: `${ok.length}/${res.tokens.length}` },
            { label: 'Fee recipients', value: res.recipients.length },
            { label: 'To sweep (est.)', value: `${fmt(pending)} ETH` },
            { label: 'Value', value: res.ethUsd ? fmtUsd(toEth(pending) * res.ethUsd) : '—', accent: true },
          ]} />

          <h3>Token</h3>
          <div className="tokens">
            {res.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={res.ethUsd} mode="ca" />)}
          </div>

          <h3>By fee recipient <span className="muted">· escrow &amp; claim</span></h3>
          {res.recipients.map(r => (
            <RecipientBlock key={r.wallet} r={r} tokens={ok.filter(t => (t.splitter ? t.splitter.creator : t.creatorFeeRecipient) === r.wallet)} ethUsd={res.ethUsd} />
          ))}
        </>
      )}
      {clk && (
        <>
          <h3>Clanker</h3>
          <ClankerCAResult res={clk} ethUsd={clk.ethUsd} onReload={run} />
        </>
      )}
    </>
  );
}
