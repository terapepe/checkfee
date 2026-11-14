'use client';
import { useState, useEffect } from 'react';
import {
  WalletResult, fetchWallet, useWallet, PageHeader, ErrorLine, Stats, parseAddresses,
  walletEthTotals, fmt, fmtUsd, toEth, short, EXPLORER,
} from '../ui';
import { IconWallets, IconRefresh } from '../icons';

export default function Multi() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');
  const w = useWallet();

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
    // sequential to avoid public RPC rate limits
    for (let i = 0; i < list.length; i++) {
      try { list[i] = { ...list[i], res: await fetchWallet(list[i].wallet), loading: false }; }
      catch (e) { list[i] = { ...list[i], err: e.message, loading: false }; }
      setResults([...list]);
    }
    setLoading(false);
  }

  // retry a single failed wallet
  async function recheck(wallet) {
    const upd = patch => setResults(rs => rs.map(r => r.wallet === wallet ? { ...r, ...patch } : r));
    upd({ loading: true, err: '' });
    try { upd({ res: await fetchWallet(wallet), loading: false }); }
    catch (e) { upd({ err: e.message, loading: false }); }
  }

  const done = results.filter(r => r.res);
  const ethUsd = done.find(r => r.res.ethUsd)?.res.ethUsd;
  const sum = done.reduce((s, r) => { const t = walletEthTotals(r.res); return { p: s.p + t.pending, e: s.e + t.escrow, n: s.n + r.res.tokens.length }; }, { p: 0n, e: 0n, n: 0 });
  const totalEth = toEth(sum.p + sum.e);

  return (
    <>
      <PageHeader icon={IconWallets} title="Check multiple wallets" desc="Paste wallets, one per line (or separated by commas / spaces). Wallets are checked one after another." />
      <form className="search area" onSubmit={check}>
        <textarea rows={4} placeholder={'0x…\n0x…'} value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn-primary" disabled={loading || !input.trim()}>{loading ? 'Checking…' : 'Check'}</button>
      </form>
      {err && <ErrorLine msg={err} />}

      {results.length > 0 && (
        <>
          <Stats items={[
            { label: 'Wallets', value: `${done.length}/${results.length}` },
            { label: 'Token', value: sum.n },
            { label: 'To sweep + escrow', value: `${fmt(sum.p + sum.e)} ETH` },
            { label: 'Total claimable', value: ethUsd ? fmtUsd(totalEth * ethUsd) : '—', accent: true },
          ]} />

          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Wallet</th><th>Tokens</th><th>To sweep</th><th>Escrow</th><th>USD</th><th /></tr></thead>
              <tbody>
                {results.map(r => {
                  const t = r.res && walletEthTotals(r.res);
                  return (
                    <tr key={r.wallet}>
                      <td><a className="mono" href={`#w-${r.wallet}`}>{short(r.wallet)}</a></td>
                      {r.res ? (
                        <>
                          <td>{r.res.tokens.length}</td>
                          <td>{fmt(t.pending)} ETH</td>
                          <td>{fmt(t.escrow)} ETH</td>
                          <td className="accent">{ethUsd ? fmtUsd(toEth(t.pending + t.escrow) * ethUsd) : '—'}</td>
                          <td><a href={`${EXPLORER}/address/${r.wallet}`} target="_blank" rel="noreferrer" className="muted small">Blockscout</a></td>
                        </>
                      ) : r.loading ? (
                        <td colSpan={5}><span className="loading inline"><span className="spin" />Checking…</span></td>
                      ) : (
                        <td colSpan={5}>
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
              <summary><span className="mono">{r.wallet}</span><span className="muted"> · {r.res.tokens.length} token</span></summary>
              <WalletResult res={r.res} />
            </details>
          ))}
        </>
      )}
    </>
  );
}
