'use client';
import { useState } from 'react';
import {
  TokenCard, RecipientBlock, fetchTokens, fetchTaxTokens, PageHeader, ErrorLine, Spinner, Stats, parseAddresses,
  fmt, fmtUsd, toEth, short,
} from '../ui';
import { IconCoin } from '../icons';
import { zeroAddress, getAddress } from 'viem';
import { usePlatforms, PlatformToggle, ponsOn, taxJobs } from '../tax-ui';
import { TokenTable, rowsOf, SourceList } from '../check-ui';
import { claimPlan, ClaimSteps } from '../ui';
import { CHAIN_IDS } from '../../lib/chains';
import { TAX, TAX_KEYS, taxPlatformOf } from '../../lib/tax';
import { isPangeaToken } from '../../lib/pangea';

export default function ByCA() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [pf, togglePf] = usePlatforms();
  const [clk, setClk] = useState(null);
  const [pg, setPg] = useState([]); // Pangea CAs: fees shown on their token page

  async function run() {
    const { list, bad } = parseAddresses(input);
    if (bad.length) return setErr(`Invalid CA: ${bad.join(', ')}`);
    setErr(''); setLoading(true); setRes(null); setClk(null); setPg([]);
    try {
      // sort CAs by platform (Clanker factory knows its tokens), skip a platform that is switched off
      // which platform + network each CA belongs to (only the networks switched on)
      const nets = CHAIN_IDS.filter(id => pf[`n${id}`]);
      const pang = pf.n4663 ? await Promise.all(list.map(a => isPangeaToken(getAddress(a)))) : list.map(() => false);
      const pgs = list.filter((_, i) => pang[i]).map(a => getAddress(a));
      setPg(pgs);
      const kind = await Promise.all(list.map((a, i) => pang[i] ? 'pangea' : taxPlatformOf(getAddress(a), nets).catch(() => null)));
      const po = list.filter((_, i) => !kind[i]);
      const [p, ...tax] = await Promise.all([
        ponsOn(pf) && po.length ? fetchTokens(po) : null,
        ...taxJobs(pf).map(([k, id]) => { const cas = list.filter((_, i) => kind[i]?.pf === k && kind[i]?.chainId === id); return cas.length ? fetchTaxTokens(k, cas, id) : null; }),
      ]);
      const t = tax.filter(Boolean);
      if (!p && !t.length && !pgs.length) throw new Error('No token found on the selected platforms');
      setRes(p); setClk(t);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  const check = e => { e.preventDefault(); run(); };

  const ok = res ? res.tokens.filter(t => !t.error) : [];
  const ponsOf = w => ok.filter(t => (t.splitter ? t.splitter.creator : t.creatorFeeRecipient) === w);
  const ethUsd = res?.ethUsd || clk?.[0]?.ethUsd;
  // one claim row per fee recipient and platform/network
  const sources = [
    ...(res?.recipients || []).map(r => {
      const mine = ponsOf(r.wallet);
      const pend = mine.filter(t => t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);
      const esc = BigInt(r.escrow.find(a => a.asset === zeroAddress)?.balance || 0);
      return { key: 'pons', pf: 'pons', chainId: 4663, wallet: r.wallet, amount: pend + esc, tokens: mine.length, calls: claimPlan(mine, r.escrow).calls };
    }),
    ...(clk || []).flatMap(c => c.recipients.map(r => ({ key: c.platform + c.chainId, pf: c.platform, chainId: c.chainId, wallet: r.wallet, amount: r.owed, tokens: c.tokens.filter(t => t.recipient === r.wallet).length }))),
  ];
  const rows = rowsOf({ pons: res, tax: clk || [] });
  const total = sources.reduce((a, s) => a + s.amount, 0n);

  return (
    <>
      <PageHeader icon={IconCoin} title="Check by CA" desc="Token contract addresses → unclaimed fees and who can claim them." />
      <div className="card ck-toolbar">
        <form className="search area" onSubmit={check}>
          <textarea rows={3} placeholder={'Token CA, one per line\n0x…'} value={input} onChange={e => setInput(e.target.value)} />
          <button className="btn-primary" disabled={loading || !input.trim()}>{loading ? 'Checking…' : 'Check'}</button>
        </form>
        <div className="ck-filters"><PlatformToggle value={pf} onToggle={togglePf} disabled={loading} /></div>
      </div>
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={input.trim() ? run : null} disabled={loading} />}

      {pg.length > 0 && (
        <div className="card">
          <p className="small"><b>Pangea</b> tokens: creator fees and the claim are on the token page.</p>
          {pg.map(a => <a key={a} className="pill mono" href={`/launches/${a}?pf=pangea`}>{short(a)} →</a>)}
        </div>
      )}
      {(res || clk?.length) ? (
        <section className="ck">
          <div className="card ck-summary">
            <div className="ck-head">
              <div><span className="muted small">Tokens</span><b className="ck-count">{rows.filter(r => !r.error).length}/{rows.length}</b></div>
              <div className="ck-total">
                <span className="muted small">Total claimable</span>
                <b>{ethUsd ? fmtUsd(toEth(total) * ethUsd) : '—'}</b>
                <small className="muted">{fmt(total)} ETH · {sources.length} fee recipient{sources.length === 1 ? '' : 's'}</small>
              </div>
            </div>
            <SourceList sources={sources} ethUsd={ethUsd} onReload={run} showWallet />
            <p className="muted small">Claimable is per fee recipient, so it can include fees from their other tokens.</p>
          </div>
          <TokenTable rows={rows} ethUsd={ethUsd} />
          {res && ok.length > 0 && (
            <details className="info-fold">
              <summary>Pons details <span className="muted">· sweep status, escrow, manual claim steps</span></summary>
              <div className="tokens compact">{res.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={res.ethUsd} mode="ca" />)}</div>
              {res.recipients.map(r => <ClaimSteps key={r.wallet} wallet={r.wallet} tokens={ponsOf(r.wallet)} escrow={r.escrow} />)}
            </details>
          )}
        </section>
      ) : null}
    </>
  );
}
