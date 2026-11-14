'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { parseEther, formatEther, formatUnits, parseUnits, isAddress, getAddress } from 'viem';
import {
  tokenSummary, tradesOf, blockTime, holdersOf, quoteBuy, quoteSell, tokenBalance, tokenAllowance,
  ethBalance, buyData, sellData, approveData, waitTx,
} from '../../../lib/market';
import { client, ADDR } from '../../../lib/pons';
import { getEthUsd, short, Spinner, ErrorLine, EXPLORER, PONS, useWallet } from '../../ui';
import { PriceChart, usdC, priceUsd, ago, compact, Logo } from '../../charts';
import { IconExternal, IconCopy, IconCheck } from '../../icons';

const RANGES = [{ id: '1h', s: 3600 }, { id: '6h', s: 21600 }, { id: '1D', s: 86400 }, { id: '7D', s: 604800 }, { id: 'All', s: 0 }];

function CopyAddr({ a }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="icon-btn" onClick={() => { navigator.clipboard.writeText(a); setOk(true); setTimeout(() => setOk(false), 1000); }}>{ok ? <IconCheck /> : <IconCopy />}</button>;
}

async function launchBlockOf(token) {
  // block của sự kiện TokenLaunched (topic1 = token) – quét ngược tối đa ~30M block
  const latest = await client.getBlockNumber();
  for (let to = latest; to > 26_841_846n; to -= 10_000_000n) {
    const from = to - 9_999_999n > 26_841_846n ? to - 9_999_999n : 26_841_846n;
    const logs = await client.request({ method: 'eth_getLogs', params: [{ address: ADDR.factory, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: ['0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607', '0x' + token.slice(2).toLowerCase().padStart(64, '0')] }] });
    if (logs.length) return BigInt(logs[0].blockNumber);
  }
  return null;
}

export default function TokenPage() {
  const { ca } = useParams();
  const w = useWallet();
  const [s, setS] = useState(null);
  const [trades, setTrades] = useState([]);
  const [holders, setHolders] = useState(null);
  const [ethUsd, setEthUsd] = useState(null);
  const [err, setErr] = useState('');
  const [range, setRange] = useState('All');
  const [tab, setTab] = useState('trades');

  const load = useCallback(async () => {
    try {
      if (!isAddress(ca || '', { strict: false })) throw new Error('CA không hợp lệ');
      const token = getAddress(ca);
      const lb = await launchBlockOf(token);
      const [sum, px, h, t0] = await Promise.all([
        tokenSummary(token, lb), getEthUsd(), holdersOf(token), lb ? blockTime(lb) : null,
      ]);
      const trs = lb ? await tradesOf(sum.curve, lb) : [];
      setS({ ...sum, time: t0 }); setTrades(trs); setEthUsd(px); setHolders(h);
    } catch (e) { setErr(e.message); }
  }, [ca]);
  useEffect(() => { load(); }, [load]);

  if (err) return <ErrorLine msg={err} />;
  if (!s) return <Spinner text="Đang đọc dữ liệu token…" />;

  const px = ethUsd || 0;
  const priceU = s.priceEth != null ? s.priceEth * px : null;
  const mcapU = s.mcapEth != null ? s.mcapEth * px : null;
  const now = Date.now() / 1000;
  const rs = RANGES.find(r => r.id === range).s;
  const chartTrades = trades.filter(t => t.time && (!rs || t.time >= now - rs)).map(t => ({ time: t.time, price: t.price * px, usdVol: Number(formatEther(t.eth)) * px, side: t.side }));
  const first = chartTrades[0]?.price, change = first && priceU ? ((priceU - first) / first) * 100 : null;
  const creatorEarned = trades.reduce((a, t) => a + (t.fee * 7000n) / 10000n + t.tax, 0n); // 70% phí gốc + creator tax
  const soc = s.socials || {};
  const links = [['X', soc.twitter], ['Telegram', soc.telegram], ['Website', soc.website], ['Discord', soc.discord], ['Farcaster', soc.farcaster]].filter(([, u]) => u);

  return (
    <div className="tp">
      <a className="muted small" href="/launches">‹ Launches</a>
      <div className="tp-head">
        <Logo t={s} size={64} />
        <div className="tp-name">
          <h1>{s.name} <span className="muted">{s.symbol}</span></h1>
          <div className="muted small tp-sub">
            by <a className="mono" href={`${EXPLORER}/address/${s.deployer}`} target="_blank" rel="noreferrer">{short(s.deployer)}</a>
            <span>· {ago(s.time)} trước</span><span>· cặp ETH</span>
            <span className="mono">· {short(s.token)}</span><CopyAddr a={s.token} />
            <a className="pill" href={`${PONS}/${s.token}`} target="_blank" rel="noreferrer">Pons <IconExternal /></a>
            {links.map(([k, u]) => <a key={k} className="pill" href={u} target="_blank" rel="noreferrer">{k} <IconExternal /></a>)}
          </div>
        </div>
        <div className="tp-mc">
          <span className="muted small">Market cap</span>
          <b>{s.phase > 0 ? '—' : usdC(mcapU)}</b>
          <span className="muted small">{priceUsd(priceU)} giá</span>
        </div>
      </div>

      <div className="tp-grid">
        <div>
          <div className="tp-pricebar">
            <div><b className="tp-price">{priceUsd(priceU)}</b>{change != null && <span className={change >= 0 ? 'ok' : 'err'}> {change >= 0 ? '+' : ''}{change.toFixed(2)}% {range}</span>}</div>
            <div className="seg">{RANGES.map(r => <button key={r.id} type="button" className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.id}</button>)}</div>
          </div>
          <div className="card chart-card"><PriceChart trades={chartTrades} /></div>

          <div className="tp-stats">
            <div><span>Market cap</span><b>{s.phase > 0 ? '—' : usdC(mcapU)}</b></div>
            <div><span>Holders</span><b>{holders ? holders.count.toLocaleString('en-US') : '…'}</b></div>
            <div><span>Giao dịch</span><b>{trades.length.toLocaleString('en-US')}</b></div>
            <div><span>Supply</span><b>1B</b></div>
            <div><span>Creator kiếm được</span><b>{usdC(Number(formatEther(creatorEarned)) * px)}</b></div>
          </div>
          <div className="tp-stats sm">
            <div><span>Token</span><a className="mono" href={`${EXPLORER}/token/${s.token}`} target="_blank" rel="noreferrer">{short(s.token)}</a></div>
            <div><span>Curve</span><a className="mono" href={`${EXPLORER}/address/${s.curve}`} target="_blank" rel="noreferrer">{short(s.curve)}</a></div>
            <div><span>Launch</span><b>{s.time ? new Date(s.time * 1000).toLocaleString('vi-VN') : '—'}</b></div>
            <div><span>Creator tax</span><b>{s.creatorTaxBps / 100}%</b></div>
          </div>

          <div className="card tp-bond">
            <div className="row"><span>Bonding curve</span><b>{s.phase > 0 ? 'Đã graduate' : `${(s.progress * 100).toFixed(2)}%`}</b></div>
            <div className="lp-prog big"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
            {s.phase === 0 && <small className="muted">{Number(formatEther(s.realQuote)).toPrecision(3)} / {Number(formatEther(s.threshold))} ETH — đủ ngưỡng sẽ graduate sang Uniswap v4</small>}
          </div>

          {s.description && (<><h3>Giới thiệu</h3><p className="tp-about">{s.description}</p></>)}

          <div className="lp-tabs">
            <button type="button" className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Giao dịch</button>
            <button type="button" className={tab === 'holders' ? 'on' : ''} onClick={() => setTab('holders')}>Holders</button>
          </div>
          {tab === 'trades' ? (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Loại</th><th>Ví</th><th>ETH</th><th>{s.symbol}</th><th>Giá</th><th>Thời gian</th></tr></thead>
                <tbody>
                  {[...trades].reverse().slice(0, 100).map(t => (
                    <tr key={t.tx + t.logIndex}>
                      <td className={t.side === 'Buy' ? 'ok' : 'err'}>{t.side === 'Buy' ? 'Mua' : 'Bán'}</td>
                      <td><a className="mono" href={`${EXPLORER}/address/${t.trader}`} target="_blank" rel="noreferrer">{short(t.trader)}</a></td>
                      <td>{Number(formatEther(t.eth)).toPrecision(3)}</td>
                      <td>{compact(Number(formatUnits(t.tokens, 18)))}</td>
                      <td>{priceUsd(t.price * px)}</td>
                      <td><a className="muted" href={`${EXPLORER}/tx/${t.tx}`} target="_blank" rel="noreferrer">{ago(t.time)}</a></td>
                    </tr>
                  ))}
                  {!trades.length && <tr><td colSpan={6} className="muted">Chưa có giao dịch</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>Ví</th><th>Số lượng</th><th>%</th></tr></thead>
                <tbody>
                  {(holders?.items || []).map((h, i) => (
                    <tr key={h.address}>
                      <td className="muted">{i + 1}</td>
                      <td><a className="mono" href={`${EXPLORER}/address/${h.address}`} target="_blank" rel="noreferrer">{short(h.address)}</a>
                        {h.address.toLowerCase() === s.curve.toLowerCase() && <em className="tag ok">bonding curve</em>}
                        {h.address.toLowerCase() === s.deployer.toLowerCase() && <em className="tag warn">creator</em>}</td>
                      <td>{compact(Number(formatUnits(h.value, 18)))}</td>
                      <td>{(Number(formatUnits(h.value, 18)) / 1e7).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <TradeBox s={s} account={w.account} connect={w.connect} onDone={load} />
      </div>
    </div>
  );
}

function TradeBox({ s, account, connect, onDone }) {
  const [side, setSide] = useState('buy');
  const [amt, setAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [bal, setBal] = useState({ eth: 0n, tok: 0n });
  const [st, setSt] = useState({ busy: '', err: '', hash: '' });
  const SLIP = 2n; // %

  useEffect(() => {
    if (!account) return;
    Promise.all([ethBalance(account), tokenBalance(s.token, account)]).then(([eth, tok]) => setBal({ eth, tok })).catch(() => {});
  }, [account, s.token, st.hash]);

  let inWei = 0n;
  try { inWei = amt ? (side === 'buy' ? parseEther(amt) : parseUnits(amt, 18)) : 0n; } catch {}
  useEffect(() => {
    setQuote(null);
    if (inWei <= 0n || s.phase !== 0) return;
    const id = setTimeout(() => {
      (side === 'buy' ? quoteBuy(s.curve, inWei, account).then(q => setQuote({ out: q.tokensOut, snipe: q.snipeBps }))
        : quoteSell(s.curve, inWei).then(out => setQuote({ out }))).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [amt, side, account]);

  const pct = p => {
    if (side === 'buy') { const v = bal.eth * BigInt(p) / 100n - (p === 100 ? 200000000000000n : 0n); setAmt(v > 0n ? formatEther(v) : '0'); }
    else setAmt(formatUnits(bal.tok * BigInt(p) / 100n, 18));
  };

  async function send() {
    const eth = window.ethereum;
    setSt({ busy: 'Đang chuẩn bị…', err: '', hash: '' });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      const minOut = quote.out * (100n - SLIP) / 100n;
      let hash;
      if (side === 'buy') {
        setSt({ busy: 'Xác nhận mua trong MetaMask…' });
        hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: s.curve, data: buyData(inWei, minOut, from), value: '0x' + inWei.toString(16) }] });
      } else {
        const allow = await tokenAllowance(s.token, from, s.curve);
        if (allow < inWei) {
          setSt({ busy: 'Bước 1/2: cho phép curve dùng token…' });
          const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: s.token, data: approveData(s.curve, inWei), value: '0x0' }] });
          await waitTx(h);
        }
        setSt({ busy: 'Xác nhận bán trong MetaMask…' });
        hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: s.curve, data: sellData(inWei, minOut, from), value: '0x0' }] });
      }
      setSt({ busy: 'Đang chờ xác nhận…', hash });
      const rc = await waitTx(hash);
      if (rc.status !== 'success') throw new Error('Giao dịch thất bại');
      setSt({ busy: '', err: '', hash }); setAmt(''); onDone?.();
    } catch (e) {
      setSt({ busy: '', err: e.code === 4001 ? 'Đã huỷ trong MetaMask' : (e.shortMessage || e.message), hash: '' });
    }
  }

  if (s.phase !== 0) {
    return (
      <div className="card tradebox">
        <p className="muted">Token đã graduate sang Uniswap v4.</p>
        <a className="btn-primary big-btn" href={`${PONS}/${s.token}`} target="_blank" rel="noreferrer">Giao dịch trên Pons <IconExternal /></a>
      </div>
    );
  }
  return (
    <div className="card tradebox">
      <p className="muted small">Giao dịch trực tiếp trên bonding curve của Pons.</p>
      <div className="seg full">
        <button type="button" className={side === 'buy' ? 'on buy' : ''} onClick={() => { setSide('buy'); setAmt(''); }}>Mua</button>
        <button type="button" className={side === 'sell' ? 'on sell' : ''} onClick={() => { setSide('sell'); setAmt(''); }}>Bán</button>
      </div>
      <div className="tb-in">
        <span className="muted small">Trả</span>
        <div className="tb-row"><input inputMode="decimal" placeholder="0" value={amt} onChange={e => setAmt(e.target.value.replace(',', '.'))} /><b>{side === 'buy' ? 'ETH' : s.symbol}</b></div>
        <div className="tb-pct">{[25, 50, 75, 100].map(p => <button key={p} type="button" onClick={() => pct(p)} disabled={!account}>{p === 100 ? 'Max' : p + '%'}</button>)}</div>
        {account && <small className="muted">Số dư: {side === 'buy' ? `${Number(formatEther(bal.eth)).toFixed(5)} ETH` : `${compact(Number(formatUnits(bal.tok, 18)))} ${s.symbol}`}</small>}
      </div>
      <div className="tb-out">
        <span className="muted small">Nhận (ước tính)</span>
        <b>{quote ? (side === 'buy' ? `${compact(Number(formatUnits(quote.out, 18)))} ${s.symbol}` : `${Number(formatEther(quote.out)).toPrecision(4)} ETH`) : '0'}</b>
        {quote?.snipe > 0 && <small className="warn">Đang trong thời gian snipe tax: {quote.snipe / 100}%</small>}
      </div>
      <small className="muted">Trượt giá tối đa {SLIP.toString()}% · phí 1% + creator tax {s.creatorTaxBps / 100}%</small>
      {account
        ? <button type="button" className={`btn-primary big-btn ${side}`} disabled={!quote || inWei <= 0n || !!st.busy} onClick={send}>{st.busy || (side === 'buy' ? `Mua ${s.symbol}` : `Bán ${s.symbol}`)}</button>
        : <button type="button" className="btn-primary big-btn" onClick={connect}>Connect Wallet</button>}
      {st.hash && <a className="ok small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">Giao dịch {short(st.hash)} <IconExternal /></a>}
      {st.err && <ErrorLine msg={st.err} />}
    </div>
  );
}
