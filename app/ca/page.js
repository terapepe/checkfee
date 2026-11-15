'use client';
import { useState } from 'react';
import {
  TokenCard, RecipientBlock, fetchTokens, fetchTaxTokens, PageHeader, ErrorLine, Spinner, Stats, parseAddresses,
  fmt, fmtUsd, toEth,
} from '../ui';
import { IconCoin } from '../icons';
import { zeroAddress, getAddress } from 'viem';
import { usePlatforms, PlatformToggle, TaxCAResult, ponsOn, taxJobs } from '../tax-ui';
import { CHAIN_IDS } from '../../lib/chains';
import { TAX, TAX_KEYS, taxPlatformOf } from '../../lib/tax';

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
      // which platform + network each CA belongs to (only the networks switched on)
      const nets = CHAIN_IDS.filter(id => pf[`n${id}`]);
      const kind = await Promise.all(list.map(a => taxPlatformOf(getAddress(a), nets).catch(() => null)));
      const po = list.filter((_, i) => !kind[i]);
      const [p, ...tax] = await Promise.all([
        ponsOn(pf) && po.length ? fetchTokens(po) : null,
        ...taxJobs(pf).map(([k, id]) => { const cas = list.filter((_, i) => kind[i]?.pf === k && kind[i]?.chainId === id); return cas.length ? fetchTaxTokens(k, cas, id) : null; }),
      ]);
      const t = tax.filter(Boolean);
      if (!p && !t.length) throw new Error('No token found on the selected platforms');
      setRes(p); setClk(t);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  const check = e => { e.preventDefault(); run(); };

  const ok = res ? res.tokens.filter(t => !t.error) : [];
  const pending = ok.filter(t => t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);

  return (
    <>
      <PageHeader icon={IconCoin} title="Check by CA" desc="Enter one or more Pons v2 / Clanker / o1 token contract addresses to see unclaimed fees and each token's fee recipient." />
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
      {clk?.map(c => (
        <div key={c.platform + c.chainId}>
          <h3>{TAX[c.platform].label} · {c.chainId === 8453 ? 'Base' : 'Robinhood'}</h3>
          <TaxCAResult res={c} ethUsd={c.ethUsd} onReload={run} />
        </div>
      ))}
    </>
  );
}
