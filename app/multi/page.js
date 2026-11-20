'use client';
import { useState, useEffect } from 'react';
import {
  WalletResult, fetchWallet, fetchTaxWallet, fetchClassicWallet, useWallet, PageHeader, ErrorLine, Stats, parseAddresses,
  walletEthTotals, fmt, fmtUsd, toEth, short,
} from '../ui';
import { CHAINS, CHAIN_IDS } from '../../lib/chains';
import { IconWallets, IconRefresh } from '../icons';
import { usePlatforms, PlatformToggle, ponsOn, taxJobs, classicOn, ClassicClaim } from '../tax-ui';
import { CheckResult } from '../check-ui';
import { prefetchTaxWallets } from '../../lib/tax-check';

// one wallet on the selected platforms
const fetchBoth = (wallet, pf) => Promise.all([ponsOn(pf) ? fetchWallet(wallet) : null, classicOn(pf) ? fetchClassicWallet(wallet) : null, ...taxJobs(pf).map(([k, id]) => fetchTaxWallet(k, wallet, id))])
  .then(([pons, classic, ...tax]) => { tax = tax.filter(Boolean); return { pons, classic, tax, ethUsd: pons?.ethUsd || tax[0]?.ethUsd || classic?.ethUsd }; });
const totals = res => {
  const t = res.pons ? walletEthTotals(res.pons) : { pending: 0n, escrow: 0n };
  const owed = k => res.tax.filter(x => x.platform === k).reduce((a, x) => a + x.owed, 0n); // all networks
  return { ...t, clanker: owed('clanker'), o1: owed('o1'), classic: res.classic?.owed || 0n,
    n: (res.pons?.tokens.length || 0) + res.tax.reduce((a, x) => a + x.tokens.length, 0) + (res.classic?.tokens.length || 0) };
};
const has = (res, k) => res.tax.some(x => x.platform === k);

export default function Multi() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');
  const w = useWallet();
  const [pf, togglePf] = usePlatforms();
  // explorer link(s) of the networks being checked (Pons is Robinhood only)
  const nets = CHAIN_IDS.filter(id => pf[`n${id}`]);

  // wallet connected / switched in MetaMask → add to the list if missing
  useEffect(() => {
    if (w.account) setInput(v => v.toLowerCase().includes(w.account.toLowerCase()) ? v : (v.trim() ? v.trim() + '\n' : '') + w.account);
  }, [w.account]);

  async function check(e) {
    e.preventDefault();
    const { list: wallets, bad } = parseAddresses(input);
    if (bad.length) return setErr(`Invalid address: ${bad.join(', ')}`);
    setErr(''); setLoading(true);
    const list = wallets.map(w => ({ wallet: w, res: null, err: '', loading: true }));
    setResults([...list]);
    // Clanker v5 / o1: one log scan for all wallets per platform + network (best effort; falls back per wallet)
    if (wallets.length > 1) await Promise.all(taxJobs(pf).map(([k, id]) => prefetchTaxWallets(k, wallets, id).catch(() => {})));
    // sequential to avoid public RPC rate limits
    for (let i = 0; i < list.length; i++) {
      try { list[i] = { ...list[i], res: await fetchBoth(list[i].wallet, pf), loading: false }; }
      catch (e) { list[i] = { ...list[i], err: e.message, loading: false }; }
      setResults([...list]);
    }
    setLoading(false);
  }

  // retry a single failed wallet
  async function recheck(wallet) {
    const upd = patch => setResults(rs => rs.map(r => r.wallet === wallet ? { ...r, ...patch } : r));
    upd({ loading: true, err: '' });
    try { upd({ res: await fetchBoth(wallet, pf), loading: false }); }
    catch (e) { upd({ err: e.message, loading: false }); }
  }

  const done = results.filter(r => r.res);
  const ethUsd = done.find(r => r.res.ethUsd)?.res.ethUsd;
  const sum = done.reduce((s, r) => { const t = totals(r.res); return { p: s.p + t.pending, e: s.e + t.escrow, c: s.c + t.clanker, k: s.k + t.classic, o: s.o + t.o1, n: s.n + t.n }; }, { p: 0n, e: 0n, c: 0n, k: 0n, o: 0n, n: 0 });
  const totalEth = toEth(sum.p + sum.e + sum.c + sum.k + sum.o);
  const classics = done.map(r => r.res.classic).filter(Boolean);

  return (
    <>
      <PageHeader icon={IconWallets} title="Check multiple wallets" desc="Paste wallets, one per line or separated by commas / spaces." />
      <div className="card ck-toolbar">
        <form className="search area" onSubmit={check}>
          <textarea rows={4} placeholder={'0x…\n0x…'} value={input} onChange={e => setInput(e.target.value)} />
          <button className="btn-primary" disabled={loading || !input.trim()}>{loading ? 'Checking…' : 'Check'}</button>
        </form>
        <div className="ck-filters"><PlatformToggle value={pf} onToggle={togglePf} disabled={loading} /></div>
      </div>
      {err && <ErrorLine msg={err} />}

      {results.length > 0 && (
        <>
          <Stats items={[
            { label: 'Wallets', value: `${done.length}/${results.length}` },
            { label: 'Token', value: sum.n },
            { label: 'Pons (sweep + escrow)', value: `${fmt(sum.p + sum.e)} ETH` },
            { label: 'Clanker v5', value: `${fmt(sum.c)} ETH` },
            { label: 'Clanker v0–v4', value: `${fmt(sum.k)} ETH`, action: classics.length > 1 && !loading ? <ClassicClaim results={classics} label="Claim all wallets" onDone={() => {}} /> : null },
            { label: 'o1', value: `${fmt(sum.o)} ETH` },
            { label: 'Total claimable', value: ethUsd ? fmtUsd(totalEth * ethUsd) : '—', accent: true },
          ]} />

          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Wallet</th><th>Tokens</th><th>Pons to sweep</th><th>Pons escrow</th><th>Clanker v5</th><th>Clanker v0–v4</th><th>o1</th><th>USD</th><th /></tr></thead>
              <tbody>
                {results.map(r => {
                  const t = r.res && totals(r.res);
                  return (
                    <tr key={r.wallet}>
                      <td><a className="mono" href={`#w-${r.wallet}`}>{short(r.wallet)}</a></td>
                      {r.res ? (
                        <>
                          <td>{t.n}</td>
                          <td>{r.res.pons ? `${fmt(t.pending)} ETH` : '—'}</td>
                          <td>{r.res.pons ? `${fmt(t.escrow)} ETH` : '—'}</td>
                          <td>{has(r.res, 'clanker') ? `${fmt(t.clanker)} ETH` : '—'}</td>
                          <td>{r.res.classic ? `${fmt(t.classic)} ETH` : '—'}</td>
                          <td>{has(r.res, 'o1') ? `${fmt(t.o1)} ETH` : '—'}</td>
                          <td className="accent">{ethUsd ? fmtUsd(toEth(t.pending + t.escrow + t.clanker + t.classic + t.o1) * ethUsd) : '—'}</td>
                          <td>{nets.map(id => <a key={id} href={`${CHAINS[id].explorer}/address/${r.wallet}`} target="_blank" rel="noreferrer" className="muted small" style={{ marginRight: 8 }}>{nets.length > 1 ? CHAINS[id].name : 'Blockscout'}</a>)}</td>
                        </>
                      ) : r.loading ? (
                        <td colSpan={8}><span className="loading inline"><span className="spin" />Checking…</span></td>
                      ) : (
                        <td colSpan={8}>
                          <span className="err">{r.err}</span>{' '}
                          <button type="button" className="btn-ghost sm" disabled={loading} onClick={() => recheck(r.wallet)}><IconRefresh />Retry</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {done.map(r => (
            <details key={r.wallet} id={`w-${r.wallet}`} className="fold" open={done.length === 1}>
              <summary><span className="mono">{r.wallet}</span><span className="muted"> · {totals(r.res).n} token</span></summary>
              <CheckResult res={r.res} onReload={() => recheck(r.wallet)} />
            </details>
          ))}
        </>
      )}
    </>
  );
}
