'use client';
import { useState } from 'react';
import {
  TokenCard, RecipientBlock, fetchTokens, PageHeader, ErrorLine, Spinner, Stats, parseAddresses,
  fmt, fmtUsd, toEth,
} from '../ui';
import { IconCoin } from '../icons';
import { zeroAddress } from 'viem';

export default function ByCA() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  async function run() {
    const { list, bad } = parseAddresses(input);
    if (bad.length) return setErr(`CA không hợp lệ: ${bad.join(', ')}`);
    setErr(''); setLoading(true); setRes(null);
    try { setRes(await fetchTokens(list)); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  const check = e => { e.preventDefault(); run(); };

  const ok = res ? res.tokens.filter(t => !t.error) : [];
  const pending = ok.filter(t => t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);

  return (
    <>
      <PageHeader icon={IconCoin} title="Check theo CA" desc="Nhập 1 hoặc nhiều contract address token Pons v2 để xem phí chưa nhận và ví được nhận phí của từng token." />
      <form className="search area" onSubmit={check}>
        <textarea rows={3} placeholder={'CA token, mỗi dòng một CA\n0x…'} value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn-primary" disabled={loading || !input.trim()}>{loading ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </form>
      {loading && <Spinner />}
      {err && <ErrorLine msg={err} onRetry={input.trim() ? run : null} disabled={loading} />}

      {res && (
        <>
          <Stats items={[
            { label: 'Token', value: `${ok.length}/${res.tokens.length}` },
            { label: 'Ví nhận phí', value: res.recipients.length },
            { label: 'Chờ sweep (ước tính)', value: `${fmt(pending)} ETH` },
            { label: 'Giá trị', value: res.ethUsd ? fmtUsd(toEth(pending) * res.ethUsd) : '—', accent: true },
          ]} />

          <h3>Token</h3>
          <div className="tokens">
            {res.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={res.ethUsd} mode="ca" />)}
          </div>

          <h3>Theo ví nhận phí <span className="muted">· escrow &amp; claim</span></h3>
          {res.recipients.map(r => (
            <RecipientBlock key={r.wallet} r={r} tokens={ok.filter(t => (t.splitter ? t.splitter.creator : t.creatorFeeRecipient) === r.wallet)} ethUsd={res.ethUsd} />
          ))}
        </>
      )}
    </>
  );
}
